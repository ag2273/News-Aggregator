// The matches page, readable from the last copy on the device (#59).
//
// WHY THIS EXISTS
// ---------------
// Measured: `GET /api/football/matches` answered in 1.54s cold and 1.09s warm on
// production, because the server fetches FilGoal and Yallakora for the day. On a
// phone that is a blank spinner on the screen the user opens most, and the cache the
// server keeps is only 60s, so a normal reader hits the slow path constantly.
//
// The rule the user set: open INSTANTLY from the last stored copy, refresh in the
// background, and swap the screen the moment the fresh answer lands. And crucially —
// an old copy must never be presented as current. This module is the part that
// decides what "old" means, so that the honesty rule is pinned by tests rather than
// living in a `useState` somewhere.
//
// WHAT IS STORED
// --------------
// The day's answer exactly as the server sent it (`MatchesDay`), plus the time it was
// stored. Storing the server's own JSON keeps this honest: there is no reshaping that
// could invent a score, and a payload that fails to parse is treated as no cache.

import type { MatchesDay } from './api';

/** One stored day. */
export interface CachedMatches {
  /** The server's answer, verbatim. */
  day: MatchesDay;
  /** When this copy was stored, epoch ms. */
  storedAt: number;
}

/**
 * How long a stored copy may be drawn as plain current content.
 *
 * Measured against the server's own day cache: it refreshes the fixture list every
 * 60s for live games, so anything older than a minute is already behind the source.
 * Three minutes is the window where "these are today's matches" is still a safe
 * statement on a list that is not live-heavy; past it the screen says it is updating.
 */
export const FRESH_MS = 3 * 60 * 1000;

/**
 * How stale a copy may be and still be shown at all.
 *
 * Beyond this the copy is not a useful starting point — a fixture list from yesterday
 * is a different set of matches. The page then waits for the network as before, which
 * is the pre-cache behaviour rather than wrong content.
 *
 * It is also bounded to the SAME Cairo day: a cached "today" opened after midnight is
 * a different day's fixtures, so the day string is checked separately.
 */
export const USABLE_MS = 12 * 60 * 60 * 1000;

/** What the header should say about the copy on screen. */
export type Freshness = 'fresh' | 'stale' | 'expired';

/**
 * How to present a stored copy right now.
 *
 * `fresh`   — draw it as current content, refresh silently.
 * `stale`   — draw it, and say plainly that it is being updated.
 * `expired` — too old (or the wrong day): do not show it as the page's content.
 */
export function freshnessOf(cached: CachedMatches | null, now: number): Freshness {
  if (!cached) return 'expired';
  const age = now - cached.storedAt;
  // A clock that went backwards (timezone change, manual edit) must not make an old
  // copy look new; treat a negative age as stale rather than fresh.
  if (age < 0) return 'stale';
  if (age <= FRESH_MS) return 'fresh';
  if (age <= USABLE_MS) return 'stale';
  return 'expired';
}

/** The key a day is stored under. A cached copy is only ever used for its own day. */
export function cacheKey(date: string, token: string | null | undefined): string {
  // Follows are folded into the key: the same day serves different `followedTeams`
  // to a signed-in reader, and showing one account's pins on another account's screen
  // would be wrong in a way the reader would notice immediately.
  return `matches:${date}:${token ? 'signed' : 'guest'}`;
}

/** Is a stored copy usable for the day being opened? */
export function usableForDay(
  cached: CachedMatches | null,
  date: string,
  now: number,
): boolean {
  if (!cached) return false;
  if (cached.day.date !== date) return false;
  return freshnessOf(cached, now) !== 'expired';
}

/**
 * Should the page say it is updating while showing a stored copy?
 *
 * Only while a refresh is actually in flight, or when the copy is past `FRESH_MS`.
 * Saying "updating" over a copy refreshed two seconds ago would be noise the reader
 * would learn to ignore.
 */
export function shouldShowUpdating(args: {
  freshness: Freshness;
  refreshing: boolean;
}): boolean {
  if (args.freshness === 'expired') return false;
  return args.refreshing || args.freshness === 'stale';
}

/** The word the header uses, so the screen and its test cannot disagree. */
export const UPDATING_LABEL = 'جاري التحديث…';

/**
 * What to say when a refresh FAILED over a stored copy.
 *
 * The copy stays on screen — it is real data — but it must not pass as current. The
 * message names the failure, so a reader is never silently shown yesterday's score as
 * today's.
 */
export const STALE_FAILED_LABEL = 'تعذّر تحديث النتائج — المعروض آخر نسخة متاحة';
