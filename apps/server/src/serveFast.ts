// The server must serve through a slow or dead dependency (#58).
//
// WHAT WENT WRONG
// ---------------
// `GET /api/feed` awaited `refreshAll()`, which fetches all 29 feeds — up to 25s each
// on a bad night. So the app's every request waited on the internet. With no
// in-flight guard, N concurrent readers meant N full ingests, and on a 1GB/2-vCPU box
// that is how a page that used to be instant became "it opened but never loaded".
//
// The rules below are the fix, and they are plain functions so they can be pinned:
//
//   1. `/api/feed` never waits for the network. It serves what is stored now, and
//      starts a refresh in the BACKGROUND if one is due.
//   2. Only one refresh runs at a time, ever. A second caller joins the running one
//      instead of starting a second sweep of 29 feeds.
//   3. A refresh that never finishes still frees the lock, so the next tick can try
//      again instead of the server staying "busy" forever.

/** Marker returned when a caller joins an already-running refresh. */
export const JOINED = 'joined' as const;
/** Marker returned by the singleflight when a refresh has finished. */
export const STARTED = 'started' as const;

/**
 * Run `task` at most once at a time.
 *
 * A caller that arrives while one is running gets the SAME promise (so it can wait if
 * it wants to) rather than starting a second run. `task` errors are the task's own
 * problem: the slot is released either way, which is what keeps a hung run from
 * locking the server out of all future refreshes.
 */
export function singleFlight<T>(
  task: () => Promise<T>,
  state: { running: Promise<T> | null } = { running: null },
): { promise: Promise<T>; joined: boolean } {
  if (state.running) return { promise: state.running, joined: true };
  const promise = task().finally(() => {
    state.running = null;
  });
  state.running = promise;
  return { promise, joined: false };
}

/**
 * Should a request start a background refresh, or leave the timer to it?
 *
 * Measured: a full sweep of 29 feeds costs 4.3s of *blocking* CPU on the production
 * store (20,155,190 bytes, 21,409 rows) purely in re-serialising the JSON, plus the
 * network time. So a request must never trigger one on the strength of a single
 * miss — only when the data is older than the window the app promises.
 */
export function shouldRefresh(args: {
  now: number;
  lastRefreshAt: number;
  intervalMs: number;
  running: boolean;
}): boolean {
  if (args.running) return false;
  return args.now - args.lastRefreshAt >= args.intervalMs;
}
