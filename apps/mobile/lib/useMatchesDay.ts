// Open the matches page instantly, then make it true (#59).
//
// The flow, and why each step is where it is:
//
//   1. READ the last copy for this day and draw it, if it is still usable. This is the
//      step that removes the spinner: measured, the endpoint took 1.54s cold and 1.09s
//      warm on production, so the screen was blank for that whole time.
//   2. FETCH in the background immediately. The reader does not wait for it, and the
//      screen swaps the moment it lands.
//   3. WRITE whatever comes back, so the next open is instant too.
//
// The honesty rules live in `matchesCache.ts` and are pinned there: a copy past its
// window says it is updating, a failed refresh keeps the copy but says so, and a copy
// from another day is never shown at all.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMatches, isNetworkFailure } from './api';
import type { MatchesDay } from './api';
import {
  STALE_FAILED_LABEL,
  freshnessOf,
  shouldShowUpdating,
  usableForDay,
} from './matchesCache';
import type { Freshness } from './matchesCache';
import { matchesCacheStore } from './matchesCacheStore';
import type { MatchesCacheStore } from './matchesCacheStore';

export interface MatchesState {
  /** The day currently drawn, from cache or network. */
  day: MatchesDay | null;
  /** True only while there is NOTHING to draw yet. */
  loading: boolean;
  /** True while a refresh is in flight over a copy already on screen. */
  refreshing: boolean;
  /** A message for a failure with nothing usable to show. */
  error: string | null;
  /** A message when a refresh failed over a copy, so the copy is not sold as current. */
  staleNotice: string | null;
  freshness: Freshness;
  /** What the header should say, or null. */
  updatingLabel: string | null;
  reload: () => void;
}

/**
 * One day's matches, cache-first.
 *
 * `store` is injectable so the behaviour can be driven in a test without a filesystem.
 */
export function useMatchesDay(args: {
  date: string;
  token?: string | null;
  store?: MatchesCacheStore;
}): MatchesState {
  const { date, token, store = matchesCacheStore } = args;

  const [day, setDay] = useState<MatchesDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Freshness>('expired');
  // A run id per (date, token): a slow answer for the previous day must never
  // overwrite the day the reader has since switched to.
  const runRef = useRef(0);

  const run = useCallback(async () => {
    const runId = (runRef.current += 1);
    const stillCurrent = () => runRef.current === runId;

    setError(null);
    setStaleNotice(null);

    // 1. The stored copy, if it belongs to this day and is still usable.
    const cached = await store.read(date, token);
    if (!stillCurrent()) return;
    const cachedUsable = usableForDay(cached, date, Date.now());
    if (cachedUsable && cached) {
      setDay(cached.day);
      setFreshness(freshnessOf(cached, Date.now()));
      // There is something on screen now: no spinner, even if the fetch is slow.
      setLoading(false);
    }

    // 2. The network, always — the copy is a starting point, not a final answer.
    setRefreshing(true);
    try {
      const fresh = await fetchMatches(date, token);
      if (!stillCurrent()) return;
      setDay(fresh);
      setFreshness('fresh');
      setLoading(false);
      setStaleNotice(null);
      // 3. Store it for the next open.
      void store.write(date, token, fresh);
    } catch (err) {
      if (!stillCurrent()) return;
      // A failure with a copy on screen keeps the copy and admits it is old. A
      // failure with nothing to show is the old error state.
      if (cachedUsable && cached) {
        setStaleNotice(STALE_FAILED_LABEL);
        setFreshness(freshnessOf(cached, Date.now()));
      } else {
        setError(
          isNetworkFailure(err) ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'تعذّر تحميل المباريات.',
        );
      }
      setLoading(false);
    } finally {
      if (stillCurrent()) setRefreshing(false);
    }
  }, [date, token, store]);

  useEffect(() => {
    // A new day starts with nothing drawn: showing yesterday's list under today's
    // date would be worse than a spinner for a moment.
    setDay(null);
    setLoading(true);
    setFreshness('expired');
    void run();
  }, [run]);

  return {
    day,
    loading,
    refreshing,
    error,
    staleNotice,
    freshness,
    updatingLabel: shouldShowUpdating({ freshness, refreshing }) ? 'جاري التحديث…' : null,
    reload: () => {
      void run();
    },
  };
}

/**
 * Warm the matches cache for today, in the background (#59).
 *
 * Called when the app starts and when the feed refreshes, so opening the page later
 * is instant even on a cold start. Deliberately ONE request, at the reader's own rate:
 * the user's constraint is that the phone must not look like a scraper, and the server
 * is small after #58.
 *
 * A no-op when a usable copy already exists — re-warming a fresh cache would be a
 * request for nothing.
 */
export async function prefetchTodayMatches(args: {
  date: string;
  token?: string | null;
  store?: MatchesCacheStore;
  now?: number;
}): Promise<boolean> {
  const { date, token, store = matchesCacheStore, now = Date.now() } = args;
  try {
    const cached = await store.read(date, token);
    if (usableForDay(cached, date, now) && freshnessOf(cached, now) === 'fresh') return false;
    const fresh = await fetchMatches(date, token);
    await store.write(date, token, fresh);
    return true;
  } catch {
    // A prefetch that fails is not an error the reader should ever see.
    return false;
  }
}
