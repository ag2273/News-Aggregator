import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFilGoalDetail,
  filGoalChannel,
  filGoalStatus,
  parseFilGoalDay,
  scrollerRegion,
} from '../filgoal.js';
import { canonicalCompetition, type MatchRow } from '../football.js';
import { mergeDay } from '../footballService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => fs.readFileSync(path.join(here, 'fixtures', n), 'utf8');

describe('FilGoal day page', () => {
  const rows = parseFilGoalDay(fixture('filgoal-day-23.html'), '2026-11-23');

  it('reads the day list, not the featured strip', () => {
    // Reading from the top of the document returned the same fixtures for every
    // date. The day list is a separate container, and only it is counted.
    expect(rows.length).toBeGreaterThan(20);
  });

  it('gives the three Egyptian fixtures with stadium and channel', () => {
    const egyptian = rows.filter((r) => r.competitionId === 'egyptian-premier');
    expect(egyptian).toHaveLength(3);
    const gouna = egyptian.find((r) => r.home === 'الجونة');
    expect(gouna).toBeDefined();
    expect(gouna!.away).toBe('الزمالك');
    expect(gouna!.kickoff).toBe('17:00');
    expect(gouna!.channel).toBe('أون سبورت ماكس');
    expect(gouna!.stadium).toContain('بشارة');
    // The id is FilGoal's own, so it can key a notification across refreshes.
    expect(gouna!.matchId).toMatch(/^\d+$/);
  });

  it('keeps a stable id so the same match is recognisable next poll', () => {
    const ids = rows.map((r) => r.matchId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
  });

  it('drops a block whose own stamp belongs to another day', () => {
    // FilGoal's featured strip pins matches from other dates at the top.
    const only24 = parseFilGoalDay(fixture('filgoal-day-23.html'), '2026-11-24');
    expect(only24.length).toBeLessThan(rows.length);
  });

  it('reads a different day as a different day', () => {
    const a = parseFilGoalDay(fixture('filgoal-day-23.html'), '2026-11-23');
    const b = parseFilGoalDay(fixture('filgoal-day-24.html'), '2026-11-24');
    const aIds = new Set(a.map((r) => r.matchId));
    const overlap = b.filter((r) => aIds.has(r.matchId));
    // Consecutive days share almost nothing; the pinned strip is the exception.
    expect(overlap.length).toBeLessThan(a.length);
    expect(b.some((r) => r.competitionId === 'egyptian-premier')).toBe(true);
  });

  it('never reads an age group as a score', () => {
    // «الدنمارك | تحت 17» — reading the first number in the block took the 17 and
    // served a real match as 17-17. The score now comes from the side's own <b>.
    for (const r of rows.filter((x) => x.home.includes('تحت') || x.away.includes('تحت'))) {
      expect(r.homeScore ?? 0).toBeLessThan(17);
      expect(r.awayScore ?? 0).toBeLessThan(17);
    }
  });

  it('shows no false score before kickoff', () => {
    for (const r of rows.filter((x) => x.status === 'upcoming')) {
      expect(r.homeScore).toBeNull();
      expect(r.awayScore).toBeNull();
    }
  });

  it('returns nothing for a page with no day list', () => {
    expect(parseFilGoalDay('<html><body>nothing</body></html>', '2026-11-23')).toEqual([]);
    expect(scrollerRegion('<html></html>')).toBe('');
  });
});

describe('FilGoal status words', () => {
  it('maps the vocabulary the page uses', () => {
    expect(filGoalStatus('لم تبدأ')).toBe('upcoming');
    expect(filGoalStatus('انتهت')).toBe('finished');
    expect(filGoalStatus('مباشر')).toBe('live');
    expect(filGoalStatus('الشوط الثاني')).toBe('live');
    expect(filGoalStatus('استراحة')).toBe('live');
    // FilGoal's prediction-pool link is not a status; such a match has not begun.
    expect(filGoalStatus('توقع المباراة')).toBe('upcoming');
  });
});

describe('FilGoal channels', () => {
  it('translates the Latin names into Arabic', () => {
    expect(filGoalChannel('beIN SPORTS 1 HD')).toBe('بي إن سبورتس 1');
    expect(filGoalChannel('On Sport')).toBe('أون سبورت');
    expect(filGoalChannel('On Sport MAX')).toBe('أون سبورت ماكس');
  });

  it('passes null through, and keeps an unknown name', () => {
    expect(filGoalChannel(null)).toBeNull();
    expect(filGoalChannel('قناة محلية')).toBe('قناة محلية');
  });
});

describe('merging two sources', () => {
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

  it('does not list the same fixture twice, whatever the spelling', () => {
    // Yallakora writes «الأهلى» and FilGoal «الأهلي»; both normalise the same.
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', channel: 'أون سبورت ماكس' })],
      [row({ id: 'y', dataSource: 'yallakora', home: 'الأهلى', channel: null })],
    );
    expect(merged).toHaveLength(1);
    // The preferred row wins whole: no score from one source beside a channel
    // from another.
    expect(merged[0]!.dataSource).toBe('filgoal');
    expect(merged[0]!.channel).toBe('أون سبورت ماكس');
  });

  it('keeps both when the two clubs meet in two competitions', () => {
    const merged = mergeDay(
      [row({ competitionName: 'الدوري المصري' })],
      [row({ id: 'cup', competitionName: 'كأس مصر' })],
    );
    expect(merged).toHaveLength(2);
  });

  it('lists Egyptian fixtures first', () => {
    const merged = mergeDay(
      [row({ competitionId: 'esp-la-liga', competitionName: 'الدوري الإسباني', home: 'برشلونة', away: 'فياريال' })],
      [row({})],
    );
    expect(merged[0]!.competitionId).toBe('egyptian-premier');
  });

  it('folds an age-group qualifier so one match is one row', () => {
    // FilGoal writes «إسبانيا | تحت 17», Yallakora writes «إسبانيا».
    const merged = mergeDay(
      [row({ competitionName: 'كأس العالم تحت 17', home: 'إسبانيا | تحت 17', away: 'فيجي | تحت 17' })],
      [row({ id: 'y', competitionName: 'كأس العالم تحت 17 عاما', home: 'إسبانيا', away: 'فيجي' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('treats a missing space inside a club name as the same club', () => {
    // «أيوبسبور» and «أيوب سبور» are one club, typed differently.
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', home: 'طرابزون سبور', away: 'أيوبسبور' })],
      [row({ id: 'y', dataSource: 'yallakora', home: 'طرابزون سبور', away: 'أيوب سبور' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('treats one source abbreviation and the full name as one fixture', () => {
    // Yallakora writes «ر.سانتاندير», FilGoal «راسينج سانتاندير». Same match, and
    // it was listed twice with two different scores on the same screen.
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', home: 'راسينج سانتاندير', away: 'ريال سوسيداد', competitionName: 'الدوري الإسباني' })],
      [row({ id: 'y', dataSource: 'yallakora', home: 'ر.سانتاندير', away: 'ريال سوسيداد', competitionName: 'الدوري الإسباني' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.dataSource).toBe('filgoal');
  });

  it('does not merge two different clubs that share a word', () => {
    const merged = mergeDay(
      [row({ home: 'ريال مدريد', away: 'برشلونة', competitionName: 'الدوري الإسباني' })],
      [row({ id: 'y', home: 'ريال سوسيداد', away: 'برشلونة', competitionName: 'الدوري الإسباني' })],
    );
    expect(merged).toHaveLength(2);
  });

  // ---- #46: the same European fixture listed twice under two spellings --------
  //
  // Every pair below is a real duplicate counted on production over 6 days
  // (15 candidates, 0 kickoff mismatches). The two feeds differ only in how they
  // write the long vowels, which the normaliser does not fold.
  const european = (over: Partial<MatchRow>): MatchRow =>
    row({
      competitionId: 'uefa-champions',
      competitionName: 'دوري أبطال أوروبا',
      status: 'live',
      statusText: 'الشوط الأول',
      homeScore: 0,
      awayScore: 0,
      ...over,
    });

  it.each([
    ['فينورد', 'فيينورد', 'بورتو', 'بورتو'],
    ['لايبزيج', 'لايبزج', 'لانس', 'لانس'],
    ['بروسيا دورتموند', 'بوروسيا دورتموند', 'أرسنال', 'أرسنال'],
    ['شاختار دونيتسك', 'شاختار دونتسك', 'فنربخشة', 'فنربخشة'],
    ['أتلتيك بلباو', 'أتليتك بلباو', 'اسبانيول', 'إسبانيول'],
    ['رايو فاييكانو', 'رايو فايكانو', 'فالنسيا', 'فالنسيا'],
    ['نوتينجهام فورست', 'نوتنجهام فورست', 'بورنموث', 'بورنموث'],
  ])('lists «%s» × %s once, not twice', (yallaHome, fgHome, yallaAway, fgAway) => {
    const merged = mergeDay(
      [european({ dataSource: 'filgoal', home: fgHome, away: fgAway })],
      [european({ id: 'yk', dataSource: 'yallakora', home: yallaHome, away: yallaAway })],
    );
    expect(merged).toHaveLength(1);
  });

  it('keeps the preferred row, and takes the spelling our league tables use', () => {
    const merged = mergeDay(
      [european({ dataSource: 'filgoal', home: 'فيينورد', away: 'بورتو', channel: null })],
      [european({ id: 'yk', dataSource: 'yallakora', home: 'فينورد', away: 'بورتو', channel: 'بي إن سبورتس 2' })],
    );
    expect(merged).toHaveLength(1);
    const only = merged[0]!;
    // The row the detail page opens stays FilGoal's — that is where the line-ups,
    // the commentator and the timeline come from.
    expect(only.dataSource).toBe('filgoal');
    // The names are Yallakora's, which is how the league table writes the club.
    expect(only.home).toBe('فينورد');
    // The channel fills a gap rather than overwriting a published value.
    expect(only.channel).toBe('بي إن سبورتس 2');
  });

  it('collapses the duplicate when the sides are the other way round', () => {
    const merged = mergeDay(
      [european({ dataSource: 'filgoal', home: 'بورتو', away: 'فيينورد' })],
      [european({ id: 'yk', dataSource: 'yallakora', home: 'فينورد', away: 'بورتو' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('keeps both when the two sources publish different scores', () => {
    // The rule from the earlier merge stands: never blend two published scores.
    const merged = mergeDay(
      [european({ dataSource: 'filgoal', home: 'فيينورد', away: 'بورتو', homeScore: 1 })],
      [european({ id: 'yk', dataSource: 'yallakora', home: 'فينورد', away: 'بورتو', homeScore: 0 })],
    );
    expect(merged).toHaveLength(2);
  });

  it('never merges the same spelling pair across two competitions', () => {
    const merged = mergeDay(
      [european({ dataSource: 'filgoal', home: 'فيينورد', away: 'بورتو' })],
      [european({ id: 'yk', dataSource: 'yallakora', competitionId: 'saudi-pro-league', competitionName: 'الدوري السعودي', home: 'فينورد', away: 'بورتو' })],
    );
    expect(merged).toHaveLength(2);
  });

  it('folds a decorative letter-stretch inside a club name', () => {
    // Measured on production: Yallakora writes «الشــارقة» with a tatweel, which is
    // a letter to a Unicode property test, so it survived normalisation and left one
    // fixture in two rows.
    const merged = mergeDay(
      [row({ dataSource: 'filgoal', home: 'اتحاد كلباء', away: 'الشارقة', status: 'finished', homeScore: 0, awayScore: 3 })],
      [row({ id: 'y', dataSource: 'yallakora', home: 'اتحاد كلباء', away: 'الشــارقة', status: 'finished', homeScore: 0, awayScore: 3 })],
    );
    expect(merged).toHaveLength(1);
  });

  it('treats a trailing FC as the club’s legal form, not its name', () => {
    // Measured: «لافيينا أف سي» (Yallakora) and «لافيينا» (FilGoal) are one club,
    // and the fixture was listed twice.
    const merged = mergeDay(
      [row({ competitionName: 'دوري القسم الثاني-أ', home: 'لافيينا', away: 'السكة الحديد' })],
      [row({ id: 'y', competitionName: 'دوري القسم الثاني-أ', home: 'لافيينا أف سي', away: 'السكة الحديد' })],
    );
    expect(merged).toHaveLength(1);
  });

  it('does not fold two different clubs whose consonant frames collide', () => {
    // «مونزا» and «ماينز» share a frame; they are different clubs in different
    // leagues, which is exactly why the frame is only compared inside one
    // competition — and why this pair must still be two rows.
    const merged = mergeDay(
      [european({ dataSource: 'filgoal', competitionId: 'ita-serie-a', competitionName: 'الدوري الإيطالي', home: 'مونزا', away: 'يوفنتوس' })],
      [european({ id: 'yk', dataSource: 'yallakora', competitionId: 'ger-bundesliga', competitionName: 'الدوري الألماني', home: 'ماينز', away: 'يوفنتوس' })],
    );
    expect(merged).toHaveLength(2);
  });
});

describe('competition names', () => {
  it('folds a competition’s tier and season, which is not a different tournament', () => {
    // Measured 2026-11-13: 20 fixtures listed twice under exactly these pairs, with
    // identical team names and kickoffs. The tier is how the source files a group
    // inside one tournament, not a separate competition.
    expect(canonicalCompetition('دوري الأمم الأوروبية - المستوى الثالث')).toBe('دوري الأمم الأوروبية');
    expect(canonicalCompetition('دوري الأمم الأوروبية - المستوى الأول')).toBe('دوري الأمم الأوروبية');
    expect(canonicalCompetition('تصفيات كأس الأمم الإفريقية 2027')).toBe('تصفيات كأس الأمم الإفريقية');
    expect(canonicalCompetition('مباريات ودية - منتخبات')).toBe('مباريات ودية دولية');
    // …and the plain names stay themselves.
    expect(canonicalCompetition('دوري الأمم الأوروبية')).toBe('دوري الأمم الأوروبية');
  });

  it('merges a friendly listed under two competition names into one row', () => {
    // The shape measured on 2026-11-13: identical team names and kickoff, one feed
    // adding the tier to the competition name.
    const base: MatchRow = {
      id: 'x',
      competitionId: 'other',
      competitionName: 'دوري الأمم الأوروبية',
      home: 'مولدوفا',
      away: 'كازاخستان',
      homeScore: 1,
      awayScore: 1,
      status: 'finished',
      statusText: 'انتهت',
      kickoff: '19:00',
      round: null,
      minute: null,
      dataSource: 'filgoal',
    };
    const merged = mergeDay(
      [base],
      [{ ...base, id: 'yk', dataSource: 'yallakora', competitionName: 'دوري الأمم الأوروبية - المستوى الثالث' }],
    );
    expect(merged).toHaveLength(1);
  });

  it('does not fold two different competitions that share a word', () => {
    // «الدوري المصري» and the professional league below it are different
    // competitions; the tier rule must not swallow one into the other.
    expect(canonicalCompetition('الدوري المصري')).toBe('الدوري المصري');
    expect(canonicalCompetition('دوري المحترفين المصري')).toBe('دوري القسم الثاني-أ');
  });

  it('names the same tournament the same way from both sources', () => {
    // «كأس العالم تحت 17 عاما» and «كأس العالم تحت 17» are one tournament.
    expect(canonicalCompetition('كأس العالم تحت 17 عاما')).toBe('كأس العالم تحت 17');
    expect(canonicalCompetition('كأس العالم تحت 17')).toBe('كأس العالم تحت 17');
    expect(canonicalCompetition('الكونفيدرالية الأفريقية')).toBe('كأس الكونفدرالية');
    expect(canonicalCompetition('كأس الكونفدرالية')).toBe('كأس الكونفدرالية');
    expect(canonicalCompetition('الدوري الإنجليزي الممتاز')).toBe('الدوري الإنجليزي');
  });

  it('folds the leagues the two sources name differently', () => {
    // «الدوري التونسي» and «الرابطة التونسية المحترفة» are one league; two names
    // for it put one fixture on the screen twice.
    expect(canonicalCompetition('الدوري التونسي')).toBe(canonicalCompetition('الرابطة التونسية المحترفة'));
  });

  it('folds Egypt’s professional league, which the two sources name differently', () => {
    // FilGoal: «دوري المحترفين المصري». Yallakora: «دوري القسم الثاني-أ».
    // Evidence they are one competition, not two:
    //   * Yallakora's 15-club table (tour/267) is a subset of FilGoal's 20-club
    //     competition page (championships/1668).
    //   * 7 of 7 fixtures listed under the two names on the same day were the same
    //     club pair with the identical score.
    expect(canonicalCompetition('دوري المحترفين المصري')).toBe('دوري القسم الثاني-أ');
    expect(canonicalCompetition('دوري القسم الثاني-أ')).toBe('دوري القسم الثاني-أ');
  });

  it('keeps the regional fourth tier a different competition', () => {
    // Both sources file «دوري القسم الثاني (ب) - المجموعة …» under that name with
    // entirely different clubs (سوهاج, الأقصر, كيما أسوان). Folding it into the
    // professional league would put two unrelated tables on one heading.
    const groupB = 'دوري القسم الثاني (ب) - المجموعة الأولى (أ)';
    expect(canonicalCompetition(groupB)).toBe(groupB);
    expect(canonicalCompetition(groupB)).not.toBe(canonicalCompetition('دوري المحترفين المصري'));
    expect(canonicalCompetition('دوري القسم الثاني (ب) - المجموعة الثالثة')).toBe(
      'دوري القسم الثاني (ب) - المجموعة الثالثة',
    );
  });

  it('does not fold the Saudi professional league with Egypt’s', () => {
    // «الدوري السعودي للمحترفين» contains «المحترفين», so the Egypt rule must not
    // swallow it.
    expect(canonicalCompetition('الدوري السعودي للمحترفين')).toBe('الدوري السعودي');
    expect(canonicalCompetition('365Sports Cairo')).toBe('365Sports Cairo');
  });
});

describe('FilGoal match detail page', () => {
  const detail = parseFilGoalDetail(fixture('filgoal-detail.html'));

  it('reads the commentator, which the day list does not carry', () => {
    // Measured on the El Gouna × Zamalek page: «بلال علام». This is the field the
    // spec asked for and that I had reported as unavailable.
    expect(detail).not.toBeNull();
    expect(detail!.commentator).toBe('بلال علام');
  });

  it('reads the Cairo kickoff, not the UTC one', () => {
    // The payload carries both: `Date` 17:00 (Cairo, matches the day list) and
    // `StartAt` 13:00 (UTC). Reading StartAt as local would put the match three
    // hours early.
    expect(detail!.kickoff).toBe('17:00');
  });

  it('reads the channel and both coaches', () => {
    expect(detail!.channel).toBe('أون سبورت ماكس');
    expect(detail!.homeCoach).toBe('علاء عبد العال');
    expect(detail!.awayCoach).toBe('معتمد جمال');
  });

  it('returns null for a page with no payload', () => {
    expect(parseFilGoalDetail('<html></html>')).toBeNull();
    expect(parseFilGoalDetail('')).toBeNull();
  });
});
