// Football service: the one place that fetches from the sources.
//
// (Comment touched again to re-trigger the deploy workflow, which only runs when
// something under apps/server changes.)
//
// Everything above this layer (routes, push) sees a stable shape, and everything
// below it (Yallakora HTML, ESPN JSON) stays isolated. A source that moves or
// blocks us produces `unavailable: true` for that day, which the app renders as
// «غير متاح» — never a spinner that never ends.
//
// Provider order is Yallakora then ESPN, for a reason that shows on screen:
// Yallakora is Arabic and Cairo-local, ESPN is English and UTC.

import { remember } from './boundedCache.js';
import {
  canonicalCompetition,
  settleCompetition,
  clubFrame,
  sameClub,
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
import {
  fetchFilGoalDay,
  parseFilGoalDetail,
  parseFilGoalLineups,
  FILGOAL_BASE,
  type FilGoalMatch,
  type FilGoalLineups,
} from './filgoal.js';
import { parseMatchEvents, type MatchEvent } from './matchEvents.js';
import { parseYallakoraGoals, type MatchGoal } from './yallakoraMatch.js';
import { getAllArticlesReadonly } from './db.js';
import { relatedNews as relatedNewsFrom, type ArticleLike, type RelatedArticle } from './matchNews.js';
import { clockFor, espnCompetitions, fetchEspnLive, fetchEspnLiveDay } from './espnLive.js';
import { canonicalClub, isUnsettledClub } from './clubAliases.js';
import type { EspnLive } from './espnLive.js';
import { halfText } from './espnClock.js';

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
    homeTeamId: r.homeTeamId,
    awayTeamId: r.awayTeamId,
    // The app asks us for a team id and we serve cached bytes; it never sees the
    // source URL, so nothing hotlinks.
    homeLogo: r.homeLogo ? `/api/football/logo/filgoal:${r.homeTeamId}` : null,
    awayLogo: r.awayLogo ? `/api/football/logo/filgoal:${r.awayTeamId}` : null,
  }));
}

/**
 * Load one day's fixtures, from cache when fresh.
 *
 * Yallakora covers all ten competitions, so ESPN is only consulted when
 * Yallakora produced nothing at all — a blocked or broken day, not a quiet one.
 * That keeps a normal day to one HTTP request instead of nine.
 */
/**
 * One in-flight load per day (#61).
 *
 * MEASURED, and this is the recurring freeze: ten concurrent readers of the same day
 * made 100 upstream calls and took 27 seconds. `loadDay` had no single-flight, so every
 * poll tick and every request started its own fetch at the publishers — the moment one
 * of them was slow, requests multiplied the load that was already failing, and the
 * whole process stalled. On the user's phone that is every route dying at the 20s
 * deadline at once, at 01:12 and again at 09:29.
 *
 * Only a load that actually runs is shared; a cache hit still returns immediately.
 * `fetchImpl` callers (tests) bypass it, so an injected transport is never shared.
 */
const dayInFlight = new Map<string, Promise<DayCache>>();

/** Test seam. */
export function _resetDayInFlight(): void {
  dayInFlight.clear();
}

