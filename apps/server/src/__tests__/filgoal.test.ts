import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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
});

describe('competition names', () => {
  it('names the same tournament the same way from both sources', () => {
    // «كأس العالم تحت 17 عاما» and «كأس العالم تحت 17» are one tournament.
    expect(canonicalCompetition('كأس العالم تحت 17 عاما')).toBe('كأس العالم تحت 17');
    expect(canonicalCompetition('كأس العالم تحت 17')).toBe('كأس العالم تحت 17');
    expect(canonicalCompetition('الكونفيدرالية الأفريقية')).toBe('كأس الكونفدرالية');
    expect(canonicalCompetition('كأس الكونفدرالية')).toBe('كأس الكونفدرالية');
    expect(canonicalCompetition('الدوري الإنجليزي الممتاز')).toBe('الدوري الإنجليزي');
  });
});
