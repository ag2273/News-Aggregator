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
  canonicalCompetition,
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
import { fetchFilGoalDay, type FilGoalMatch } from './filgoal.js';
import { getAllArticles } from './db.js';
import { relatedNews as relatedNewsFrom, type ArticleLike, type RelatedArticle } from './matchNews.js';

/**
 * FilGoal's rows as our own shape.
 *
 * FilGoal is the Egyptian results source the user approved, and it carries more
 * per match than Yallakora (stadium, channel, its own stable id), so its Egyptian
 * rows replace Yallakora's for the same fixture rather than sitting beside them.
 */
export function fromFilGoal(rows: FilGoalMatch[]): MatchRow[] {
  return rows.map((r) => ({
    id: `fg-${r.matchId}`,
    competitionId: r.competitionId,
    competitionName: r.competitionName,
    home: r.home,
    away: r.away,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    status: r.status,
    statusText: r.statusText,
    kickoff: r.kickoff,
    round: null,
    url: r.url,
    minute: null,
    dataSource: 'filgoal',
    channel: r.channel,
    stadium: r.stadium,
    providerMatchId: r.matchId,
  }));
}

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

  // FilGoal and Yallakora are fetched together: FilGoal is the better Egyptian
  // source (stadium, channel, its own id), Yallakora covers the leagues FilGoal
  // does not list on a given day. Merging means one source's gap is not a blank.
  const [filGoal, yallakoraHtml] = await Promise.all([
    fetchFilGoalDay(date, options.fetchImpl).catch(() => null),
    getPage(`${YALLAKORA_BASE}/matches-center?date=${date}`, options.fetchImpl),
  ]);
  const merged = mergeDay(
    fromFilGoal(filGoal ?? []),
    yallakoraHtml ? parseYallakoraDay(yallakoraHtml, date) : [],
  );
  if (merged.length) return storeDay(date, merged);

  // Yallakora gave us nothing (down, blocked, or an empty day). Try ESPN before
  // calling the day unavailable, so one source's outage is not the reader's.
  const fromEspn = await loadEspnDay(date, options.fetchImpl);
  if (fromEspn.length) return storeDay(date, fromEspn);

  // All empty. If either page was readable, the day is quietly empty rather than
  // unavailable — the difference matters to the reader.
  return storeDay(date, [], !filGoal && !yallakoraHtml);
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

/**
 * Merge two days of fixtures, preferring the first source for a real duplicate.
 *
 * A match is the same match when the two team names normalise to the same pair,
 * in either order — Yallakora writes «الأهلى» where FilGoal writes «الأهلي», and
 * the normaliser already folds those together. The preferred row wins whole:
 * mixing a score from one source with a channel from another would let the screen
 * show a goal that one source has not reported.
 */
export function mergeDay(preferred: MatchRow[], fallback: MatchRow[]): MatchRow[] {
  const key = (m: MatchRow): string => {
    // The two sources name some clubs differently, and the difference is only
    // in the qualifier: FilGoal writes «إسبانيا | تحت 17» and «ماينز 05», where
    // Yallakora writes «إسبانيا» and «ماينز». Without stripping those, one
    // fixture appeared twice with two different scores on the same screen.
    const clean = (name: string): string =>
      normalizeTeam(
        name
          .replace(/\s*\|\s*تحت\s*\d+\s*$/, '')
          .replace(/\s*تحت\s*\d+\s*$/, '')
          // A trailing founding-year suffix («05», «04») is part of the club's
          // registered name, not a different club.
          .replace(/\s+0?[1-9]\d?$/, ''),
      );
    const pair = [clean(m.home), clean(m.away)].sort();
    // The competition is part of the key: two clubs can meet in the league and in
    // a cup on different days, and merging those would lose one tournament.
    return `${canonicalCompetition(m.competitionName)}|${pair.join('|')}`;
  };
  const seen = new Map<string, MatchRow>();
  for (const m of preferred) seen.set(key(m), { ...m, competitionName: canonicalCompetition(m.competitionName) });
  for (const m of fallback) {
    const k = key(m);
    if (seen.has(k)) continue;
    seen.set(k, { ...m, competitionName: canonicalCompetition(m.competitionName) });
  }
  // A stable, readable order: Egyptian first, then by competition name, then time.
  return [...seen.values()].sort((a, b) => {
    const priority = (m: MatchRow): number =>
      m.competitionId === 'egyptian-premier' ? 0 : m.competitionId === 'other' ? 2 : 1;
    return (
      priority(a) - priority(b) ||
      a.competitionName.localeCompare(b.competitionName, 'ar') ||
      (a.kickoff ?? '99:99').localeCompare(b.kickoff ?? '99:99')
    );
  });
}
