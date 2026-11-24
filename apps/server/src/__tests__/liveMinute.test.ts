// The live minute (issue #36): ESPN's clock, and the pairings it is allowed to feed.
//
// Every fixture in here is a real payload shape captured from ESPN on 2026-11-24
// while a Champions League match was being played, including the half-time
// interval and the end-of-match stoppage time that the first measurement missed.
// The values are quoted, not invented: `clock` is ESPN's seconds field, and
// `displayClock`/`type.detail` are its own text.

import { describe, it, expect } from 'vitest';
import { espnClockLabel, parseEspnClock, halfText, isPlaying } from '../espnClock.js';
import {
  ESPN_CLUB_NAMES,
  arabicNameOf,
  clubKey,
  espnNameOf,
  sameClubs,
} from '../espnLink.js';
import { parseEspnLive, clockFor } from '../espnLive.js';
import { applyLiveClocks } from '../footballService.js';
import { hasLiveForReader, parseEspnScoreboard, type Competition, type MatchRow } from '../football.js';

/** A scoreboard event as ESPN sends it, with the fields we read. */
const event = (
  home: string,
  away: string,
  status: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  id: '401915300',
  date: '2026-11-24T17:45Z',
  competitions: [
    {
      status,
      competitors: [
        { homeAway: 'home', team: { displayName: home }, score: '1' },
        { homeAway: 'away', team: { displayName: away }, score: '0' },
      ],
      ...extra,
    },
  ],
});

const SECOND_HALF_84 = {
  clock: 5040,
  displayClock: "84'",
  period: 2,
  type: { state: 'in', name: 'STATUS_SECOND_HALF', detail: "84'", description: 'Second Half' },
};

const HALFTIME = {
  clock: 2700,
  displayClock: "45'",
  period: 2,
  type: { state: 'in', name: 'STATUS_HALFTIME', detail: 'HT', description: 'Half Time' },
};

const FIRST_HALF_05 = {
  clock: 300,
  displayClock: "5'",
  period: 1,
  type: { state: 'in', name: 'STATUS_FIRST_HALF', detail: "5'", description: 'First Half' },
};

const STOPPAGE_90_PLUS_4 = {
  clock: 5400,
  displayClock: "90'+4'",
  period: 2,
  type: { state: 'in', name: 'STATUS_IN_PROGRESS', detail: "90'+4'", description: 'In Progress' },
};

const competition: Competition = {
  id: 'uefa-champions',
  nameAr: 'دوري أبطال أوروبا',
  yallakoraName: 'دوري أبطال أوروبا',
  yallakoraTourId: '105',
  espnSlug: 'uefa.champions',
  country: 'EU',
  priority: 30,
};

describe('ESPN clock: the minute is real, in the provider’s own words', () => {
  it('reads a plain live minute', () => {
    const clock = parseEspnClock(SECOND_HALF_84)!;
    expect(clock.label).toBe("84'");
    expect(clock.minute).toBe(84);
    expect(clock.period).toBe(2);
    expect(clock.halftime).toBe(false);
    expect(clock.added).toBeNull();
  });

  it('keeps published stoppage time as text instead of computing a number', () => {
    // Measured live on 2026-11-24: ESPN sends "90'+4'" while the state is still
    // `in`. Turning that into 94 would be our arithmetic, not their statement.
    const clock = parseEspnClock(STOPPAGE_90_PLUS_4)!;
    expect(clock.label).toBe("90'+4'");
    expect(clock.minute).toBe(90);
    expect(clock.added).toBe(4);
    expect(clock.halftime).toBe(false);
  });

  it('marks the half-time interval, which the state alone does not', () => {
    const clock = parseEspnClock(HALFTIME)!;
    expect(clock.halftime).toBe(true);
    expect(isPlaying(clock)).toBe(false);
    expect(halfText(clock)).toBe('استراحة');
  });

  it('treats a playing minute as playing', () => {
    expect(isPlaying(parseEspnClock(FIRST_HALF_05)!)).toBe(true);
  });

  it('never reports a minute before kickoff or after the whistle', () => {
    expect(parseEspnClock({ displayClock: "0'", period: 0, type: { state: 'pre' } })).toBeNull();
    expect(parseEspnClock({ displayClock: "90'+4'", period: 2, type: { state: 'post' } })).toBeNull();
  });

  it('refuses a label it cannot read rather than guessing one', () => {
    expect(espnClockLabel('')).toBeNull();
    expect(espnClockLabel("0'")).toBeNull();
    expect(espnClockLabel('Second Half')).toBeNull();
    expect(espnClockLabel(42)).toBeNull();
  });

  it('names the half only when the provider states it', () => {
    expect(halfText(parseEspnClock({ ...FIRST_HALF_05, period: 1 })!)).toBe('الشوط الأول');
    expect(halfText(parseEspnClock({ ...SECOND_HALF_84, period: 2 })!)).toBe('الشوط الثاني');
    // No period and no interval: nothing to name.
    expect(halfText(parseEspnClock({ displayClock: "30'", type: { state: 'in' } })!)).toBeNull();
  });
});

