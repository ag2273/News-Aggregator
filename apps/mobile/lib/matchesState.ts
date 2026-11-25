// The rule that keeps the matches screen honest about time (#60).
//
// The user's report: «جاري التحميل» never went away. Two separate faults produced
// that, and this module is where both are fixed so they can be pinned by tests:
//
//   1. A request with no deadline never settles, so the state that says "refresh in
//      flight" never clears. `withDeadline` guarantees the await ends.
//   2. Even when it ends, the notice text has to be the truthful one for what happened.
//
// Nothing here invents data: the messages describe the state of the reader's screen.

/**
 * How long the matches screen waits for its own request.
 *
 * Shorter than the generic API deadline on purpose: this is a list a reader is staring
 * at, and the copy on screen is already useful. Past this, say the refresh failed and
 * keep the copy. Measured baseline: the endpoint answered in ~1.1s warm from a phone,
 * so 12s is an order of magnitude of slack, not a normal-case limit.
 */
export const MATCHES_FETCH_DEADLINE_MS = 12_000;

/**
 * Await `promise`, but stop waiting after `ms` and reject.
 *
 * The point is not the rejection — it is that the `await` ENDS, so `finally` blocks run
 * and a spinner cannot outlive the attempt. The underlying promise is not cancelled by
 * this (the API layer's own `AbortSignal` does that); a late answer is simply ignored
 * by the caller's run id.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('timeout'), { timeout: true }));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type MatchFetchFailure = 'timeout' | 'offline' | 'server';

/**
 * Classify a failed matches request.
 *
 * Only used to choose the Arabic sentence: `timeout` is the case the user hit, where
 * the old screen gave no sentence at all because it never stopped waiting.
 */
export function classifyFailure(err: unknown, isNetwork: (e: unknown) => boolean): MatchFetchFailure {
  if (err && typeof err === 'object' && (err as { timeout?: unknown }).timeout === true) {
    return 'timeout';
  }
  if (err instanceof Error && /timeout/i.test(err.message)) return 'timeout';
  if (isNetwork(err)) return 'offline';
  return 'server';
}

/** The sentence for a failure with nothing usable on screen. */
export function failureMessage(kind: MatchFetchFailure): string {
  if (kind === 'timeout') return 'الاتصال بطيء جدًا. جرّب تحديث المباريات تاني.';
  if (kind === 'offline') return 'تعذّر الاتصال. حاول مرة أخرى.';
  return 'تعذّر تحميل المباريات.';
}

/** The sentence for a failure while an older copy is still on screen. */
export function staleFailureMessage(kind: MatchFetchFailure): string {
  if (kind === 'timeout') return 'التحديث أخد وقت طويل — المعروض آخر نسخة متاحة';
  return 'تعذّر تحديث النتائج — المعروض آخر نسخة متاحة';
}
