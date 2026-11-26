// Competition pages: a league's table, its fixtures and its results.
//
// This is the natural home for a league that has no match today — the reason the
// user could not find الدوري المصري. It reuses the standings endpoint and the
// cached days, so it adds no source traffic of its own.

import { COMPETITIONS, OTHER_COMPETITION_PREFIX, type MatchRow } from './football.js';
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
  if (competitionId.startsWith(OTHER_COMPETITION_PREFIX)) {
    return buildOtherCompetitionPage(competitionId, options);
  }
  const competition = COMPETITIONS.find((c) => c.id === competitionId);
  if (!competition) return null;

  const cached = getCachedStandings(competitionId);
  const table = cached?.tables?.[0] ?? null;

  const mine = (options.matches ?? matchesFor(competitionId)).filter(
    (m) => m.competitionId === competitionId,
  );
  const { upcoming, recent } = split(mine);

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

function split(mine: MatchRow[]): { upcoming: MatchRow[]; recent: MatchRow[] } {
  return {
    upcoming: mine
      .filter((m) => m.status === 'upcoming' || m.status === 'live')
      .sort((a, b) => (a.kickoff ?? '99:99').localeCompare(b.kickoff ?? '99:99')),
    recent: mine
      .filter((m) => m.status === 'finished')
      .sort((a, b) => (b.kickoff ?? '').localeCompare(a.kickoff ?? '')),
  };
}

/**
 * A competition we do not cover, found by the name its fixtures carry.
 *
 * Its strip used to have no page at all. It has no table we have read, so the
 * page says so and shows the fixtures and results the feeds published around
 * today. It exists only while those days hold a fixture of it: an id nobody's
 * fixture carries answers null (404), never an empty page with a made-up name.
 */
function buildOtherCompetitionPage(
  competitionId: string,
  options: { matches?: MatchRow[] },
): CompetitionPage | null {
  const mine = (options.matches ?? matchesFor(competitionId)).filter(
    (m) => m.competitionId === competitionId,
  );
  if (!mine.length) return null;
  const nameAr = mine[0]!.competitionName;
  return {
    id: competitionId,
    nameAr,
    // «كأس …» is a cup by its own name; a world or continental cup has groups,
    // so it is not described as having no table by nature.
    isCup: /^كأس/.test(nameAr) && !/العالم|الأمم/.test(nameAr),
    priority: 99,
    country: '',
    standings: null,
    standingsUnavailable: true,
    hasFullRecord: false,
    ...split(mine),
  };
}