describe('ESPN fixtures carry the clock into our own rows', () => {
  it('shows the minute and the half on a live ESPN row', () => {
    const rows = parseEspnScoreboard({ events: [event('Arsenal', 'Borussia Dortmund', SECOND_HALF_84)] }, competition);
    const row = rows[0]!;
    expect(row.minute).toBe(84);
    expect(row.minuteLabel).toBe("84'");
    expect(row.half).toBe('الشوط الثاني');
    expect(row.status).toBe('live');
    expect(row.halftime).toBe(false);
  });

  it('shows «استراحة» and no minute through the interval', () => {
    // The trap that made a naive `state === 'in'` wrong: the clock sits on 45 for
    // 14-15 minutes, so a frozen 45 beside a live dot reads as a match being played.
    const row = parseEspnScoreboard({ events: [event('Arsenal', 'Borussia Dortmund', HALFTIME)] }, competition)[0]!;
    expect(row.statusText).toBe('استراحة');
    expect(row.minute).toBeNull();
    expect(row.halftime).toBe(true);
    expect(row.status).toBe('live');
  });

  it('keeps ESPN’s stoppage-time wording on the row', () => {
    const row = parseEspnScoreboard({ events: [event('Arsenal', 'Borussia Dortmund', STOPPAGE_90_PLUS_4)] }, competition)[0]!;
    expect(row.minuteLabel).toBe("90'+4'");
    expect(row.minute).toBe(90);
  });

  it('leaves a not-started match with no minute at all', () => {
    const row = parseEspnScoreboard(
      { events: [event('Arsenal', 'Borussia Dortmund', { displayClock: "0'", period: 0, type: { state: 'pre' } })] },
      competition,
    )[0]!;
    expect(row.minute).toBeNull();
    expect(row.minuteLabel).toBeNull();
    expect(row.status).toBe('upcoming');
  });
});

