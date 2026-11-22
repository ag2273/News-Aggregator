// Football service: the one place that fetches from the sources.
//
// Everything above this layer (routes, push) sees a stable shape, and everything
// below it (Yallakora HTML, ESPN JSON) stays isolated. A source that moves or
// blocks us produces `unavailable: true` for that day, which the app renders as
// «غير متاح» — never a spinner that never ends.
//
// Provider order is Yallakora then ESPN, for a reason that shows on screen:
// Yallakora is Arabic and Cairo-local, ESPN is English and UTC.

import {
  COMPETITIONS,
  cairoDate,
  ESPN_BASE,
  getPage,
  normalizeTeam,
  parseEspnScoreboard,
  parseFullStandings,
  parseYallakoraDay,
  parseYallakoraStandings,
  YALLAKORA_BASE,
  type Competition,
  type MatchRow,
  type StandingsTable,
} from './football.js';
import {
  getCachedDay,
  getCachedStandings,
  storeDay,
  storeStandings,
  type DayCache,
  type StandingsCache,
} from './footballStore.js';
import { getAllArticles } from './db.js';
import { relatedNews as relatedNewsFrom, type ArticleLike, type RelatedArticle } from './matchNews.js';

/**
 * Load one day's fixtures, from cache when fresh.
 *
 * Yallakora covers all ten competitions, so ESPN is only consulted when
 * Yallakora produced nothing at all — a blocked or broken day, not a quiet one.
 * That keeps a normal day to one HTTP request instead of nine.
 */
export async function loadDay(
  date: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<DayCache> {
  const cached = getCachedDay(date, options.now ?? Date.now());
  if (cached) return cached;

  const html = await getPage(`${YALLAKORA_BASE}/matches-center?date=${date}`, options.fetchImpl);
  const fromYallakora = html ? parseYallakoraDay(html, date) : [];
  if (fromYallakora.length) return storeDay(date, fromYallakora);

  // Yallakora gave us nothing (down, blocked, or an empty day). Try ESPN before
  // calling the day unavailable, so one source's outage is not the reader's.
  const fromEspn = await loadEspnDay(date, options.fetchImpl);
  if (fromEspn.length) return storeDay(date, fromEspn);

  // Both empty. If the Yallakora page was readable, the day is genuinely quiet;
  // if it was not, the day is unavailable. The difference matters to the reader.
  return storeDay(date, [], !html);
}

/** ESPN scoreboard for one day, used only as the fallback. */
export async function loadEspnDay(
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MatchRow[]> {
  const stamp = date.replace(/-/g, '');
  const out: MatchRow[] = [];
  for (const competition of COMPETITIONS.filter((c) => c.espnSlug)) {
    const body = await getPage(
      `${ESPN_BASE}/${competition.espnSlug}/scoreboard?dates=${stamp}`,
      fetchImpl,
    );
    if (!body) continue;
    try {
      out.push(...parseEspnScoreboard(JSON.parse(body), competition));
    } catch {
      /* a malformed payload for one competition must not sink the day */
    }
  }
  return out;
}

/**
 * Standings for one competition, from cache when fresh.
 *
 * Two Yallakora routes, in order: `/tour-standing/<id>` has the full seven
 * columns, `/tour/<id>` has four. Neither is reliable alone — the full route
 * returns all-zero rows for the Egyptian league and the Champions League, and the
 * short route has only four real teams for the European leagues — so each parser
 * refuses an all-zero table and we fall through to the next route.
 */
export async function loadStandings(
  competitionId: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<StandingsCache> {
  const cached = getCachedStandings(competitionId, options.now ?? Date.now());
  if (cached) return cached;
  const competition = COMPETITIONS.find((c) => c.id === competitionId);
  if (!competition) return storeStandings(competitionId, [], true);

  // A cup has no league table by definition. Saying so is the honest answer, and
  // the app renders it as a cup explanation, not as a failure.
  if (competition.isCup) return storeStandings(competitionId, [], true);

  const attempts = [
    `${YALLAKORA_BASE}/tour-standing/${competition.yallakoraTourId}`,
    `${YALLAKORA_BASE}/tour/${competition.yallakoraTourId}`,
  ];
  for (const [index, url] of attempts.entries()) {
    const html = await getPage(url, options.fetchImpl);
    if (!html) continue;
    const tables =
      index === 0
        ? parseFullStandings(html, competitionId)
        : parseYallakoraStandings(html, competitionId);
    if (tables.length) return storeStandings(competitionId, tables);
  }
  return storeStandings(competitionId, [], true);
}

/**
 * Articles about a match's two teams, from our own corpus.
 *
 * The matching rules (whole-word, false-friend rejecting) live in `matchNews.ts`
 * with their tests; this only supplies the corpus.
 */
export function relatedNews(
  home: string,
  away: string,
  options: { limit?: number; articles?: ArticleLike[] } = {},
): RelatedArticle[] {
  return relatedNewsFrom(home, away, {
    limit: options.limit,
    articles: options.articles ?? getAllArticles(),
  });
}

/** The matches involving a followed team, across the cached days. */
export function matchesForTeams(matches: MatchRow[], teams: string[]): MatchRow[] {
  const wanted = new Set(teams.map(normalizeTeam));
  return matches.filter((m) => wanted.has(normalizeTeam(m.home)) || wanted.has(normalizeTeam(m.away)));
}

/** A competition lookup, exported for the routes. */
export function competitionOf(id: string): Competition | undefined {
  return COMPETITIONS.find((c) => c.id === id);
}

/** Today in Cairo, as the sources write it. */
export function todayCairo(now: number = Date.now()): string {
  return cairoDate(0, now);
}

/** Parsed standings tables for a competition, for the API. */
export function standingsRows(tables: StandingsTable[]): StandingsTable[] {
  return tables;
}
