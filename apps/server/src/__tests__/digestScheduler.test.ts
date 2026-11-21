/**
 * The twice-daily scheduler: one build per slot, no double-build on a restart,
 * and a failure that never blanks the app.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tick, _resetScheduler, state, TICK_MS } from '../digestScheduler.js';
import { saveDigest, latestDigest, _resetDigestCache, type StoredDigest } from '../digestStore.js';
import type { BuildResult } from '../digest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');

/** 10:00 Cairo: the morning slot is due. */
const MORNING = Date.UTC(2026, 10, 21, 8, 0);
/** 19:00 Cairo: the evening slot is due. */
const EVENING = Date.UTC(2026, 10, 21, 17, 0);
/** 07:00 Cairo: nothing is due. */
const TOO_EARLY = Date.UTC(2026, 10, 21, 5, 0);

function reset(): void {
  try {
    fs.rmSync(path.join(DATA_DIR, 'digests.json'), { force: true });
  } catch {
    /* ignore */
  }
  _resetDigestCache();
  _resetScheduler();
}

function builtSlot(slot: string): BuildResult {
  const digest: StoredDigest = {
    slot,
    builtAt: Date.now(),
    considered: 5,
    analysed: 5,
    failedSources: {},
    model: 'test',
    items: [],
  };
  saveDigest(digest);
  return { digest, considered: 5, analysed: 5 };
}

const failing: BuildResult = { digest: null, error: 'every model call failed', considered: 5, analysed: 0 };

beforeEach(reset);

describe('digestScheduler', () => {
  it('does nothing before 09:00 Cairo', async () => {
    let called = 0;
    const res = await tick({
      now: TOO_EARLY,
      build: async () => {
        called += 1;
        return failing;
      },
    });
    expect(res.action).toBe('skipped');
    expect(res.reason).toContain('no slot due');
    expect(called).toBe(0);
  });

  it('builds the morning slot once the hour passes', async () => {
    const slot = '09:00';
    const res = await tick({ now: MORNING, build: async () => builtSlot('2026-11-21T09:00') });
    expect(res).toEqual({ action: 'built', slot });
    expect(latestDigest()?.slot).toBe('2026-11-21T09:00');
  });

  it('does not build the same slot twice (a restart must not double-build)', async () => {
    await tick({ now: MORNING, build: async () => builtSlot('2026-11-21T09:00') });
    // Simulate a restart: the in-memory state resets, the store does not.
    _resetScheduler();
    let called = 0;
    const second = await tick({
      now: MORNING + 60_000,
      build: async () => {
        called += 1;
        return builtSlot('2026-11-21T09:00');
      },
    });
    expect(second.action).toBe('skipped');
    expect(second.reason).toContain('already built');
    expect(called).toBe(0);
  });

  it('builds the evening slot independently', async () => {
    await tick({ now: MORNING, build: async () => builtSlot('2026-11-21T09:00') });
    _resetScheduler();
    const res = await tick({ now: EVENING, build: async () => builtSlot('2026-11-21T18:00') });
    expect(res).toEqual({ action: 'built', slot: '18:00' });
    expect(latestDigest()?.slot).toBe('2026-11-21T18:00');
  });

  it('reports a failure and keeps the previous digest', async () => {
    await tick({ now: MORNING, build: async () => builtSlot('2026-11-21T09:00') });
    _resetScheduler();
    const res = await tick({ now: EVENING, build: async () => failing });
    expect(res.action).toBe('failed');
    expect(res.reason).toContain('every model call failed');
    // The reader still has the morning digest, with its own timestamp.
    expect(latestDigest()?.slot).toBe('2026-11-21T09:00');
  });

  it('does not retry a failed slot on every tick', async () => {
    let called = 0;
    await tick({
      now: MORNING,
      build: async () => {
        called += 1;
        return failing;
      },
    });
    const again = await tick({
      now: MORNING + 60_000,
      build: async () => {
        called += 1;
        return failing;
      },
    });
    expect(again.action).toBe('skipped');
    expect(again.reason).toContain('already attempted');
    expect(called).toBe(1);
  });

  it('never overlaps two builds', async () => {
    state.running = true;
    const res = await tick({ now: MORNING, build: async () => builtSlot('x') });
    expect(res.action).toBe('skipped');
    expect(res.reason).toContain('already running');
    state.running = false;
  });

  it('turns a thrown build into a failure, not a crash', async () => {
    const res = await tick({
      now: MORNING,
      build: async () => {
        throw new Error('boom');
      },
    });
    expect(res.action).toBe('failed');
    expect(res.reason).toContain('boom');
    // The scheduler is usable again afterwards.
    expect(state.running).toBe(false);
  });

  it('checks once a minute', () => {
    expect(TICK_MS).toBe(60 * 1000);
  });
});
