import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  arabicTeam,
  cairoClock,
  arabicChannel,
  hasLiveForReader,
  isFootballLeague,
  minuteOf,
  parseEspnScoreboard,
  parseFullStandings,
  parseYallakoraDay,
  parseYallakoraStandings,
  statusOf,
  type Competition,
} from '../football.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => fs.readFileSync(path.join(here, 'fixtures', name), 'utf8');

describe('Yallakora day page', () => {
  const rows = parseYallakoraDay(fixture('day-live.html'), '2026-11-22');

  it('reads every match on the page', () => {
    expect(rows).toHaveLength(30);
  });

  it('keeps Arabic team names as the source words them', () => {
    // The whole reason Yallakora is the primary source: no Latin filler.
    const names = rows.map((r) => `${r.home} ${r.away}`).join(' ');
    expect(names).toMatch(/ليفربول|برشلونة|يوفنتوس/);
    expect(names).not.toMatch(/Liverpool|Barcelona/);
  });

  it('marks a live match live, with its real score', () => {
    const live = rows.filter((r) => r.status === 'live');
    expect(live.length).toBeGreaterThan(0);
    // «الشوط الثاني» is the second half; treating it as unknown would drop a
    // live match off the live filter entirely.
    const secondHalf = live.find((r) => r.statusText.includes('الشوط'));
    expect(secondHalf).toBeDefined();
    expect(secondHalf!.homeScore).not.toBeNull();
    expect(secondHalf!.awayScore).not.toBeNull();
  });

  it('gives a kickoff time only for matches that have not started', () => {
    const upcoming = rows.filter((r) => r.status === 'upcoming');
    expect(upcoming.length).toBeGreaterThan(0);
    for (const m of upcoming) expect(m.kickoff).toMatch(/^\d{2}:\d{2}$/);
    // A source dash means "no score", not zero goals.
    for (const m of upcoming) expect(m.homeScore).toBeNull();
  });

  it('never lists a handball match on a football screen', () => {
    // «كرة يد - السوبر المصري» appears under the same page as a league heading.
    for (const m of rows) expect(isFootballLeague(m.competitionName)).toBe(true);
    expect(rows.some((r) => /كرة يد/.test(r.competitionName))).toBe(false);
  });

  it('maps a league heading to our competition id and Arabic name', () => {
    // This day has European leagues but no Egyptian fixture, which is the normal
    // case — the Egyptian league is one of ten headings, not a default.
    const epl = rows.filter((r) => r.competitionId === 'eng-premier');
    expect(epl.length).toBeGreaterThan(0);
    expect(epl[0]!.competitionName).toBe('الدوري الإنجليزي');
    // An unmapped heading must not become «undefined» on screen.
    for (const m of rows) expect(m.competitionName.length).toBeGreaterThan(2);
  });
});

describe('Yallakora standings, full route', () => {
  it('reads all 20 English clubs with win/draw/loss', () => {
    const tables = parseFullStandings(fixture('standings-epl-full.html'), 'eng-premier');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows).toHaveLength(20);
    expect(tables[0]!.hasFullRecord).toBe(true);
    const arsenal = tables[0]!.rows[0]!;
    expect(arsenal.team).toBe('أرسنال');
    expect(arsenal.played).toBe(11);
    expect(arsenal.won + arsenal.drawn + arsenal.lost).toBe(11);
    expect(arsenal.points).toBe(28);
  });

  it('refuses an all-zero table instead of publishing it as fact', () => {
    // The full route returns every club on 0 played and 0 points for the
    // Egyptian league; shown as a table it would read as "nothing has happened".
    expect(parseFullStandings(fixture('standings-egypt-full.html'), 'egyptian-premier')).toEqual([]);
  });
});

describe('Yallakora standings, short route', () => {
  it('reads the 20-team Egyptian league as ONE table, not 4 + 16', () => {
    // A fixed-size window around the group heading split this table in half.
    const tables = parseYallakoraStandings(fixture('standings-egypt.html'), 'egyptian-premier');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows).toHaveLength(20);
    expect(tables[0]!.rows[0]!.team).toBe('بيراميدز');
    expect(tables[0]!.rows[0]!.points).toBe(24);
    expect(tables[0]!.rows[1]!.team).toBe('الأهلي');
  });

  it('does not label a single-table league phase as «المجموعة 1»', () => {
    const tables = parseYallakoraStandings(fixture('standings-ucl.html'), 'uefa-champions');
    expect(tables).toHaveLength(1);
    expect(tables[0]!.group).toBeNull();
    expect(tables[0]!.rows).toHaveLength(36);
  });

  it('drops the trailing all-zero duplicate row', () => {
    const tables = parseYallakoraStandings(fixture('standings-ucl.html'), 'uefa-champions');
    const teams = tables[0]!.rows.map((r) => r.team);
    expect(new Set(teams).size).toBe(teams.length);
    expect(tables[0]!.rows.every((r) => r.played > 0)).toBe(true);
  });

  it('says a cup has no table rather than inventing one', () => {
    expect(parseFullStandings(fixture('standings-cup.html'), 'egypt-cup')).toEqual([]);
  });
});

