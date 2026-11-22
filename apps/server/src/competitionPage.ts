// Competition pages: a league's table, its fixtures and its results.
//
// This is the natural home for a league that has no match today — the reason the
// user could not find الدوري المصري. It reuses the standings endpoint and the
// cached days, so it adds no source traffic of its own.

import { COMPETITIONS, type MatchRow } from './football.js';
import { getCachedDay, getCachedStandings } from './footballStore.js';
import type { StandingRow } from './football.js';

export interface CompetitionPage {
  id: string;
  nameAr: string;
  isCup: boolean;
  priority: number;
  country: string;
  /** The table, or null when the source publishes none (a cup, or an empty group). */
  standings: StandingRow[] | null;
  standingsUnavailable: boolean;
  /** True when the source sends played/goals/points only, with no W/D/L. */
  hasFullRecord: boolean;
  upcoming: MatchRow[];
  recent: MatchRow[];
}

function matchesFor(competitionId: string): MatchRow[] {
  const out: MatchRow[] = [];
  const today = Date.now();
  for (let offset = -6; offset <= 6; offset += 1) {
    const d = new Date(today + offset * 86_400_000 + 2 * 60 * 60 * 1000);
    const day = getCachedDay(d.toISOString().slice(0, 10));
    if (day && !day.unavailable) out.push(...day.matches.filter((m) => m.competitionId === competitionId));
  }
  return out;
}

/**
 * Build a competition page from the cached standings and days.
 *
 * `standings` is null when the source publishes no table for it — a cup, or a
 * competition whose group stage is not populated — and the screen says so instead
 * of drawing an empty grid.
 */
export function buildCompetitionPage(
  competitionId: string,
  options: { matches?: MatchRow[] } = {},
): CompetitionPage | null {
  const competition = COMPETITIONS.find((c) => c.id === competitionId);
  if (!competition) return null;

  const cached = getCachedStandings(competitionId);
  const table = cached?.tables?.[0] ?? null;

  const mine = (options.matches ?? matchesFor(competitionId)).filter(
    (m) => m.competitionId === competitionId,
  );
  const upcoming = mine
    .filter((m) => m.status === 'upcoming' || m.status === 'live')
    .sort((a, b) => (a.kickoff ?? '99:99').localeCompare(b.kickoff ?? '99:99'));
  const recent = mine
    .filter((m) => m.status === 'finished')
    .sort((a, b) => (b.kickoff ?? '').localeCompare(a.kickoff ?? ''));

  return {
    id: competition.id,
    nameAr: competition.nameAr,
    isCup: Boolean(competition.isCup),
    priority: competition.priority,
    country: competition.country,
    standings: table?.rows ?? null,
    standingsUnavailable: !table,
    hasFullRecord: table?.hasFullRecord ?? false,
    upcoming,
    recent,
  };
}
