import { describe, it, expect, beforeEach } from 'vitest';
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
    expect(data.length).toBe(10);
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

    const competition = { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', yallakoraName: 'الدوري الإنجليزي', yallakoraTourId: '93', espnSlug: 'eng.1', country: 'GB' };
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
    const competition = { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', yallakoraName: 'الدوري الإنجليزي', yallakoraTourId: '93', espnSlug: 'eng.1', country: 'GB' };
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
});