describe('linking an ESPN fixture to ours is by club, not by kickoff', () => {
  it('knows the Arabic spelling of the clubs we cover', () => {
    expect(arabicNameOf('Arsenal')).toBe('أرسنال');
    expect(arabicNameOf('Galatasaray')).toBe('جالاتا سراي');
    expect(arabicNameOf('Al Ahli')).toBe('أهلي جدة');
    // A club outside the table is not guessed at.
    expect(arabicNameOf('Some Unlisted FC')).toBeNull();
  });

  it('resolves the alternate spellings the fixture list actually uses', () => {
    // Measured variants: FilGoal's fixture list writes these differently from its
    // own league table.
    expect(espnNameOf('نيوكاسل يونايتد')).toBe('Newcastle United');
    expect(espnNameOf('لايبزج')).toBe('RB Leipzig');
    expect(espnNameOf('إنتر')).toBe('Internazionale');
    expect(espnNameOf('ماينز 05')).toBe('Mainz');
    // Arabic «الأهلي» is Egyptian Al Ahly in most rows, so it is deliberately NOT
    // mapped to the Saudi club; the mapping lives on the full name instead.
    expect(espnNameOf('أهلي جدة')).toBe('Al Ahli');
  });

  it('refuses a club it does not know instead of a fuzzy match', () => {
    expect(sameClubs('Arsenal', 'Borussia Dortmund', 'فريق مجهول', 'بوروسيا دورتموند')).toBe(false);
  });

  it('accepts the same fixture with the sides the other way round', () => {
    expect(sameClubs('Arsenal', 'Borussia Dortmund', 'بوروسيا دورتموند', 'أرسنال')).toBe(true);
  });

  it('will not pair two different fixtures that share a club', () => {
    expect(sameClubs('Arsenal', 'Borussia Dortmund', 'أرسنال', 'مانشستر سيتي')).toBe(false);
  });

  it('reads only live events out of a scoreboard, keeping the interval as its own state', () => {
    const live = parseEspnLive({
      events: [
        event('Arsenal', 'Borussia Dortmund', SECOND_HALF_84),
        event('Arsenal', 'Borussia Dortmund', { displayClock: "0'", period: 0, type: { state: 'pre' } }),
        event('Arsenal', 'Borussia Dortmund', { displayClock: "90'+4'", period: 2, type: { state: 'post' } }),
        event('Arsenal', 'Chesterfield', SECOND_HALF_84),
        event('Arsenal', 'Borussia Dortmund', HALFTIME),
      ],
    });
    // The unstarted, the finished and the unmapped one are dropped; the interval is
    // kept so the row can say so.
    expect(live).toHaveLength(2);
    expect(live[0]!.homeEn).toBe('Arsenal');
    expect(live[0]!.clock.minute).toBe(84);
    expect(live[1]!.clock.halftime).toBe(true);
  });

  it('refuses to choose when two events claim the same club pair', () => {
    const live = parseEspnLive({
      events: [
        event('Arsenal', 'Borussia Dortmund', SECOND_HALF_84),
        event('Arsenal', 'Borussia Dortmund', FIRST_HALF_05),
      ],
    });
    expect(clockFor(live, 'أرسنال', 'بوروسيا دورتموند')).toBeNull();
  });

  it('has one spelling per club, so a lookup cannot disagree with itself', () => {
    // Every Arabic spelling in the table must resolve back to a known club, and two
    // different clubs must never share a folded key — that is how a wrong minute
    // would reach the screen.
    const seen = new Map<string, string>();
    for (const [en, names] of Object.entries(ESPN_CLUB_NAMES)) {
      for (const spelling of [names.ar, ...(names.seen ?? [])]) {
        const key = clubKey(spelling);
        const owner = seen.get(key);
        expect(owner === undefined || owner === en).toBe(true);
        seen.set(key, en);
      }
    }
  });
});