export async function loadDay(
  date: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<DayCache> {
  const cached = getCachedDay(date, options.now ?? Date.now());
  if (cached) return cached;

  // A test or one-shot script injecting its own transport gets its own run.
  if (options.fetchImpl) return loadDayUncached(date, options);

  const running = dayInFlight.get(date);
  if (running) return running;
  const job = loadDayUncached(date, options).finally(() => {
    dayInFlight.delete(date);
  });
  dayInFlight.set(date, job);
  return job;
}

/** The actual load. Split out so the single-flight above stays readable. */
async function loadDayUncached(
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
  // No verified table id: asking Yallakora for `/tour-standing/` would read some
  // other page, and a table parsed from it would be a table we invented.
  if (!competition.yallakoraTourId) return storeStandings(competitionId, [], true);

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
  options: { limit?: number; articles?: ArticleLike[]; competitionId?: string } = {},
): RelatedArticle[] {
  // The competition's country disambiguates a club whose short name is shared
  // («إنتر» in Italy and in MLS), and is only used for that.
  const country = options.competitionId
    ? COMPETITIONS.find((c) => c.id === options.competitionId)?.country
    : undefined;
  return relatedNewsFrom(home, away, {
    limit: options.limit,
    country,
    articles: options.articles ?? getAllArticlesReadonly(),
    // The store is newest-first; a caller's own corpus may not be.
    newestFirst: !options.articles,
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
/**
 * The detail cache (#60).
 *
 * Measured before this: the match centre took 1.5-2.1s on EVERY open, because
 * `loadMatchDetail` fetched the provider's page each time with no cache at all — a
 * reader who opened the same match twice paid twice.
 *
 * Kept deliberately small and honest:
 *   * keyed per provider match, so two matches never share an entry;
 *   * 60s, the same window as the day cache, because a LIVE match's timeline grows;
 *   * the small result is stored, not the HTML, so the memory cost is a few KB;
 *   * one in-flight fetch per key, so a double tap does not hit the provider twice.
 *
 * A finished match is immutable, so its entry lives longer — there is nothing that
 * can change after the final whistle.
 */
const DETAIL_TTL_LIVE_MS = 60 * 1000;
const DETAIL_TTL_FINAL_MS = 24 * 60 * 60 * 1000;
export type MatchDetailData = {
  commentator: string | null;
  channel: string | null;
  homeCoach: string | null;
  awayCoach: string | null;
  lineups: FilGoalLineups | null;
  events: MatchEvent[];
  goals: MatchGoal[];
};
const detailCache = new Map<string, { at: number; finished: boolean; data: MatchDetailData }>();
const detailInFlight = new Map<string, Promise<MatchDetailData | null>>();

/** Test seam: forget every cached match detail. */
export function _resetMatchDetailCache(): void {
  detailCache.clear();
  detailInFlight.clear();
}

/** The cache key: the provider's own id, so two fixtures can never collide. */
function detailKey(match: MatchRow): string {
  return `${match.dataSource}:${match.providerMatchId ?? match.url ?? match.id}:${match.status === 'finished' ? 'final' : 'live'}`;
}

export async function loadMatchDetail(
  match: MatchRow,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{
  commentator: string | null;
  channel: string | null;
  homeCoach: string | null;
  awayCoach: string | null;
  lineups: FilGoalLineups | null;
  events: MatchEvent[];
  goals: MatchGoal[];
} | null> {
  const key = detailKey(match);
  const hit = detailCache.get(key);
  if (hit) {
    const ttl = hit.finished ? DETAIL_TTL_FINAL_MS : DETAIL_TTL_LIVE_MS;
    if (Date.now() - hit.at < ttl) return hit.data;
    detailCache.delete(key);
  }
  const running = detailInFlight.get(key);
  if (running) return running;
  const job = fetchMatchDetail(match, options).then((data) => {
    if (data) {
      remember(
        detailCache,
        key,
        { at: Date.now(), finished: match.status === 'finished', data },
        1000,
        (e) => Date.now() - e.at >= (e.finished ? DETAIL_TTL_FINAL_MS : DETAIL_TTL_LIVE_MS),
      );
    }
    return data;
  });
  detailInFlight.set(key, job);
  try {
    return await job;
  } finally {
    detailInFlight.delete(key);
  }
}

/** The uncached fetch. Split out so the cache above stays readable. */
async function fetchMatchDetail(
  match: MatchRow,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<{
  commentator: string | null;
  channel: string | null;
  homeCoach: string | null;
  awayCoach: string | null;
  lineups: FilGoalLineups | null;
  /** The goal/card timeline as the page publishes it. */
  events: MatchEvent[];
  /**
   * Scorers with their minutes, when a source publishes them.
   *
   * Yallakora's match page carries a `playerScorers` block with a name and a
   * minute per goal — measured on a real finished Egyptian fixture. This is the
   * «هدافين بدقائق» the earlier measurement called impossible.
   */
  goals: MatchGoal[];
} | null> {
  // Yallakora publishes the scorer list on its own match page, which is the
  // source that carries Egyptian scorers with minutes. FilGoal's page has the
  // goal timeline but only after the match; its live pages show a score with no
  // events (measured: 7-0 with zero events during play).
  if (match.dataSource === 'yallakora') {
    if (!match.url) return null;
    const html = await getPage(match.url, options.fetchImpl);
    if (!html) return null;
    return {
      commentator: null,
      channel: match.channel ?? null,
      homeCoach: null,
      awayCoach: null,
      lineups: null,
      events: [],
      goals: parseYallakoraGoals(html),
    };
  }
  if (match.dataSource !== 'filgoal' || !match.providerMatchId) return null;
  // ONE page fetch, parsed three ways. It used to fetch this page twice (once for
  // the commentator, once for the line-ups), which doubled the source traffic of
  // every match a reader opened.
  const html = await getPage(
    `${FILGOAL_BASE}/matches/${match.providerMatchId}`,
    options.fetchImpl,
  );
  if (!html) return null;
  const detail = parseFilGoalDetail(html);
  // The line-ups come from the same page. Measured: European fixtures carry 40-45
  // players and so do played Egyptian ones (corrected — the earlier "Egyptian
  // carries none" was measured before kickoff). An unplayed match carries an empty
  // array, so `null` here means "not announced yet", and the screen says so.
  const lineups = parseFilGoalLineups(html);
  // The timeline is in the page's markup, not its JSON payload — the reason the
  // first measurement called it impossible. Verified against real finished
  // Egyptian fixtures; see `matchEvents.ts`.
  // Playable rows only. `parseMatchEvents` returns the status markers too («لم
  // تبدأ», «بعد قليل», «الشوط الأول») because they explain the page's own state,
  // but they are not events a reader should see in a timeline — and they carry no
  // minute, which is how `null'` badges reached the screen (issue #30).
  const events = parseMatchEvents(html).filter((e) => !e.isStatus);
  if (!detail && !lineups && events.length === 0) return null;
  return {
    commentator: detail?.commentator ?? null,
    channel: match.channel ?? detail?.channel ?? null,
    homeCoach: detail?.homeCoach ?? null,
    awayCoach: detail?.awayCoach ?? null,
    lineups,
    events,
    // FilGoal carries the timeline; its rows name the scorer too, so the goals
    // list is derived from the same page rather than fetched twice.
    goals: events
      .filter((e) => !e.isStatus && /هدف|ركلة جزاء/.test(e.type) && e.player && e.minute !== null)
      .map((e) => ({
        minute: e.minute,
        player: e.player!,
        side: e.side === 'r' ? ('A' as const) : ('B' as const),
        ownGoal: /own|ذاتي/i.test(e.type),
      })),
  };
}

/** The provider's own live state for one match. */
export interface LiveState {
  /** ESPN says it is in its half-time interval. */
  halftime: boolean;
  /** Published minute text (`"74'"`, `"90'+4'"`), when there is one. */
  minuteLabel: string | null;
  /** The half in our words, when the provider states it. */
  half: string | null;
}

/**
 * Attach ESPN's live clock to our rows, for the fixtures it can prove are the same.
 *
 * Why this is not done in the day loader: the clock is the only thing we want from
 * ESPN, and it changes every minute while the fixture list does not. Doing it here
 * keeps the borrow to the live rows, and leaves a non-live row untouched no matter
 * what the scoreboard says.
 *
 * A row ESPN cannot pair with confidence is returned unchanged — no minute, no
 * half — which the screen renders as the state alone.
 */
export function applyLiveClocks(rows: MatchRow[], live: EspnLive[]): MatchRow[] {
  if (!live.length) return rows;
  return rows.map((row) => {
    if (row.status !== 'live') return row;
    const event = clockFor(live, row.home, row.away);
    if (!event) return row;
    const clock = event.clock;
    return {
      ...row,
      // The clock is ESPN's; the half is too. Never blended with FilGoal's broken
      // `TimeElapsed`.
      minute: clock.halftime ? null : clock.minute,
      minuteLabel: clock.halftime ? null : clock.label,
      half: halfText(clock),
      halftime: clock.halftime,
      // The state word is ours, so a match ESPN calls a half-time interval reads
      // «استراحة» instead of a live minute that has stopped.
      statusText: clock.halftime ? 'استراحة' : row.statusText,
    };
  });
}

/**
 * The live minute for the matches we serve (issue #36).
 *
 * One request per ESPN-covered competition, for the whole day, and only when
 * something is actually live — a quiet day costs nothing extra. Failures are
 * swallowed on purpose: a borrowed clock is an improvement, never a dependency.
 */
export async function enrichLiveClocks(
  rows: MatchRow[],
  date: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<MatchRow[]> {
  const liveRows = rows.filter((r) => r.status === 'live');
  // Nothing live means nothing to borrow. This is also the reason a normal request
  // stays at the same number of source calls as before.
  if (!liveRows.length) return rows;
  // Fixtures outside ESPN's coverage cannot be paired, so skip the round trips when
  // no live row could possibly match.
  const covered = espnCompetitions();
  if (!covered.some((c) => liveRows.some((r) => r.competitionId === c.id))) return rows;
  const live = await fetchEspnLiveDay(date, options.fetchImpl).catch(() => []);
  return applyLiveClocks(rows, live);
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
 * The ordered consonant-frame pair of a fixture, for cross-source matching.
 *
 * Ordered because a provider may list the sides the other way round, and it is the
 * PAIR of clubs that identifies a fixture.
 */
function framePair(m: MatchRow): string {
  return [clubFrame(m.home), clubFrame(m.away)].sort().join('|');
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
  //
  // The two sources name some clubs differently, and the difference is only
  // in the qualifier: FilGoal writes «إسبانيا | تحت 17» and «ماينز 05», where
  // Yallakora writes «إسبانيا» and «ماينز». Without stripping those, one
  // fixture appeared twice with two different scores on the same screen.
  const clean = (name: string): string =>
    squashSpacing(
      dropInitials(
        normalizeTeam(
          // A club the two feeds name differently in a way no character rule can
          // see: FilGoal calls Sabah «صباح باكو» (its city) where Yallakora calls
          // it «صباح إف كيه». The alias table resolves both to one name, so the
          // fixture becomes one row (#47). Every entry is anchored on the club's
          // official name from an outside source, not on similarity.
          canonicalClub(name)
            .replace(/\s*\|\s*تحت\s*\d+\s*$/, '')
            .replace(/\s*تحت\s*\d+\s*$/, '')
            // A trailing founding-year suffix («05», «04») is part of the club's
            // registered name, not a different club.
            .replace(/\s+0?[1-9]\d?$/, '')
            // «ستاد رين» and «رين» are the same club: «ستاد» is the word for
            // stadium, not part of the name. Without this the fixture appeared
            // twice, once from each source.
            .replace(/^ستاد\s+/, '')
            // A trailing «FC»/«إف سي» is the club's legal form, not its name:
            // «لافيينا أف سي» and «لافيينا» are one club, and the fixture was
            // listed twice. Measured across 538 club names seen on both sources'
            // pages, this folds exactly one pair (لافيينا / لافيينا أف سي) and
            // merges nothing else.
            .replace(/\s+(?:اف|أف|إف)\s+(?:سي|سى)$/, '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
          // These two run AFTER normalisation, because they are written against
          // the FOLDED spelling (ة→ه, أ→ا). Applied to the raw name they never
          // matched — «أهلي جدة» stayed «أهلي جدة» while «الأهلي» stayed
          // «الأهلي», so the Saudi fixture was listed twice, once per source.
          //
          // Saudi «أهلي جدة» is written «الأهلي» by the other source, and both are
          // the same club — not Egypt's Al Ahly, which never plays Al Nassr in
          // this competition. One form, so one fixture is one row.
          .replace(/^الاهلي$/, 'اهلي')
          .replace(/^اهلي جده$/, 'اهلي')
          .trim(),
      ),
    );
  const key = (m: MatchRow): string => {
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
  // Every kept row by its consonant-frame pair, WITHIN one competition, so a fixture
  // the two feeds spell differently is recognised before the fallback row is added
  // as a second match (#46).
  const byFrame = new Map<string, MatchRow>();
  const frameOf = (m: MatchRow): string =>
    `${canonicalCompetition(m.competitionName)}|${framePair(m)}`;
  const remember = (m: MatchRow): void => {
    const frame = frameOf(m);
    // Two fixtures in one competition cannot share a frame unless the frame is
    // ambiguous; the first one keeps it and the other is left to the exact key.
    if (!byFrame.has(frame)) byFrame.set(frame, m);
  };

  // The preferred feed's rows, by competition and kickoff, for the last check below.
  const bySlot = new Map<string, MatchRow[]>();
  const slotOf = (m: MatchRow): string | null =>
    m.kickoff ? `${canonicalCompetition(m.competitionName)}|${m.kickoff}` : null;
  // A kept row that already took in a row from the other feed. One fixture is one
  // row per feed, so it cannot take in a second one.
  const absorbed = new Set<MatchRow>();

  for (const m of preferred) {
    const row = { ...m, competitionName: canonicalCompetition(m.competitionName) };
    seen.set(key(row), row);
    remember(row);
    const slot = slotOf(row);
    if (slot) bySlot.set(slot, [...(bySlot.get(slot) ?? []), row]);
  }

  /**
   * Fold a fallback row into a row we already keep, when the two agree on the score.
   *
   * The fixture is merged into the row we already keep, because that row carries
   * the match page the detail screen opens (line-ups, commentator, timeline). Only
   * the NAMES come from the other feed: Yallakora's spelling is the one our league
   * tables use — measured on 7 of 7 duplicate pairs — and a club page resolves a
   * fixture by the table's spelling, so keeping the other feed's spelling would
   * leave the fixture invisible from the club it belongs to. It is also the
   * spelling the ESPN link table is written in, so the merged row keeps the live
   * minute.
   *
   * Two published scores that disagree are neither blended nor renamed; the
   * fallback row is then kept as it is.
   */
  const absorb = (kept: MatchRow, row: MatchRow): boolean => {
    const agrees =
      kept.homeScore === row.homeScore &&
      kept.awayScore === row.awayScore &&
      kept.status === row.status;
    if (!agrees) return false;
    kept.home = row.home;
    kept.away = row.away;
    // The channel is the one thing Yallakora carries and FilGoal sometimes does
    // not, so it fills a gap rather than replacing a published value.
    if (!kept.channel && row.channel) kept.channel = row.channel;
    absorbed.add(kept);
    return true;
  };

  /**
   * Is this one club, as far as the merge can tell from the names alone?
   *
   * The same folded name, the same consonant frame, or one name's whole word inside
   * the other's («مونشنجلادباخ» in «بوروسيا مونشنجلادباخ»).
   */
  const sameSide = (a: string, b: string): boolean => {
    if (sameClub(a, b)) return true;
    const x = clean(a);
    const y = clean(b);
    if (x === y) return true;
    return (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
  };

  /**
   * The preferred row for the same fixture, found by ONE club and the kickoff.
   *
   * Some clubs are spelled so differently that no name rule can see it — Yallakora
   * writes Red Star «سرفينا زافيزدا» where FilGoal writes «ريد ستار بلجراد», and
   * KuPS «كوبس» against «كوبيون بالوسورا». Measured on the 2026-11-12..30 pages,
   * 20 fixtures were still listed twice this way after #46-#49.
   *
   * What identifies the fixture then is the schedule: in one competition, one club
   * plays one match at one kickoff. So when the other side matches and the kickoff
   * is the same, it is the same fixture. Guarded so a malformed page cannot merge
   * two matches:
   *   - the two rows come from different feeds, and the kept row has not already
   *     taken in a row from the other feed;
   *   - exactly ONE kept row in that slot has the club (FilGoal sometimes lists a
   *     club twice at one kickoff in the lower Egyptian tiers — that is left alone);
   *   - the scores agree, checked in `absorb`;
   *   - neither club is one whose pairing is still undecided (`isUnsettledClub`).
   */
  const slotTwin = (row: MatchRow): MatchRow | null => {
    const slot = slotOf(row);
    if (!slot) return null;
    if (isUnsettledClub(row.home) || isUnsettledClub(row.away)) return null;
    const candidates = (bySlot.get(slot) ?? []).filter(
      (kept) =>
        kept.dataSource !== row.dataSource &&
        !isUnsettledClub(kept.home) &&
        !isUnsettledClub(kept.away) &&
        [kept.home, kept.away].some((side) => sameSide(side, row.home) || sameSide(side, row.away)),
    );
    if (candidates.length !== 1) return null;
    const kept = candidates[0]!;
    return absorbed.has(kept) ? null : kept;
  };

  for (const m of fallback) {
    const row = { ...m, competitionName: canonicalCompetition(m.competitionName) };
    const k = key(row);
    const exact = seen.get(k);
    if (exact) {
      absorbed.add(exact);
      continue;
    }
    // Exact key first. If that misses, the two sources may still be naming the
    // same fixture differently — «سانتاندير» against «راسينج سانتاندير» — so a
    // fuzzy check on the same competition and the same distinctive words runs
    // before the row is kept as a separate match.
    const near = [...seen.entries()].find(([existingKey]) => sameFixture(existingKey, k));
    if (near) {
      absorbed.add(near[1]);
      continue;
    }
    // Then the consonant frame, for the spellings the key above cannot fold
    // («فينورد» / «فيينورد», «لايبزيج» / «لايبزج»).
    const twin = byFrame.get(frameOf(row));
    if (twin && absorb(seen.get(key(twin)) ?? twin, row)) continue;
    // Last, one club and the kickoff (see `slotTwin`). Only when no frame twin
    // exists: a frame twin with a different score is a conflict to keep visible.
    if (!twin) {
      const kept = slotTwin(row);
      if (kept && absorb(kept, row)) continue;
    }
    seen.set(k, row);
    remember(row);
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
  // A club the feeds name differently is shown under one name everywhere, even
  // when only one row exists that day: «صباح باكو» is not a club a reader can
  // recognise, and the app should never print it (#47).
  for (const row of seen.values()) {
    row.home = canonicalClub(row.home);
    row.away = canonicalClub(row.away);
  }
  // One id and one name per competition, so every strip opens its page.
  for (const [k, row] of seen) seen.set(k, settleCompetition(row));

  // The competition's own priority decides the order (Egypt first), so the app
  // renders what it is served and every screen agrees. Unknown competitions sort
  // last, then by name and kickoff time.
  const rankOf = (m: MatchRow): number =>
    COMPETITIONS.find((c) => c.id === m.competitionId)?.priority ?? 99;
  return [...seen.values()].sort(
    (a, b) =>
      rankOf(a) - rankOf(b) ||
      a.competitionName.localeCompare(b.competitionName, 'ar') ||
      (a.kickoff ?? '99:99').localeCompare(b.kickoff ?? '99:99'),
  );
}
