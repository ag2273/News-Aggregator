import { describe, it, expect } from 'vitest';
import { buildFollowCatalog } from '../followCatalog.js';
import { storeDay, storeStandings, _resetFootballCache } from '../footballStore.js';
import type { MatchRow, StandingRow } from '../football.js';

const row = (over: Partial<MatchRow>): MatchRow => ({
  id: 'x',
  competitionId: 'egyptian-premier',
  competitionName: 'الدوري المصري',
  home: 'الأهلي',
  away: 'بيراميدز',
  homeScore: null,
  awayScore: null,
  status: 'upcoming',
  statusText: 'لم تبدأ',
  kickoff: '20:00',
  round: null,
  minute: null,
  dataSource: 'filgoal',
  ...over,
});

const standing = (over: Partial<StandingRow> & { team: string; position: number }): StandingRow => ({
  played: 8,
  won: 5,
  drawn: 2,
  lost: 1,
  goalsFor: 15,
  goalsAgainst: 6,
  points: 17,
  ...over,
});

const today = (): string => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

describe('follow catalogue', () => {
  it('builds clubs from the tables we already cache, Egypt first', () => {
    _resetFootballCache();
    storeStandings('egyptian-premier', [
      {
        competitionId: 'egyptian-premier',
        group: null,
        hasFullRecord: false,
        rows: [
          standing({ team: 'بيراميدز', position: 1, logo: '/api/football/logo/yallakora:2728', logoSource: 'https://x/2728.png', teamId: '2728' } as StandingRow),
          standing({ team: 'الأهلي', position: 2 }),
        ],
      },
    ]);
    storeStandings('eng-premier', [
      {
        competitionId: 'eng-premier',
        group: null,
        hasFullRecord: true,
        rows: [standing({ team: 'ليفربول', position: 4 })],
      },
    ]);

    const { sections } = buildFollowCatalog({ matches: [] });
    const egypt = sections.find((s) => s.id === 'egypt');
    const europe = sections.find((s) => s.id === 'europe');

    // Egypt is its own section, and it comes first — the whole point of the order.
    expect(sections[0]!.id).toBe('egypt');
    expect(egypt!.teams.map((x) => x.name)).toEqual(['بيراميدز', 'الأهلي']);
    expect(europe!.teams.map((x) => x.name)).toContain('ليفربول');

    // The crest and the position are carried through, so the card can draw them.
    expect(egypt!.teams[0]!.logo).toBe('/api/football/logo/yallakora:2728');
    expect(egypt!.teams[0]!.position).toBe(1);
  });

  it('names Egypt properly instead of «منتخب»', () => {
    _resetFootballCache();
    const { sections } = buildFollowCatalog({ matches: [] });
    const national = sections.find((s) => s.id === 'national');
    expect(national).toBeTruthy();
    expect(national!.teams[0]!.name).toBe('منتخب مصر');
    expect(national!.teams[0]!.flag).toBe('🇪🇬');
    // The bare word the user complained about is never a team name.
    expect(national!.teams.some((x) => x.name === 'منتخب')).toBe(false);
  });

  it('attaches each club its next cached fixture, and nothing when there is none', () => {
    _resetFootballCache();
    storeStandings('egyptian-premier', [
      {
        competitionId: 'egyptian-premier',
        group: null,
        hasFullRecord: false,
        rows: [standing({ team: 'الأهلي', position: 2 })],
      },
    ]);
    storeDay(today(), [
      row({ id: 'a', home: 'الأهلي', away: 'بيراميدز', kickoff: '20:00' }),
      row({ id: 'b', home: 'الأهلي', away: 'الزمالك', kickoff: '22:00' }),
    ]);

    const egypt = buildFollowCatalog().sections.find((s) => s.id === 'egypt')!;
    const ahly = egypt.teams.find((x) => x.name === 'الأهلي')!;
    // The earlier kickoff is the next one, and the opponent is the other side.
    expect(ahly.nextMatch).toEqual({ opponent: 'بيراميدز', kickoff: '20:00', isHome: true });
  });

  it('says a club has no fixture rather than inventing one', () => {
    _resetFootballCache();
    storeStandings('egyptian-premier', [
      {
        competitionId: 'egyptian-premier',
        group: null,
        hasFullRecord: false,
        rows: [standing({ team: 'سموحة', position: 9 })],
      },
    ]);
    const egypt = buildFollowCatalog({ matches: [] }).sections.find((s) => s.id === 'egypt')!;
    expect(egypt.teams[0]!.nextMatch).toBeNull();
  });

  it('contributes nothing for a league whose table was never read', () => {
    // A guessed roster is worse than an empty section: the reader would follow a
    // name we cannot then show a match for.
    _resetFootballCache();
    const { sections } = buildFollowCatalog({ matches: [] });
    expect(sections.some((s) => s.id === 'europe')).toBe(false);
    // The national teams are the one fixed list, so they are still there.
    expect(sections.some((s) => s.id === 'national')).toBe(true);
  });
});