describe('the borrowed clock only ever touches a live row', () => {
  const base: MatchRow = {
    id: 'fg-1',
    competitionId: 'uefa-champions',
    competitionName: 'دوري أبطال أوروبا',
    home: 'أرسنال',
    away: 'بوروسيا دورتموند',
    homeScore: 1,
    awayScore: 0,
    status: 'live',
    statusText: 'الشوط الاول',
    kickoff: '19:45',
    round: null,
    minute: null,
    dataSource: 'filgoal',
  };

  const live = parseEspnLive({ events: [event('Arsenal', 'Borussia Dortmund', SECOND_HALF_84)] });

  it('adds ESPN’s minute to the matching live fixture', () => {
    const [row] = applyLiveClocks([base], live);
    expect(row!.minute).toBe(84);
    expect(row!.minuteLabel).toBe("84'");
    expect(row!.half).toBe('الشوط الثاني');
    expect(row!.halftime).toBe(false);
  });

  it('leaves a fixture ESPN does not cover untouched', () => {
    const egyptian: MatchRow = { ...base, id: 'fg-2', competitionId: 'egyptian-premier', home: 'المصري', away: 'بترول أسيوط' };
    const [row] = applyLiveClocks([egyptian], live);
    expect(row!.minute).toBeNull();
    expect(row!.minuteLabel).toBeUndefined();
    expect(row!.half).toBeUndefined();
  });

  it('never touches a finished or upcoming row', () => {
    const finished: MatchRow = { ...base, status: 'finished', statusText: 'انتهت', minute: null };
    const upcoming: MatchRow = { ...base, id: 'fg-3', status: 'upcoming', statusText: 'لم تبدأ', minute: null };
    const [a, b] = applyLiveClocks([finished, upcoming], live);
    expect(a!.minute).toBeNull();
    expect(a!.half).toBeUndefined();
    expect(b!.minute).toBeNull();
    expect(b!.half).toBeUndefined();
  });

  it('turns the interval into «استراحة» and drops the frozen clock', () => {
    const interval = parseEspnLive({ events: [event('Arsenal', 'Borussia Dortmund', HALFTIME)] });
    const [row] = applyLiveClocks([base], interval);
    expect(row!.statusText).toBe('استراحة');
    expect(row!.halftime).toBe(true);
    expect(row!.minute).toBeNull();
  });

  it('does nothing at all when there is no live data to borrow', () => {
    const rows = applyLiveClocks([base], []);
    expect(rows[0]).toBe(base);
  });
});

describe('the borrowed clock is polite to the source', () => {
  it('fetches one scoreboard burst per day, not one per reader', async () => {
    const { fetchEspnLiveDay, resetLiveCache, espnCompetitions } = await import('../espnLive.js');
    resetLiveCache();
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ events: [] }),
      } as unknown as Response;
    };
    // Three readers open the matches screen inside the same minute.
    await fetchEspnLiveDay('2026-11-24', fakeFetch);
    const afterFirst = calls;
    await fetchEspnLiveDay('2026-11-24', fakeFetch);
    await fetchEspnLiveDay('2026-11-24', fakeFetch);
    expect(afterFirst).toBe(espnCompetitions().length);
    expect(calls).toBe(afterFirst);
  });

  it('does not fetch at all when nothing is live', async () => {
    const { enrichLiveClocks } = await import('../footballService.js');
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ events: [] }) } as unknown as Response;
    };
    const finished = [
      {
        id: 'x', competitionId: 'uefa-champions', competitionName: 'دوري أبطال أوروبا',
        home: 'أرسنال', away: 'بوروسيا دورتموند', homeScore: 1, awayScore: 0,
        status: 'finished' as const, statusText: 'انتهت', kickoff: '22:00', round: null,
        minute: null, dataSource: 'filgoal' as const,
      },
    ];
    const out = await enrichLiveClocks(finished, '2026-11-24', { fetchImpl: fakeFetch });
    expect(calls).toBe(0);
    expect(out[0]!.minute).toBeNull();
  });
});

describe('the header live dot means a match being PLAYED', () => {
  const row: MatchRow = {
    id: 'x',
    competitionId: 'egyptian-premier',
    competitionName: 'الدوري المصري',
    home: 'الأهلي',
    away: 'الزمالك',
    homeScore: 1,
    awayScore: 0,
    status: 'live',
    statusText: 'الشوط الأول',
    kickoff: '20:00',
    round: null,
    minute: null,
    dataSource: 'filgoal',
  };

  it('is on for an Egyptian match in play', () => {
    expect(hasLiveForReader([row])).toBe(true);
  });

  it('is off through the half-time interval', () => {
    // ESPN keeps `state: "in"` for 14-15 minutes at half-time; the dot must not.
    expect(hasLiveForReader([{ ...row, halftime: true }])).toBe(false);
  });
});
