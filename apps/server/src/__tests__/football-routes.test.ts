import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { createUser, _resetUsersCache } from '../users.js';
import { createToken } from '../auth.js';
import { _resetFootballCache, followTeam, getTeamFollows } from '../footballStore.js';
import { parseEspnScoreboard, cairoClock } from '../football.js';
import { insertArticles, _resetDbCache } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR'] ? path.resolve(process.env['DATA_DIR']) : path.resolve(__dirname, '../../../data');

function reset(): void {
  for (const f of ['users.json', 'news.json', 'team-follows.json']) {
    try { fs.rmSync(path.join(DATA_DIR, f), { force: true }); } catch { /* ignore */ }
  }
  _resetUsersCache(); _resetDbCache(); _resetFootballCache();
}
function verified(): string {
  const u = createUser({ id: 'fu-1', email: 'f@secret.example', passwordHash: 's:h', createdAt: Date.now(), emailVerified: true });
  return createToken(u.id);
}
beforeEach(reset);

describe('football API', () => {
  it('lists the competitions', async () => {
    const res = await app.request('/api/football/competitions');
    const { data } = (await res.json()) as { data: Array<{ id: string; nameAr: string }> };
    // 11 competitions now: كأس الكونفدرالية was added with the FilGoal batch.
    expect(data.length).toBe(11);
    expect(data.map((x) => x.id)).toContain('egyptian-premier');
    expect(data.find((x) => x.id === 'egyptian-premier')?.nameAr).toBe('الدوري المصري');
  });

  it('rejects a malformed date instead of guessing', async () => {
    const res = await app.request('/api/football/matches?date=22-11-2026');
    expect(res.status).toBe(400);
  });

  it('requires auth to follow a team', async () => {
    const res = await app.request('/api/football/follows', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team: 'الأهلي' }) });
    expect(res.status).toBe(401);
  });

  it('follow → list → notify → unfollow', async () => {
    const token = verified();
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const put = await app.request('/api/football/follows', { method: 'PUT', headers: auth, body: JSON.stringify({ team: 'الأهلي', competitionId: 'egyptian-premier' }) });
    expect(put.status).toBe(200);
    const list = await app.request('/api/football/follows', { headers: auth });
    const { data } = (await list.json()) as { data: { teams: Array<{ name: string; notifyGoals: boolean }> } };
    expect(data.teams.map((t) => t.name)).toEqual(['الأهلي']);
    expect(data.teams[0].notifyGoals).toBe(true);

    const off = await app.request('/api/football/follows/الأهلي/notify', { method: 'PUT', headers: auth, body: JSON.stringify({ notifyGoals: false }) });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { data: { follow: { notifyGoals: boolean } } }).data.follow.notifyGoals).toBe(false);

    const del = await app.request('/api/football/follows/الأهلي', { method: 'DELETE', headers: auth });
    expect(del.status).toBe(200);
    expect(getTeamFollows('fu-1')).toHaveLength(0);
  });

  it('following twice keeps one row', async () => {
    followTeam('u1', 'الزمالك', 'egyptian-premier');
    followTeam('u1', 'الزمالك', 'egyptian-premier');
    expect(getTeamFollows('u1')).toHaveLength(1);
  });

  it('rejects an unknown competition', async () => {
    const token = verified();
    const res = await app.request('/api/football/follows', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ team: 'X', competitionId: 'nope' }) });
    expect(res.status).toBe(400);
  });

  it('matches a match against our own corpus (THE NEWS tab)', async () => {
    insertArticles([
      { id: 'n1', title: 'الأهلي يهزم الزمالك في القمة بهدف قاتل', summary: null, imageUrl: null, url: 'https://x/1', sourceId: 'youm7', sourceName: 'اليوم السابع', category: 'sports', country: 'EG', publishedAt: Date.now(), isBreaking: false },
      { id: 'n2', title: 'وزير الخارجية يبحث الأزمة الإقليمية', summary: null, imageUrl: null, url: 'https://x/2', sourceId: 'ahram', sourceName: 'الأهرام', category: 'egypt', country: 'EG', publishedAt: Date.now() - 1000, isBreaking: false },
    ],);
    _resetDbCache();
    const { relatedNews } = await import('../footballService.js');
    const news = relatedNews('الأهلي', 'بيراميدز');
    expect(news.map((n) => n.id)).toEqual(['n1']);
    expect(news[0].team).toBe('home');
  });

  it('never shows a false 0-0 for an ESPN match that has not started', () => {

    const competition = { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', yallakoraName: 'الدوري الإنجليزي', yallakoraTourId: '93', espnSlug: 'eng.1', country: 'GB', priority: 22 };
    const rows = parseEspnScoreboard(
      {
        events: [
          {
            id: '1',
            date: '2026-11-22T14:00Z',
            competitions: [
              {
                status: { type: { state: 'pre', detail: 'Sun, November 22nd at 9:00 AM EST' }, displayClock: "0'" },
                competitors: [
                  { homeAway: 'home', team: { displayName: 'Hull City' }, score: '0' },
                  { homeAway: 'away', team: { displayName: 'Brighton' }, score: '0' },
                ],
              },
            ],
          },
        ],
      },
      competition,
    );
    expect(rows[0]!.homeScore).toBeNull();
    expect(rows[0]!.awayScore).toBeNull();
    // ...and the status the app shows is Arabic, never ESPN's English string.
    expect(rows[0]!.statusText).toBe('لم تبدأ');
    expect(rows[0]!.statusText).not.toMatch(/[A-Za-z]{3,}/);
  });

  it('refuses a follow from an unverified account, like article follows', async () => {
    const u = createUser({ id: 'fu-2', email: 'unv@secret.example', passwordHash: 's:h', createdAt: Date.now(), emailVerified: false });
    const token = createToken(u.id);
    const res = await app.request('/api/football/follows', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ team: 'الأهلي' }),
    });
    expect(res.status).toBe(403);
    expect(getTeamFollows('fu-2')).toHaveLength(0);
  });

  it('shows an ESPN kickoff in Cairo time, not raw UTC', () => {
    // ESPN sends `2026-11-22T14:00Z`; Cairo is UTC+2, so the app must show 16:00.
    // Asserted through the parser, because that is the value the app renders.
    const competition = { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', yallakoraName: 'الدوري الإنجليزي', yallakoraTourId: '93', espnSlug: 'eng.1', country: 'GB', priority: 22 };
    const rows = parseEspnScoreboard(
      {
        events: [
          {
            id: '9',
            date: '2026-11-22T14:00Z',
            competitions: [
              {
                status: { type: { state: 'pre' }, displayClock: "0'" },
                competitors: [
                  { homeAway: 'home', team: { displayName: 'Hull City' }, score: '0' },
                  { homeAway: 'away', team: { displayName: 'Brighton' }, score: '0' },
                ],
              },
            ],
          },
        ],
      },
      competition,
    );
    expect(rows[0]!.kickoff).toBe('16:00');
    expect(cairoClock('2026-11-22T22:30Z')).toBe('00:30');
    expect(cairoClock('not-a-date')).toBeNull();
  });

  it('lights the header dot only for a live Egyptian match, without network', async () => {
    // Stub the source rather than hit it: a test that depends on tonight's
    // fixtures is a test that fails for no reason.
    const html = `
      <h2>الدوري المصري</h2>
      <div class="allData">
        <div class="channel">أون تايم سبورتس 1</div>
        <div class="topData"><div class="date">الأسبوع التاسع</div><div class="matchStatus"><span>مباشر</span></div></div>
        <div class="teams teamA"><p>الأهلي</p></div>
        <div class="MResult"><span class="score">1</span><span>-</span><span class="score">0</span><span class="time">20:00</span></div>
        <div class="teams teamB"><p>بيراميدز</p></div>
      </div>`;
    vi.stubGlobal('fetch', async () => new Response(html, { status: 200 }));
    try {
      const res = await app.request('/api/football/live-status');
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as {
        data: { live: boolean; matches: Array<{ home: string; away: string }> };
      };
      expect(data.live).toBe(true);
      expect(data.matches).toHaveLength(1);
      expect(data.matches[0]!.home).toBe('الأهلي');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the header dot off when the live match is an unrelated league', async () => {
    const html = `
      <h2>الدوري الإنجليزي</h2>
      <div class="allData">
        <div class="topData"><div class="matchStatus"><span>مباشر</span></div></div>
        <div class="teams teamA"><p>ليفربول</p></div>
        <div class="MResult"><span class="score">1</span><span>-</span><span class="score">0</span><span class="time">20:00</span></div>
        <div class="teams teamB"><p>أرسنال</p></div>
      </div>`;
    vi.stubGlobal('fetch', async () => new Response(html, { status: 200 }));
    try {
      const res = await app.request('/api/football/live-status');
      const { data } = (await res.json()) as { data: { live: boolean } };
      expect(data.live).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns the commentator when the provider publishes one', async () => {
    // FilGoal's match page carries the commentator; the day list does not.
    const detailHtml = `{"CommenterName":"بلال علام","TvChannelName":"On Sport MAX","Date":"2026-11-23T17:00:00","HomeTeamCoachName":"علاء عبد العال","AwayTeamCoachName":"معتمد جمال"}`;
    const listHtml = `<h2>الدوري المصري</h2>
      <div class="cin_cntnr"><a href="/matches/375939/x"><div class="f"><strong>الجونة</strong><b> - </b></div>
      <div class="m"><span class="status ">لم تبدأ</span></div><div class="s"><strong>الزمالك</strong><b> - </b></div>
      <div class="match-aux"><span>استاد خالد بشارة</span><span>On Sport MAX</span><span>23-11-2026 - 17:00</span></div>
      </a></div>`;
    vi.stubGlobal('fetch', async (url: string) => {
      const body = String(url).includes('/matches/375939') && !String(url).includes('?date=')
        ? detailHtml
        : String(url).includes('filgoal')
          ? `<div data-matches-scroller>${listHtml}</div>`
          : '<html></html>';
      return new Response(body, { status: 200 });
    });
    try {
      const res = await app.request('/api/football/matches/fg-375939?date=2026-11-23');
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as {
        data: { match: { home: string }; detail: { commentator: string | null } | null };
      };
      expect(data.match.home).toBe('الجونة');
      expect(data.detail?.commentator).toBe('بلال علام');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('serves competitions in priority order, Egypt first', async () => {
    // The user's #25: every grouping must lead with الدوري المصري.
    const res = await app.request('/api/football/competitions');
    const { data } = (await res.json()) as { data: Array<{ id: string; priority: number }> };
    expect(data[0]!.id).toBe('egyptian-premier');
    const prios = data.map((c) => c.priority);
    expect([...prios].sort((a, b) => a - b)).toEqual(prios);
    // The field is served, so a per-user order (#26) can reuse it later.
    for (const c of data) expect(typeof c.priority).toBe('number');
  });

  it('carries the competition priority on every match row', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        `<div data-matches-scroller><h6><span>الدوري المصري</span></h6>
         <div class="cin_cntnr"><a href="/matches/1/x"><div class="f"><strong>الأهلي</strong><b> 1 </b></div>
         <div class="m"><span class="status over">انتهت</span></div>
         <div class="s"><strong>بيراميدز</strong><b> 0</b></div>
         <div class="match-aux"><span>23-11-2026 - 20:00</span></div></a></div></div>`,
        { status: 200 },
      ),
    );
    try {
      const res = await app.request('/api/football/matches?date=2026-11-23');
      const { data } = (await res.json()) as { data: { matches: Array<{ competitionPriority?: number }> } };
      expect(data.matches[0]!.competitionPriority).toBe(10);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('serves a competition page with its table and fixtures', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('/tour-standing/160')) {
        // A 7-column table, like the real one.
        const rows = ['بيراميدز', 'الأهلي'].map((n, i) =>
          `<div class="wRow"><div class="item arrng">${i + 1}</div><div class="item team"><a href="/t/${i}"><p>${n}</p></a></div>` +
          ['8', '7', '1', '0', '19', '4', '22'].map((v) => `<div class="item dtls"> ${v} </div>`).join('') +
          '</div>').join('');
        return new Response(`<div class="grpHdr">المجموعة 1</div>${rows}`, { status: 200 });
      }
      // Days: one Egyptian fixture tomorrow.
      return new Response(
        `<div data-matches-scroller><h6><span>الدوري المصري</span></h6>
         <div class="cin_cntnr"><a href="/matches/9/x"><div class="f"><strong>الأهلي</strong><b> - </b></div>
         <div class="m"><span class="status ">لم تبدأ</span></div>
         <div class="s"><strong>بيراميدز</strong><b> - </b></div>
         <div class="match-aux"><span>23-11-2026 - 20:00</span></div></a></div></div>`,
        { status: 200 },
      );
    });
    try {
      const res = await app.request('/api/football/competitions/egyptian-premier');
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as {
        data: { nameAr: string; standings: Array<{ team: string }> | null; upcoming: unknown[] };
      };
      expect(data.nameAr).toBe('الدوري المصري');
      expect(data.standings?.length).toBeGreaterThan(0);
      expect(Array.isArray(data.upcoming)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('404s an unknown competition and an empty team name', async () => {
    vi.stubGlobal('fetch', async () => new Response('<div data-matches-scroller></div>', { status: 200 }));
    try {
      expect((await app.request('/api/football/competitions/nope')).status).toBe(404);
      expect((await app.request('/api/football/teams/%20')).status).toBe(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('serves a team page for a real club name', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(
        `<div data-matches-scroller><h6><span>الدوري المصري</span></h6>
         <div class="cin_cntnr"><a href="/matches/9/x"><div class="f"><strong>الأهلي</strong><b> - </b></div>
         <div class="m"><span class="status ">لم تبدأ</span></div>
         <div class="s"><strong>بيراميدز</strong><b> - </b></div>
         <div class="match-aux"><span>23-11-2026 - 20:00</span></div></a></div></div>`,
        { status: 200 },
      ),
    );
    try {
      const res = await app.request(`/api/football/teams/${encodeURIComponent('الأهلي')}`);
      expect(res.status).toBe(200);
      const { data } = (await res.json()) as { data: { name: string; upcoming: unknown[] } };
      expect(data.name).toBe('الأهلي');
      expect(Array.isArray(data.upcoming)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
