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
import { fetchFilGoalDay, fetchFilGoalDetail, type FilGoalMatch } from './filgoal.js';
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

/**
 * Detail for one match, from the provider's own match page.
 *
 * Only FilGoal publishes the commentator, and only on the match page, so this is
 * fetched on demand (one request when the reader opens a match) and not as part
 * of the day refresh. Cached in the day store's neighbourhood: a commentator does
 * not change once announced.
 */
export async function loadMatchDetail(
  match: MatchRow,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{ commentator: string | null; channel: string | null; homeCoach: string | null; awayCoach: string | null } | null> {
  if (match.dataSource !== 'filgoal' || !match.providerMatchId) return null;
  const detail = await fetchFilGoalDetail(match.providerMatchId, options.fetchImpl);
  if (!detail) return null;
  return {
    commentator: detail.commentator,
    channel: match.channel ?? detail.channel,
    homeCoach: detail.homeCoach,
    awayCoach: detail.awayCoach,
  };
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
 * Drop a one-letter initial from a club name.
 *
 * One source abbreviates a club to its initial («ر.سانتاندير») where the other
 * writes it out («راسينج سانتاندير»). Normalisation turns the dot into a space, so
 * the initial arrives as its own token. Without this the same fixture was listed
 * twice with two different scores. Two-letter tokens are kept: «أبو قير» and «زد»
 * are real names.
 */
export function dropInitials(normalized: string): string {
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 2) return normalized;
  const kept = tokens.filter((t, i) => !(t.length === 1 && i < tokens.length - 1));
  return kept.join(' ');
}

/**
 * Remove the spaces inside a club name.
 *
 * One source writes «أيوبسبور» and the other «أيوب سبور»; the space is not part
 * of the name, only of how it is typed. Squashing it makes the two agree, and it
 * cannot merge two different clubs because the letters must still match exactly.
 */
export function squashSpacing(normalized: string): string {
  return normalized.replace(/\s+/g, '');
}

/**
 * Are two match keys the same fixture under different spellings?
 *
 * Compares the competition and, for each side, whether one name's words are a
 * subset of the other's — «سانتاندير» is inside «راسينج سانتاندير». Deliberately
 * conservative: a shared generic word is not enough, there must be a whole word
 * of one name present in the other, and the clubs must not both be different.
 */
export function sameFixture(a: string, b: string): boolean {
  // The key is `competition|side|side`. Slicing the first field off rather than
  // destructuring two: destructuring dropped the second side entirely, so every
  // key looked like a single-team key and nothing ever matched.
  const partsA = a.split('|');
  const partsB = b.split('|');
  if (partsA.length < 3 || partsB.length < 3) return false;
  if (partsA[0] !== partsB[0]) return false;
  const sidesA = partsA.slice(1);
  const sidesB = partsB.slice(1);
  if (sidesA.length !== 2 || sidesB.length !== 2) return false;
  // The key already ordered the pair, so compare in the same order on both sides:
  // each name from one key must have a partner in the other, either position.

  const match = (x: string, y: string): boolean => {
    if (x === y) return true;
    // Keys are space-squashed, so a substring test IS the word test here:
    // «سانتاندير» is inside «راسينجسانتاندير». Requires at least four characters so
    // a short fragment cannot claim a match.
    if (x.length >= 4 && y.includes(x)) return true;
    if (y.length >= 4 && x.includes(y)) return true;
    return false;
  };
  const forward = match(sidesA[0]!, sidesB[0]!) && match(sidesA[1]!, sidesB[1]!);
  const swapped = match(sidesA[0]!, sidesB[1]!) && match(sidesA[1]!, sidesB[0]!);
  return forward || swapped;
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
  // The two sources can disagree on a live score (measured: أوجسبورج × ماينز was
  // 0-0 on one and 0-5 on the other at the same minute). We show the preferred
  // source whole, but the disagreement is logged rather than hidden: a silent
  // choice between two published scores is how a wrong score gets shipped.
  const key = (m: MatchRow): string => {
    // The two sources name some clubs differently, and the difference is only
    // in the qualifier: FilGoal writes «إسبانيا | تحت 17» and «ماينز 05», where
    // Yallakora writes «إسبانيا» and «ماينز». Without stripping those, one
    // fixture appeared twice with two different scores on the same screen.
    const clean = (name: string): string =>
      squashSpacing(
        dropInitials(
          normalizeTeam(
            name
              .replace(/\s*\|\s*تحت\s*\d+\s*$/, '')
              .replace(/\s*تحت\s*\d+\s*$/, '')
              // A trailing founding-year suffix («05», «04») is part of the club's
              // registered name, not a different club.
              .replace(/\s+0?[1-9]\d?$/, '')
              .replace(/\s+/g, ' ')
              .trim(),
          ),
        ),
      );
    // Home and away are meaningful for the fixture, but a provider can list them
    // the other way round, so the PAIR is ordered — not each side's words. (The
    // earlier version sorted each name's words, which made «راسينج سانتاندير» and
    // «سانتاندير» different keys.)
    const pair = [`${clean(m.home)}`, `${clean(m.away)}`].sort();
    // The competition is part of the key: two clubs can meet in the league and in
    // a cup on different days, and merging those would lose one tournament.
    return `${canonicalCompetition(m.competitionName)}|${pair.join('|')}`;
  };
  const seen = new Map<string, MatchRow>();
  for (const m of preferred) seen.set(key(m), { ...m, competitionName: canonicalCompetition(m.competitionName) });
  for (const m of fallback) {
    const k = key(m);
    if (seen.has(k)) continue;
    // Exact key first. If that misses, the two sources may still be naming the
    // same fixture differently — «سانتاندير» against «راسينج سانتاندير» — so a
    // fuzzy check on the same competition and the same distinctive words runs
    // before the row is kept as a separate match.
    const near = [...seen.entries()].find(([existingKey]) => sameFixture(existingKey, k));
    if (near) continue;
    seen.set(k, { ...m, competitionName: canonicalCompetition(m.competitionName) });
  }
  for (const [k, kept] of seen) {
    const other = fallback.find((m) => key(m) === k);
    if (!other || other === kept) continue;
    const differs =
      kept.homeScore !== other.homeScore ||
      kept.awayScore !== other.awayScore ||
      kept.status !== other.status;
    if (differs) {
      console.warn(
        `[football] sources disagree on ${kept.home} v ${kept.away}: ` +
          `${kept.dataSource} ${kept.homeScore}-${kept.awayScore} (${kept.status}) vs ` +
          `${other.dataSource} ${other.homeScore}-${other.awayScore} (${other.status})`,
      );
    }
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
