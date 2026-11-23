import { describe, it, expect } from 'vitest';
import { buildTeamPage } from '../teamPage.js';
import { storeDay, storeStandings, _resetFootballCache } from '../footballStore.js';
import type { MatchRow } from '../football.js';

const row = (over: Partial<MatchRow>): MatchRow => ({
  id: 'x', competitionId: 'egyptian-premier', competitionName: 'الدوري المصري',
  home: 'الأهلي', away: 'بيراميدز', homeScore: null, awayScore: null,
  status: 'upcoming', statusText: 'لم تبدأ', kickoff: '20:00', round: null,
  minute: null, dataSource: 'filgoal', ...over,
});

describe('team page', () => {
  it('collects the club matches, hero crest and competitions from cache', () => {
    _resetFootballCache();
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    storeDay(today, [
      row({ id: '1', homeLogo: '/api/football/logo/filgoal:1', homeTeamId: '1', awayTeamId: '2' }),
      row({ id: '2', home: 'سموحة', away: 'زد', kickoff: '17:00' }),
      row({ id: '3', home: 'الأهلي', away: 'الزمالك', status: 'finished', statusText: 'انتهت', homeScore: 2, awayScore: 1, competitionName: 'كأس مصر', competitionId: 'egypt-cup' }),
    ]);
    const page = buildTeamPage('الأهلي');
    console.log('PAGE', page.name, '| crest', page.logo, '| comps', JSON.stringify(page.competitionIds), '| upcoming', page.upcoming.length, '| recent', page.recent.length);
    expect(page.upcoming.length).toBe(1);
    expect(page.recent.length).toBe(1);
    // Egypt first, because the league outranks the cup.
    expect(page.competitionIds[0]).toBe('egyptian-premier');
    expect(page.logo).toContain('/api/football/logo/');
    // Another club's match is not on this page.
    expect(page.upcoming.some((m) => m.home === 'سموحة')).toBe(false);
  });

  it('matches the club whatever the spelling', () => {
    _resetFootballCache();
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    storeDay(today, [row({ home: 'الأهلى' })]);
    expect(buildTeamPage('الأهلي').upcoming.length).toBe(1);
  });

  it('returns an honest empty page for a club we hold no matches for', () => {
    _resetFootballCache();
    const page = buildTeamPage('نادي غير موجود');
    expect(page.upcoming).toEqual([]);
    expect(page.recent).toEqual([]);
    expect(page.competitionIds).toEqual([]);
  });

  it('computes the form strip from real scores only (#40)', () => {
    _resetFootballCache();
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    storeDay(today, [
      // Newest first is the page's order; W, L, D for these three.
      row({ id: '1', homeScore: 2, awayScore: 0, status: 'finished', kickoff: '20:00' }),
      row({ id: '2', home: 'الشمال', away: 'الأهلي', homeScore: 3, awayScore: 2, status: 'finished', kickoff: '18:00' }),
      row({ id: '3', homeScore: 1, awayScore: 1, status: 'finished', kickoff: '16:00' }),
      // A finished match with no score must not count as a result of any kind.
      row({ id: '4', home: 'سموحة', away: 'الأهلي', homeScore: null, awayScore: null, status: 'finished', kickoff: '14:00' }),
    ]);
    const page = buildTeamPage('الأهلي');
    expect(page.form).toEqual(['W', 'L', 'D']);
  });

  it('does not invent a form letter for a match with no score (#40)', () => {
    _resetFootballCache();
    const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
    storeDay(today, [
      row({ id: '1', homeScore: null, awayScore: null, status: 'finished' }),
    ]);
    expect(buildTeamPage('الأهلي').form).toEqual([]);
  });

  it('serves the league row with four real numbers, and none when absent (#40)', () => {
    _resetFootballCache();
    storeStandings('egyptian-premier', [
      {
        competitionId: 'egyptian-premier',
        group: null,
        hasFullRecord: false,
        rows: [
          { position: 1, team: 'بيراميدز', played: 14, won: 0, drawn: 0, lost: 0, goalsFor: 30, goalsAgainst: 12, points: 36 },
          { position: 2, team: 'الأهلي', played: 14, won: 0, drawn: 0, lost: 0, goalsFor: 28, goalsAgainst: 10, points: 32 },
        ],
      },
    ]);
    const page = buildTeamPage('الأهلي', { matches: [] });
    expect(page.standing).toEqual({
      competitionId: 'egyptian-premier',
      position: 2,
      played: 14,
      goalDiff: 18,
      points: 32,
      continental: false,
    });
    // A club with no table row gets null, not a row of zeros.
    expect(buildTeamPage('نادي بدون صف', { matches: [] }).standing).toBeNull();
  });
});
