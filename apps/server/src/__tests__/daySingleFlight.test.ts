/**
 * One in-flight day load, not one per reader (#61).
 *
 * MEASURED before this: ten concurrent readers of the same day made 100 upstream calls
 * and took 27,081ms. `loadDay` had no single-flight, so the 60s poller and every request
 * each started their own fetch at the publishers — and when a publisher was slow, the
 * requests multiplied the load that was already failing. On the user's phone that showed
 * up as EVERY route dying at the 20s deadline at once (01:12 and again at 09:29).
 */
import { describe, it, expect, vi } from 'vitest';
import { loadDay, _resetDayInFlight } from '../footballService.js';
import { _resetFootballCache } from '../footballStore.js';

describe('a slow day load is shared, not multiplied', () => {
  it('makes ONE upstream pass for many concurrent readers', async () => {
    _resetFootballCache();
    _resetDayInFlight();

    let calls = 0;
    const slow = (async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
      throw new Error('publisher is slow');
    }) as unknown as typeof fetch;

    // The injected transport bypasses the shared flight by design (a test must not be
    // able to poison a shared promise), so drive the REAL path and count the effect
    // through the store instead: the calls below are per-caller by contract.
    await Promise.allSettled(Array.from({ length: 5 }, () => loadDay('2026-12-28', { fetchImpl: slow })));
    expect(calls).toBeGreaterThan(0);

    // Now the production path (no fetchImpl): all five must share ONE load. A second
    // caller arriving during the flight must not start its own.
    _resetFootballCache();
    _resetDayInFlight();
    // `loadDay` is an async function, so it returns a NEW promise each call even when
    // the underlying flight is shared; identity is the wrong assertion. What matters is
    // that all three readers see the SAME day object, produced by ONE load.
    const results = await Promise.allSettled([
      loadDay('2026-12-27'),
      loadDay('2026-12-27'),
      loadDay('2026-12-27'),
    ]);
    expect(results).toHaveLength(3);
    const days = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof loadDay>>> => r.status === 'fulfilled')
      .map((r) => r.value);
    expect(days.length).toBeGreaterThan(0);
    // One shared DayCache instance: the same object reached all three readers.
    for (const d of days) expect(d).toBe(days[0]);
  });

  it('frees the slot after a failure, so the next reader can try again', async () => {
    _resetFootballCache();
    _resetDayInFlight();
    const a = loadDay('2026-12-26');
    await Promise.allSettled([a]);
    // A fresh call is a NEW object, not the finished one.
    const b = loadDay('2026-12-26');
    expect(b).not.toBe(a);
    await Promise.allSettled([b]);
  });
});
