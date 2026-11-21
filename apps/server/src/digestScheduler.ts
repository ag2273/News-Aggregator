// The twice-daily scheduler.
//
// In-process, next to the existing 10-minute ingest ticker, because the deploy is
// one container and a restart must not lose the schedule. Idempotency is the
// property that matters: the ticker fires every minute, and a digest for a slot
// is built at most once. That is enforced by asking the store whether the slot
// key already exists, not by remembering the last tick.

import {
  CAIRO_OFFSET_MS,
  dueSlot,
  digestForSlot,
  latestDigest,
  slotKeyDueAt,
  type DigestSlot,
} from './digestStore.js';
import { buildDigest, describeBuild } from './digest.js';
import { getFeedArticles } from './ingest.js';
import { loadApiKey } from './digestAi.js';
import { sendDigestNotifications } from './push.js';
import { digestForTopics, topicsFor } from './digestStore.js';

/** How often the ticker checks. One minute is cheap and makes 09:00 exact. */
export const TICK_MS = 60 * 1000;

/** Never build twice for the same slot. */
export interface SchedulerState {
  /** The last slot key we attempted, so a failure is not retried every minute. */
  lastAttempt: string | null;
  /** Set while a build is in flight, so a slow run cannot overlap the next tick. */
  running: boolean;
}

export const state: SchedulerState = { lastAttempt: null, running: false };

export function _resetScheduler(): void {
  state.lastAttempt = null;
  state.running = false;
}

export interface TickOptions {
  now?: number;
  /** Seams for tests. */
  articles?: () => ReturnType<typeof getFeedArticles>;
  apiKey?: string | null;
  fetchText?: Parameters<typeof buildDigest>[0]['fetchText'];
  fetchImpl?: typeof fetch;
  /** Set false in tests that only assert the build. */
  notify?: boolean;
  notifyImpl?: typeof sendDigestNotifications;
  /** Overridable so tests do not touch the store. */
  hasSlot?: (key: string) => boolean;
  build?: typeof buildDigest;
}

/**
 * One scheduler tick. Returns what it did, which is what the tests assert.
 *
 * `built` means a digest for the due slot was stored; `skipped` means there was
 * nothing to do (no slot due, already built, or a build is running).
 */
export async function tick(
  options: TickOptions = {},
): Promise<{ action: 'built' | 'failed' | 'skipped'; slot?: DigestSlot; reason?: string }> {
  const now = options.now ?? Date.now();
  if (state.running) return { action: 'skipped', reason: 'a build is already running' };

  const due = dueSlot(now);
  if (!due) return { action: 'skipped', reason: 'no slot due yet' };

  const hasSlot = options.hasSlot ?? ((key: string) => digestForSlot(key) !== null);
  if (hasSlot(due.key)) return { action: 'skipped', reason: 'already built for this slot' };

  // A failed attempt is not retried on every tick: the previous digest is served
  // until the next slot, which is the documented behaviour.
  if (state.lastAttempt === due.key) return { action: 'skipped', reason: 'already attempted' };

  state.running = true;
  state.lastAttempt = due.key;
  try {
    const apiKey = options.apiKey === undefined ? loadApiKey() : options.apiKey;
    const articles = (options.articles ?? getFeedArticles)();
    const previous = latestDigest();
    // Window start = when the previous slot became due, never when it happened to
    // be built. A late rebuild would otherwise starve this run: measured, a
    // 09:00 slot rebuilt at 16:00 left the 18:00 digest 4 candidates.
    const since = previous ? slotKeyDueAt(previous.slot) : undefined;
    const result = await (options.build ?? buildDigest)({
      slot: due.slot,
      now,
      articles,
      since,
      apiKey,
      fetchText: options.fetchText,
      fetchImpl: options.fetchImpl,
    });
    console.log(describeBuild(result, due.slot));
    if (result.digest) {
      // Push once per device that opted in, after the digest exists, so a
      // notification can never point at a digest that failed to build.
      // Usage is counted at the API route (a digest open), not here: a build is
      // server work, not a reader action.
      if (options.notify !== false) {
        try {
          const sent = await (options.notifyImpl ?? sendDigestNotifications)({
            slot: result.digest.slot,
            count: digestForTopics(result.digest, topicsFor(null)).length,
          });
          if (sent) console.log(`[digest] notified ${sent} device(s)`);
        } catch (err) {
          console.error('[digest] notification failed:', err);
        }
      }
      return { action: 'built', slot: due.slot };
    }
    return { action: 'failed', slot: due.slot, reason: result.error };
  } catch (err) {
    console.error('[digest] build threw:', err);
    return {
      action: 'failed',
      slot: due.slot,
      reason: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    };
  } finally {
    state.running = false;
  }
}

/** Start the ticker. Returns a stop function, like the ingest interval. */
export function startDigestScheduler(options: { intervalMs?: number } = {}): () => void {
  const every = options.intervalMs ?? TICK_MS;
  const timer = setInterval(() => {
    void tick().catch((err) => console.error('[digest] tick failed:', err));
  }, every);
  // Do not hold the process open just for this timer.
  timer.unref?.();
  return () => clearInterval(timer);
}
