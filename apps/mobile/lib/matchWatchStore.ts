// The matches the reader follows for live alerts, shared by every screen.
//
// The match centre's button and the bell on each day-list card read the same set,
// so following from one is visible on the other without a refetch. The server is
// the record (matchWatch.ts); this is the session's copy of it.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  ApiError,
  fetchMatchWatches,
  unwatchFootballMatch,
  watchFootballMatch,
  type MatchWatch,
} from './api';

let watched: ReadonlySet<string> = new Set();
let loadedFor: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Iterable<string>): void {
  watched = new Set(next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Load the server's list once per signed-in token. */
async function ensureLoaded(token: string): Promise<void> {
  if (loadedFor === token) return;
  if (loading) return loading;
  loading = fetchMatchWatches(token)
    .then((list: MatchWatch[]) => {
      loadedFor = token;
      publish(list.map((w) => w.matchId));
    })
    .catch(() => {
      /* the bells stay off; a tap still works and reloads the list */
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** What a tap ended in, for the screen's one-line confirmation. */
export type WatchOutcome = 'on' | 'off' | 'finished' | 'limit' | 'failed';

/** The sentence each outcome is shown with. */
export function watchOutcomeText(outcome: WatchOutcome): string {
  switch (outcome) {
    case 'on':
      return 'هتوصلك كل أحداث المباراة: الأهداف والكروت والتبديلات والبداية والاستراحة والنهاية.';
    case 'off':
      return 'وقفت متابعة المباراة.';
    case 'finished':
      return 'المباراة انتهت، مفيش أحداث جديدة تتابعها.';
    case 'limit':
      return 'بتتابع أقصى عدد من المباريات. وقّف متابعة واحدة الأول.';
    case 'failed':
      return 'تعذّر تغيير المتابعة. حاول مرة أخرى.';
  }
}

/** Flip the follow on one match. Optimistic, rolled back on failure. */
export async function toggleMatchWatch(token: string, matchId: string, date: string): Promise<WatchOutcome> {
  const before = watched;
  const on = !before.has(matchId);
  const next = new Set(before);
  if (on) next.add(matchId);
  else next.delete(matchId);
  publish(next);
  try {
    const list = on ? await watchFootballMatch(token, matchId, date) : await unwatchFootballMatch(token, matchId);
    loadedFor = token;
    publish(list.map((w) => w.matchId));
    return on ? 'on' : 'off';
  } catch (err) {
    publish(before);
    if (err instanceof ApiError && err.code === 'finished') return 'finished';
    if (err instanceof ApiError && err.code === 'limit') return 'limit';
    return 'failed';
  }
}

/** The followed match ids, loaded for this token. */
export function useWatchedMatches(token: string | null | undefined): {
  watched: ReadonlySet<string>;
  toggle: (matchId: string, date: string) => Promise<WatchOutcome>;
} {
  useEffect(() => {
    if (token) void ensureLoaded(token);
    else if (loadedFor) {
      loadedFor = null;
      publish([]);
    }
  }, [token]);
  const set = useSyncExternalStore(subscribe, () => watched, () => watched);
  const toggle = useCallback(
    async (matchId: string, date: string): Promise<WatchOutcome> =>
      token ? toggleMatchWatch(token, matchId, date) : 'failed',
    [token],
  );
  return { watched: set, toggle };
}

/** Test helper. */
export function _resetMatchWatchStore(): void {
  watched = new Set();
  loadedFor = null;
  loading = null;
  listeners.clear();
}
