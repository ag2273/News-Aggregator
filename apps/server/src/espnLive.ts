// Borrowing ESPN's live clock for the fixtures we already serve (issue #36).
//
// The day's rows come from FilGoal, which has no usable clock. ESPN has one, but
// only for the eight leagues we give it a slug for. This module fetches exactly
// those scoreboards (one request each, no more than the day loader already makes
// when it needs the fallback) and returns the clock for any fixture it can prove is
// the same match.
//
// WHAT IT WILL NOT DO
// -------------------
// * It never returns a minute for a fixture it cannot pair with an ESPN event.
// * It never returns a minute for a halftime interval: ESPN keeps `state: "in"`
//   through 14-15 minutes of half-time, and that is not a live minute.
// * It never invents stoppage time. When ESPN publishes `90'+4'`, that label is
//   shown as sent; when it publishes only `45:00`, the app shows 45 and stops.

import { COMPETITIONS, ESPN_BASE, getPage, type Competition } from './football.js';
import {
  parseEspnClock,
  type EspnClock,
} from './espnClock.js';
import { arabicNameOf, sameClubs } from './espnLink.js';

/** One live fixture ESPN knows the clock for, keyed by the club pair. */
export type EspnLive = EspnEvent;

interface EspnEvent {
  id: string;
  /** ESPN's own Latin club names, as sent. */
  homeEn: string;
  awayEn: string;
  /** The Arabic names those clubs are written as in our own rows. */
  homeAr: string;
  awayAr: string;
  clock: EspnClock;
}

/**
 * Every live event on one competition's scoreboard, with its clock.
 *
 * One request per competition. A competition whose payload is unreadable
 * contributes nothing rather than failing the whole refresh.
 */
export async function fetchEspnLive(
  competition: Competition,
  fetchImpl: typeof fetch = fetch,
  date?: string,
): Promise<EspnEvent[]> {
  if (!competition.espnSlug) return [];
  const stamp = date ? `?dates=${date.replace(/-/g, '')}` : '';
  const body = await getPage(`${ESPN_BASE}/${competition.espnSlug}/scoreboard${stamp}`, fetchImpl);
  if (!body) return [];
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }
  return parseEspnLive(json);
}

/** Read live events out of one scoreboard payload. Exported for the tests. */
export function parseEspnLive(json: unknown): EspnEvent[] {
  const events = ((json as { events?: unknown[] }).events ?? []) as Array<Record<string, any>>;
  const out: EspnEvent[] = [];
  for (const event of events) {
    const block = (event['competitions'] as Array<Record<string, any>> | undefined)?.[0];
    if (!block) continue;
    const clock = parseEspnClock(block['status']);
    // No clock at all is not something to lend out. A half-time interval IS kept:
    // the row needs it to say «استراحة» rather than a frozen 45 beside a live dot.
    if (!clock) continue;
    const competitors = (block['competitors'] as Array<Record<string, any>> | undefined) ?? [];
    const home = competitors.find((c) => c['homeAway'] === 'home');
    const away = competitors.find((c) => c['homeAway'] === 'away');
    if (!home || !away) continue;
    const homeEn = String(home['team']?.['displayName'] ?? '');
    const awayEn = String(away['team']?.['displayName'] ?? '');
    const homeAr = arabicNameOf(homeEn);
    const awayAr = arabicNameOf(awayEn);
    // An unmapped club cannot be paired safely, so the fixture is skipped.
    if (!homeAr || !awayAr) continue;
    out.push({ id: String(event['id'] ?? ''), homeEn, awayEn, homeAr, awayAr, clock });
  }
  return out;
}

/**
 * The clock for one of our fixtures, or null when ESPN cannot prove it is the same
 * match.
 *
 * `live` is every live ESPN event gathered this refresh, so the caller pays for the
 * scoreboards once for the whole day rather than once per match.
 */
export function clockFor(
  live: EspnEvent[],
  home: string,
  away: string,
): EspnEvent | null {
  const hits = live.filter((e) => sameClubs(e.homeEn, e.awayEn, home, away));
  // Two ESPN events for one club pair would be a competition mix-up; refusing is
  // the only honest answer, because picking one would be a coin toss.
  return hits.length === 1 ? hits[0]! : null;
}

/** The competitions whose clocks we can borrow: the ones ESPN covers. */
export function espnCompetitions(): Competition[] {
  return COMPETITIONS.filter((c) => Boolean(c.espnSlug));
}

/**
 * How long a borrowed scoreboard is reused.
 *
 * ESPN's clock ticks once a minute, and the day cache is also one minute, so a
 * shorter window would only add requests without adding accuracy. This matters:
 * `/api/football/matches` is called by every reader, and without a cache a single
 * live match would turn each page view into eight upstream requests — the fastest
 * way to get a free source to block us.
 */
const LIVE_TTL_MS = 45 * 1000;

interface LiveCacheEntry {
  at: number;
  events: EspnEvent[];
}

const liveCache = new Map<string, LiveCacheEntry>();
/** One in-flight fetch per key, so concurrent readers share one request burst. */
const liveInFlight = new Map<string, Promise<EspnEvent[]>>();

/** Test seam: forget every cached scoreboard. */
export function resetLiveCache(): void {
  liveCache.clear();
  liveInFlight.clear();
}

/**
 * Every live ESPN event for one Cairo day, across the competitions we cover.
 *
 * Cached for `LIVE_TTL_MS` per day, and a failure is cached too: a source that is
 * down must not be retried once per reader.
 */
export async function fetchEspnLiveDay(
  date: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<EspnLive[]> {
  const cached = liveCache.get(date);
  if (cached && now - cached.at < LIVE_TTL_MS) return cached.events;
  const running = liveInFlight.get(date);
  if (running) return running;
  const job = (async () => {
    try {
      const boards = await Promise.all(
        espnCompetitions().map((c) => fetchEspnLive(c, fetchImpl, date).catch(() => [])),
      );
      const events = boards.flat();
      liveCache.set(date, { at: Date.now(), events });
      return events;
    } finally {
      liveInFlight.delete(date);
    }
  })();
  liveInFlight.set(date, job);
  return job;
}