describe('status vocabulary', () => {
  it('maps every word measured on 24 days of pages', () => {
    expect(statusOf('لم تبدأ')).toBe('upcoming');
    expect(statusOf('انتهت')).toBe('finished');
    expect(statusOf('مباشر')).toBe('live');
    expect(statusOf('الشوط الثاني')).toBe('live');
    expect(statusOf("67'")).toBe('live');
  });

  it('reads a minute out of a status word when there is one', () => {
    expect(minuteOf("67'")).toBe(67);
    expect(minuteOf('مباشر')).toBeNull();
    expect(minuteOf("999'")).toBeNull();
  });
});

describe('ESPN fallback', () => {
  const competition: Competition = {
    id: 'eng-premier',
    nameAr: 'الدوري الإنجليزي',
    yallakoraName: 'الدوري الإنجليزي',
    yallakoraTourId: '93',
    espnSlug: 'eng.1',
    country: 'GB',
  };
  const payload = {
    events: [
      {
        id: '1',
        date: '2026-11-22T14:00Z',
        competitions: [
          {
            status: { type: { state: 'pre', detail: 'Sun, November 22nd at 9:00 AM EST' }, displayClock: "0'" },
            competitors: [
              { homeAway: 'home', team: { displayName: 'Liverpool' }, score: '0' },
              { homeAway: 'away', team: { displayName: 'Manchester United' }, score: '0' },
            ],
          },
        ],
      },
    ],
  };

  it('translates the club names into Arabic', () => {
    const rows = parseEspnScoreboard(payload, competition);
    expect(rows[0]!.home).toBe('ليفربول');
    expect(rows[0]!.away).toBe('مانشستر يونايتد');
  });

  it('converts the kickoff from UTC to Cairo time', () => {
    expect(parseEspnScoreboard(payload, competition)[0]!.kickoff).toBe('16:00');
  });

  it('never shows a false 0-0 before kickoff, and never English status', () => {
    const row = parseEspnScoreboard(payload, competition)[0]!;
    expect(row.homeScore).toBeNull();
    expect(row.awayScore).toBeNull();
    expect(row.statusText).toBe('لم تبدأ');
    expect(row.statusText).not.toMatch(/[A-Za-z]{3,}/);
  });

  it('keeps an unmapped club name rather than blanking it', () => {
    expect(arabicTeam('Some FC')).toBe('Some FC');
  });

  it('shifts a late kickoff across midnight', () => {
    expect(cairoClock('2026-11-22T22:30Z')).toBe('00:30');
  });
});

describe('header live dot', () => {
  const base = {
    id: 'x', competitionId: 'eng-premier', competitionName: 'الدوري الإنجليزي',
    home: 'ليفربول', away: 'أرسنال', homeScore: 1, awayScore: 0,
    status: 'live' as const, statusText: 'مباشر', kickoff: '20:00',
    round: null, minute: 30, dataSource: 'yallakora' as const, channel: null,
  };

  it('stays off when nothing is live', () => {
    expect(hasLiveForReader([{ ...base, status: 'upcoming' }])).toBe(false);
    expect(hasLiveForReader([])).toBe(false);
  });

  it('stays off for an unrelated live European match', () => {
    // A permanent dot would be decoration; the spec ties it to the reader's teams
    // and the Egyptian league.
    expect(hasLiveForReader([base], [])).toBe(false);
  });

  it('lights up for a followed team', () => {
    expect(hasLiveForReader([base], ['ليفربول'])).toBe(true);
    expect(hasLiveForReader([base], ['أرسنال'])).toBe(true);
  });

  it('lights up for the Egyptian league even with no follows', () => {
    expect(
      hasLiveForReader([{ ...base, competitionId: 'egyptian-premier', competitionName: 'الدوري المصري' }], []),
    ).toBe(true);
  });

  it('does not light up for another Egyptian fixture that is not live', () => {
    expect(
      hasLiveForReader(
        [{ ...base, competitionId: 'egyptian-premier', status: 'finished', statusText: 'انتهت' }],
        [],
      ),
    ).toBe(false);
  });
});

describe('broadcast channels', () => {
  it('translates the Latin brand names the source mixes into Arabic rows', () => {
    // Measured on the real day page: beIN arrives in Latin script.
    expect(arabicChannel('beIN SPORTS 2')).toBe('بي إن سبورتس 2');
    expect(arabicChannel('beIN SPORTS 4')).toBe('بي إن سبورتس 4');
    expect(arabicChannel('beIN SPORTS')).toBe('بي إن سبورتس');
  });

  it('leaves an already-Arabic channel name alone', () => {
    expect(arabicChannel('الكأس 7')).toBe('الكأس 7');
  });

  it('passes null through', () => {
    expect(arabicChannel(null)).toBeNull();
  });

  it('keeps SSC, which is the brand name in the region', () => {
    // SSC is written in Latin script even in Arabic copy; translating it would be
    // more confusing than leaving it.
    expect(arabicChannel('SSC 1')).toBe('SSC 1');
  });
});

describe('fetching a live page', () => {
  it('asks the CDN for a fresh copy, not a cached one', async () => {
    // Measured: without no-store, FilGoal's live scores went backwards six times
    // in twenty minutes (a goal appearing then un-appearing) because the edge was
    // serving a stale copy. A score that can regress is worse than a late one.
    const { getPage } = await import('../football.js');
    let seen: Record<string, string> | null = null;
    const fake = (async (_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      return new Response('<html>ok</html>', { status: 200 });
    }) as unknown as typeof fetch;
    await getPage('https://example.test/page', fake);
    expect(seen).not.toBeNull();
    expect(String(seen!['Cache-Control'])).toContain('no-store');
    expect(String(seen!['Pragma'])).toBe('no-cache');
  });
});
