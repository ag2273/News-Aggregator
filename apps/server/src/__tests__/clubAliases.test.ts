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
    // The rule is "an outside source names it", not "ESPN names it": the clubs
    // outside ESPN's eight leagues are anchored on their own Wikipedia article,
    // and the entry says which one. Delta United (Egypt's second tier, on no
    // Wikipedia or ESPN page) is anchored on the live-score site that lists it.
    for (const pair of CLUB_ALIASES) {
      expect(pair.official.length).toBeGreaterThan(2);
      expect(pair.source).toMatch(/ESPN|Wikipedia|sportytrader\.com/);
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
    // Both clubs are in Baku, and they are not the same club. Each plays its own
    // opponent: one club in two fixtures at one kickoff would be the same fixture
    // (#45), so the opponents differ to test the NAME rule alone.
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', home: 'صباح باكو', away: 'برشلونة' })],
      [row({ id: 'yk', dataSource: 'yallakora', home: 'نيفتشي باكو', away: 'ريال مدريد' })],
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

describe('the remaining verified pairs fold too (#48)', () => {
  it.each([
    ['مونتنجرو', 'الجبل الأسود'],
    ['مقدونيا الشمالية', 'مقدونيا'],
    ['لوكسمبورج', 'لوكسمبرج'],
    ['فولام', 'فولهام'],
    ['فينيسيا', 'فينيزيا'],
  ])('folds «%s» onto «%s»', (from, to) => {
    expect(canonicalClub(from)).toBe(to);
    expect(canonicalClub(to)).toBe(to);
  });

  it('merges the reported national-team fixture into one row', () => {
    const merged = mergeDay(
      [row({ competitionId: 'other', competitionName: 'تصفيات أوروبا', home: 'لاتفيا', away: 'مونتنجرو' })],
      [row({ id: 'yk', dataSource: 'yallakora', competitionId: 'other', competitionName: 'تصفيات أوروبا', home: 'لاتفيا', away: 'الجبل الأسود' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('merges a one-letter club variant into one row', () => {
    const merged = mergeDay(
      [row({ competitionId: 'eng-premier', competitionName: 'الدوري الإنجليزي', home: 'مانشستر سيتي', away: 'فولام' })],
      [row({ id: 'yk', dataSource: 'yallakora', competitionId: 'eng-premier', competitionName: 'الدوري الإنجليزي', home: 'مانشستر سيتي', away: 'فولهام' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('records which entries are national teams, so a reader need not guess', () => {
    const national = CLUB_ALIASES.filter((p) => p.kind === 'national').map((p) => p.official).sort();
    expect(national).toEqual([
      'Faroe Islands',
      'Israel national football team',
      'Liechtenstein',
      'Luxembourg',
      'Malta',
      'Montenegro',
      'North Macedonia',
    ]);
    // Everything else in the table is a club.
    for (const pair of CLUB_ALIASES) {
      expect(['club', 'national']).toContain(pair.kind);
    }
  });
});

describe('the national-team and Asian/African pairs fold too (#49)', () => {
  it.each([
    ['جزر الفارو', 'جزر فاروه'],
    ['مالطا', 'مالطة'],
    ['ليختنشتاين', 'ليشتنشتاين'],
    ['نيفتشي فرغانة', 'نيفتشي فرجانة'],
    ['استقلال طهران', 'الإستقلال'],
    ['بوهانج ستيلرز', 'بوهانغ ستيلرز'],
    ['تشونبوك', 'تشونبك هيونداي'],
    ['جوهور دار التعظيم', 'جوهور دارول تاكزيم'],
    ['أوموليس فيلاثلون هراكليوس', 'أوفي كريت'],
    ['شبيبة عمران', 'شبيبة العمران'],
  ])('folds «%s» onto «%s»', (from, to) => {
    expect(canonicalClub(from)).toBe(to);
    expect(canonicalClub(to)).toBe(to);
  });

  it('merges an Asian club the two feeds name differently into one row', () => {
    const merged = mergeDay(
      [row({ competitionId: 'other', competitionName: 'دوري أبطال آسيا', home: 'كيوتو سانجا', away: 'بوهانج ستيلرز' })],
      [row({ id: 'yk', dataSource: 'yallakora', competitionId: 'other', competitionName: 'دوري أبطال آسيا', home: 'كيوتو سانجا', away: 'بوهانغ ستيلرز' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('shows the name the user chose for the national side', () => {
    // The user picked «الكيان الصهيوني» as the displayed label. Both feeds' spellings
    // resolve to it, so one fixture is one row under one name.
    expect(canonicalClub('إسرائيل')).toBe('الكيان الصهيوني');
    expect(canonicalClub('الكيان الصهيوني')).toBe('الكيان الصهيوني');
  });

  it('still keeps two genuinely different clubs apart', () => {
    // The club in Crete and a different Greek club are not the same side.
    expect(canonicalClub('أوفي كريت')).toBe('أوفي كريت');
    expect(canonicalClub('أوليمبياكوس')).toBe('أوليمبياكوس');
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
