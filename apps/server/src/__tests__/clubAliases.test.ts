// One club, two names (issue #47).
//
// The reported case was «صباح باكو» × «صباح إف كيه»: one fixture listed twice
// because one feed names the club and the other names its city. Every assertion
// here is about the READER'S screen, and every pairing is anchored on the club's
// official name from an outside source — see `clubAliases.ts`.

import { describe, it, expect } from 'vitest';
import { canonicalClub, isAliasedClub, CLUB_ALIASES } from '../clubAliases.js';
import { mergeDay } from '../footballService.js';
import type { MatchRow } from '../football.js';

const row = (over: Partial<MatchRow>): MatchRow => ({
  id: 'x',
  competitionId: 'uefa-champions',
  competitionName: 'دوري أبطال أوروبا',
  home: 'صباح إف كيه',
  away: 'برشلونة',
  homeScore: null,
  awayScore: null,
  status: 'upcoming',
  statusText: 'لم تبدأ',
  kickoff: '19:45',
  round: null,
  minute: null,
  dataSource: 'filgoal',
  ...over,
});

describe('the alias table names one club one way', () => {
  it('folds the city name onto the club name', () => {
    // The user's report: FilGoal wrote «صباح باكو» (Baku, the city) and the app
    // showed it as a separate club. ESPN calls the club "Sabah FK".
    expect(canonicalClub('صباح باكو')).toBe('صباح إف كيه');
    expect(canonicalClub('صباح إف كيه')).toBe('صباح إف كيه');
  });

  it('keeps a club it does not know exactly as written', () => {
    expect(canonicalClub('برشلونة')).toBe('برشلونة');
    expect(canonicalClub('ريال مدريد')).toBe('ريال مدريد');
    expect(isAliasedClub('برشلونة')).toBe(false);
  });

  it('folds both spellings to the SAME string, which is what merges the rows', () => {
    for (const pair of CLUB_ALIASES) {
      expect(canonicalClub(pair.from)).toBe(canonicalClub(pair.to));
    }
  });

  it('never lets one spelling stand for two clubs', () => {
    // Two entries sharing a spelling would merge two real clubs' fixtures. The
    // module refuses to load in that case, so asserting the table is enough.
    const seen = new Set<string>();
    for (const pair of CLUB_ALIASES) {
      for (const spelling of [pair.from, pair.to]) {
        expect(seen.has(spelling)).toBe(false);
        seen.add(spelling);
      }
    }
  });

  it('carries an outside source for every pairing, so it can be re-checked', () => {
    for (const pair of CLUB_ALIASES) {
      expect(pair.official.length).toBeGreaterThan(2);
      expect(pair.source).toMatch(/ESPN/);
    }
  });
});

describe('the reported fixture is one row', () => {
  it('merges «صباح باكو» and «صباح إف كيه» into a single match', () => {
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', home: 'صباح باكو', away: 'برشلونة' })],
      [row({ id: 'yk', dataSource: 'yallakora', home: 'صباح إف كيه', away: 'برشلونة' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('shows the club name, never the city name', () => {
    // Even on a day when only the FilGoal row exists, the screen must not print a
    // name that is not a club.
    const merged = mergeDay([row({ dataSource: 'filgoal', home: 'صباح باكو' })], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.home).toBe('صباح إف كيه');
    expect(merged[0]!.home).not.toBe('صباح باكو');
  });

  it('collapses the duplicate when the sides are the other way round', () => {
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', home: 'برشلونة', away: 'صباح باكو' })],
      [row({ id: 'yk', dataSource: 'yallakora', home: 'برشلونة', away: 'صباح إف كيه' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('does not merge two genuinely different clubs that share a city', () => {
    // Both clubs are in Baku, and they are not the same club.
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', home: 'صباح باكو', away: 'برشلونة' })],
      [row({ id: 'yk', dataSource: 'yallakora', home: 'نيفتشي باكو', away: 'برشلونة' })],
    );
    expect(merged).toHaveLength(2);
  });

  it('keeps the preferred row and therefore its match page', () => {
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', home: 'صباح باكو', providerMatchId: '379105' })],
      [row({ id: 'yk', dataSource: 'yallakora', home: 'صباح إف كيه' })],
    );
    expect(merged[0]!.dataSource).toBe('filgoal');
    // The id the detail screen opens must survive the merge.
    expect(merged[0]!.id).toBe('x');
  });
});

describe('the Saudi club named two ways is one row', () => {
  it('merges «الأهلي» with «أهلي جدة» in the Saudi league', () => {
    // Found while measuring #47: these two rules ran on the RAW name, before
    // normalisation folded أ→ا and ة→ه, so they never matched and the fixture was
    // listed twice.
    const merged = mergeDay(
      [
        row({
          competitionId: 'saudi-pro-league',
          competitionName: 'الدوري السعودي',
          home: 'الشمال',
          away: 'الأهلي',
        }),
      ],
      [
        row({
          id: 'yk',
          dataSource: 'yallakora',
          competitionId: 'saudi-pro-league',
          competitionName: 'الدوري السعودي',
          home: 'الشمال',
          away: 'أهلي جدة',
        }),
      ],
    );
    expect(merged).toHaveLength(1);
  });
});
