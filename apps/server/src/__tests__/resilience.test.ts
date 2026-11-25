// The production hang of 2026-11-25 (#58).
//
// Two defects, both measured, both fixed here:
//
// 1. A publisher closing an HTTP/2 stream raised an UNCAUGHT exception and killed the
//    process. Reproduced locally: a TLS h2 server that closes a stream mid-body makes
//    undici emit `error` on the stream, and node exits. The container then restarted,
//    re-ingested 29 feeds, and did it again. Each restart served for a few minutes,
//    which is exactly what the user felt as "it opens but news never loads".
//
// 2. `GET /api/feed` awaited a full 29-feed refresh, with no in-flight guard, so every
//    reader waited on the internet and N readers meant N sweeps.
//
// These pin the guard and the single-flight, and prove the guard does NOT hide an
// unrelated crash.

import { describe, it, expect } from 'vitest';
import {
  isPublisherStreamFailure,
  installPublisherErrorGuard,
  makePublisherErrorHandler,
} from '../netGuard.js';
import { singleFlight, shouldRefresh } from '../serveFast.js';

describe('a publisher’s broken connection stops being fatal', () => {
  it('recognises the exact error from the production crash log', () => {
    // The log line: Error [ERR_HTTP2_STREAM_ERROR]: Stream closed with error code
    // NGHTTP2_PROTOCOL_ERROR
    const crash = Object.assign(new Error('Stream closed with error code NGHTTP2_PROTOCOL_ERROR'), {
      code: 'ERR_HTTP2_STREAM_ERROR',
    });
    expect(isPublisherStreamFailure(crash)).toBe(true);
  });

  it('recognises the other connection failures these outlets produce', () => {
    for (const code of [
      'ERR_HTTP2_STREAM_CANCEL',
      'ERR_HTTP2_SESSION_ERROR',
      'ERR_HTTP2_GOAWAY_SESSION',
      'UND_ERR_SOCKET',
      'UND_ERR_CLOSED',
      'ECONNRESET',
      'EPIPE',
    ]) {
      expect(isPublisherStreamFailure(Object.assign(new Error(code), { code }))).toBe(true);
    }
  });

  it('does not swallow our own bugs', () => {
    // A TypeError is a programming error, not a publisher. It must still crash.
    expect(isPublisherStreamFailure(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isPublisherStreamFailure(new Error('boom'))).toBe(false);
    expect(isPublisherStreamFailure(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false);
    expect(isPublisherStreamFailure(null)).toBe(false);
    expect(isPublisherStreamFailure('ERR_HTTP2_STREAM_ERROR')).toBe(false);
  });

  it('keeps the process alive through a publisher error, and logs it', () => {
    const swallowed: unknown[] = [];
    const handle = makePublisherErrorHandler((e) => swallowed.push(e));
    const err = Object.assign(new Error('stream closed'), { code: 'ERR_HTTP2_STREAM_ERROR' });
    // Returns normally: this is what stops node from terminating the process.
    expect(() => handle(err)).not.toThrow();
    expect(swallowed).toStrictEqual([err]);
  });

  it('re-throws an unrelated exception, so a real crash still happens', () => {
    const handle = makePublisherErrorHandler(() => {});
    const bug = new TypeError('a real bug');
    expect(() => handle(bug)).toThrow('a real bug');
  });

  it('uninstalls cleanly, so a test does not leak a global handler', () => {
    // Assert the listener count rather than emitting: with no handler installed,
    // node's own default behaviour is to terminate, which would abort the run.
    const before = process.listenerCount('uncaughtException');
    const uninstall = installPublisherErrorGuard(() => {});
    expect(process.listenerCount('uncaughtException')).toBe(before + 1);
    uninstall();
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });
});

describe('one refresh at a time', () => {
  it('runs the task once for many concurrent callers', async () => {
    // This is the production shape: N readers hitting /api/feed at once.
    let runs = 0;
    let release: () => void = () => {};
    const task = () => {
      runs += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const state = { running: null as Promise<void> | null };
    const a = singleFlight(task, state);
    const b = singleFlight(task, state);
    const c = singleFlight(task, state);

    expect(runs).toBe(1);
    expect(b.joined).toBe(true);
    expect(c.joined).toBe(true);
    release();
    await Promise.all([a.promise, b.promise, c.promise]);
    expect(runs).toBe(1);
  });

  it('releases the slot when the refresh finishes, so the next tick can run', async () => {
    const state = { running: null as Promise<void> | null };
    let runs = 0;
    const task = async () => {
      runs += 1;
    };
    await singleFlight(task, state).promise;
    expect(state.running).toBeNull();
    await singleFlight(task, state).promise;
    expect(runs).toBe(2);
  });

  it('releases the slot even when the refresh throws', async () => {
    // A failed sweep must not lock the server out of every future refresh.
    const state = { running: null as Promise<void> | null };
    await expect(
      singleFlight(async () => {
        throw new Error('feeds down');
      }, state).promise,
    ).rejects.toThrow('feeds down');
    expect(state.running).toBeNull();
  });
});

describe('when a request is allowed to trigger a refresh', () => {
  const intervalMs = 5 * 60 * 1000;

  it('does not refresh while one is already running', () => {
    // Otherwise every reader adds a sweep of 29 feeds.
    expect(
      shouldRefresh({ now: 10_000_000, lastRefreshAt: 0, intervalMs, running: true }),
    ).toBe(false);
  });

  it('does not refresh on every request: only past the interval', () => {
    const base = { intervalMs, running: false };
    expect(shouldRefresh({ ...base, now: 1000, lastRefreshAt: 1000 })).toBe(false);
    expect(shouldRefresh({ ...base, now: 1000 + intervalMs - 1, lastRefreshAt: 1000 })).toBe(false);
    expect(shouldRefresh({ ...base, now: 1000 + intervalMs, lastRefreshAt: 1000 })).toBe(true);
  });
});
