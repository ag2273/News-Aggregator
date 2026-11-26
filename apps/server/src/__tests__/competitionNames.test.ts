import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPETITIONS,
  canonicalCompetition,
  competitionForLeague,
  parseYallakoraDay,
  settleCompetition,
  type MatchRow,
} from '../football.js';
import { parseFilGoalDay } from '../filgoal.js';
import { fromFilGoal, mergeDay } from '../footballService.js';
import { buildCompetitionPage } from '../competitionPage.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(path.join(here, 'fixtures', name), 'utf8');

function row(over: Partial<MatchRow>): MatchRow {
  return {
    id: 'r1',
    competitionId: 'other',
    competitionName: '',
    home: 'أ',
    away: 'ب',
    homeScore: null,
    awayScore: null,
    status: 'upcoming',
    statusText: 'لم تبدأ',
    kickoff: '20:00',
    round: null,
    minute: null,
    dataSource: 'filgoal',
    ...over,
  };
}

describe('competition names: one id, one name, and a page that opens', () => {
  it('finds the competitions whose strip did not open', () => {
    // Measured in our own FilGoal fixtures: «كأس الكونفدرالية» came through as «other».
    expect(competitionForLeague('كأس الكونفدرالية')?.id).toBe('caf-confederation');
    expect(competitionForLeague('الكونفيدرالية الأفريقية')?.id).toBe('caf-confederation');
    expect(competitionForLeague('كأس العالم تحت 17')?.id).toBe('fifa-u17-world-cup');
    expect(competitionForLeague('كأس العالم تحت 17 عاما')?.id).toBe('fifa-u17-world-cup');
    expect(competitionForLeague('الدوري الأوروبي')?.id).toBe('uefa-europa');
    expect(competitionForLeague('دوري المؤتمر الأوروبي')?.id).toBe('uefa-conference');
    expect(competitionForLeague('الدوري التركي')?.id).toBe('tur-super-lig');
  });

  it('keeps the three UEFA competitions and the Nations League apart', () => {
    const ids = ['دوري أبطال أوروبا', 'الدوري الأوروبي', 'دوري المؤتمر الأوروبي'].map(
      (n) => competitionForLeague(n)?.id,
    );
    expect(new Set(ids).size).toBe(3);
    expect(canonicalCompetition('دوري الأمم الأوروبية')).toBe('دوري الأمم الأوروبية');
    expect(competitionForLeague('دوري الأمم الأوروبية')).toBeUndefined();
  });

  it('spells the African Champions League the way its page does', () => {
    const caf = COMPETITIONS.find((c) => c.id === 'caf-champions')!;
    expect(canonicalCompetition('دوري أبطال أفريقيا')).toBe(caf.nameAr);
    expect(canonicalCompetition('دوري أبطال إفريقيا')).toBe(caf.nameAr);
  });

  it('never files a women’s competition under the Egyptian women’s league or the men’s', () => {
    expect(competitionForLeague('الدوري المصري | سيدات')?.id).toBe('egyptian-women');
    expect(competitionForLeague('دوري أبطال أوروبا للسيدات')).toBeUndefined();
    expect(canonicalCompetition('دوري أبطال أوروبا للسيدات')).toBe('دوري أبطال أوروبا للسيدات');
    expect(canonicalCompetition('دوري أبطال أفريقيا للسيدات')).toBe('دوري أبطال أفريقيا للسيدات');
  });

  it('never files a youth or lower-tier edition under the senior competition', () => {
    expect(competitionForLeague('دوري أبطال أوروبا للشباب')).toBeUndefined();
    // The Championship is a lower tier with an entry of its own, never the Premier
    // League; FilGoal heads it «الدوري الإنجليزي | الدرجة الأولى».
    expect(competitionForLeague('الدوري الإنجليزي - الدرجة الأولى')?.id).toBe('eng-championship');
    expect(competitionForLeague('الدوري الإنجليزي | الدرجة الأولى')?.id).toBe('eng-championship');
    expect(canonicalCompetition('الدوري الإنجليزي | الدرجة الأولى')).toBe('الدوري الإنجليزي - الدرجة الأولى');
    expect(competitionForLeague('الدوري الإنجليزي - الدرجة الثانية')).toBeUndefined();
    // The senior names the feeds use still resolve.
    expect(competitionForLeague('الدوري الإنجليزي الممتاز')?.id).toBe('eng-premier');
    expect(competitionForLeague('الدوري السعودي للمحترفين')?.id).toBe('saudi-pro-league');
    expect(competitionForLeague('دوري أبطال أوروبا - المجموعة الأولى')?.id).toBe('uefa-champions');
  });

  it('settles a row: the registered name for a known id, an own page for the rest', () => {
    // FilGoal's champion id names the competition even when its wording does not.
    const byId = settleCompetition(row({ competitionId: 'eng-championship', competitionName: 'التشامبيونشيب' }));
    expect(byId).toMatchObject({ competitionId: 'eng-championship', competitionName: 'الدوري الإنجليزي - الدرجة الأولى' });
    const unknown = settleCompetition(row({ competitionName: 'الدوري الاسكتلندي' }));
    expect(unknown).toMatchObject({ competitionId: 'other:الدوري الاسكتلندي', competitionName: 'الدوري الاسكتلندي' });
  });

  it('every strip on two measured days opens a page, under the name it is shown with', () => {
    const filGoal = [
      ...parseFilGoalDay(fixture('filgoal-day-23.html')),
      ...parseFilGoalDay(fixture('filgoal-day-24.html')),
    ];
    const yallakora = parseYallakoraDay(fixture('day-live.html'), '2026-11-20');
    const day = mergeDay(fromFilGoal(filGoal), yallakora);
    expect(day.length).toBeGreaterThan(50);
    for (const m of day) {
      expect(m.competitionId).not.toBe('other');
      const page = buildCompetitionPage(m.competitionId, { matches: day });
      expect(page, `${m.competitionName} (${m.competitionId})`).not.toBeNull();
      expect(page!.nameAr).toBe(m.competitionName);
    }
    // One strip per competition: no competition is shown under two names.
    const namesById = new Map<string, Set<string>>();
    for (const m of day) namesById.set(m.competitionId, (namesById.get(m.competitionId) ?? new Set()).add(m.competitionName));
    for (const names of namesById.values()) expect(names.size).toBe(1);
  });

  it('an `other:` id nobody’s fixture carries is not a page', () => {
    expect(buildCompetitionPage('other:دوري لا وجود له', { matches: [] })).toBeNull();
  });
});
