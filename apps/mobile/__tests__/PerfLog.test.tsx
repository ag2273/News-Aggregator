/**
 * The performance log (#60) and the rule that a spinner must always end.
 *
 * The user asked for on-device logging so a slowdown that only reproduces on their
 * phone can be found: timings and route names, never content, never uploaded. These
 * pin the two properties that make it safe to hand over and useful to read.
 */

jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

// A tiny in-memory filesystem, so the log can be exercised without a device.
const files: Record<string, string> = {};
jest.mock('expo-file-system', () => {
  class FakeDir {
    constructor(..._parts: unknown[]) {}
    get exists() {
      return true;
    }
    create() {}
  }
  class FakeFile {
    private key: string;
    constructor(...parts: unknown[]) {
      this.key = parts.map((p) => (typeof p === 'string' ? p : 'dir')).join('/');
    }
    get exists() {
      return this.key in files;
    }
    async text() {
      return files[this.key] ?? '';
    }
    async write(body: string) {
      files[this.key] = body;
    }
  }
  return { Directory: FakeDir, File: FakeFile, Paths: { cache: 'cache' } };
});

import {
  formatLine,
  logEvent,
  readLog,
  flush,
  _resetPerfLog,
  PERF_LOG_LIMIT,
} from '../lib/perfLog';
import {
  MATCHES_FETCH_DEADLINE_MS,
  withDeadline,
  classifyFailure,
  failureMessage,
  staleFailureMessage,
} from '../lib/matchesState';

beforeEach(() => {
  _resetPerfLog();
  for (const k of Object.keys(files)) delete files[k];
});

describe('one log line', () => {
  it('carries the time, the kind, the name and key=value detail', () => {
    const line = formatLine('net', '/api/feed', { ms: 42, status: 200 });
    // HH:MM:SS.mmm | kind | name | key=value
    expect(line).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} \| net \| \/api\/feed \| ms=42 status=200$/);
  });

  it('omits absent detail instead of printing undefined', () => {
    const line = formatLine('boot', 'root-rendered', { signedIn: undefined });
    expect(line).not.toContain('undefined');
    expect(line.endsWith('root-rendered')).toBe(true);
  });

  it('never needs a newline inside a line', () => {
    logEvent('cache', 'matches-read', { bytes: 12000 });
    return readLog().then((log) => {
      expect(log.split('\n').filter(Boolean)).toHaveLength(1);
    });
  });
});

describe('the log is bounded and local', () => {
  it('keeps only the newest lines, so it cannot grow without limit', async () => {
    for (let i = 0; i < PERF_LOG_LIMIT + 25; i += 1) {
      logEvent('net', `/api/x${i}`, { ms: i });
    }
    await flush();
    const log = await readLog();
    const lines = log.split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(PERF_LOG_LIMIT);
    // The newest survive; the oldest are dropped.
    expect(log).toContain(`/api/x${PERF_LOG_LIMIT + 24}`);
    expect(log).not.toContain('/api/x0 ');
  });

  it('batches to disk instead of writing per line', async () => {
    logEvent('net', '/api/a', { ms: 1 });
    logEvent('net', '/api/b', { ms: 2 });
    // Nothing written until the flush — no per-line disk work on the main thread.
    expect(Object.keys(files)).toHaveLength(0);
    await flush();
    expect(Object.keys(files).length).toBeGreaterThan(0);
  });

  it('pins no content: only timings and route names are logged', () => {
    logEvent('net', '/api/articles/reader', { ms: 9, status: 200 });
    return readLog().then((log) => {
      // The assertion is about the SHAPE: a duration and a route, no article text.
      expect(log).toContain('ms=');
      expect(log).toContain('/api/articles/reader');
      expect(log).not.toMatch(/[\u0600-\u06FF]{20,}/); // no Arabic prose
    });
  });
});

describe('a spinner always ends (#60)', () => {
  it('gives up on a request that never settles, instead of hanging forever', async () => {
    // The reported bug: a dropped connection left «جاري التحديث…» on screen for good.
    const never = new Promise<string>(() => {});
    await expect(withDeadline(never, 30)).rejects.toMatchObject({ timeout: true });
  });

  it('returns the value when the request is fast enough', async () => {
    await expect(withDeadline(Promise.resolve('ok'), 30)).resolves.toBe('ok');
  });

  it('propagates a real failure rather than turning it into a timeout', async () => {
    const boom = Object.assign(new Error('server said no'), { network: false });
    await expect(withDeadline(Promise.reject(boom), 30)).rejects.toBe(boom);
  });

  it('uses a deadline longer than the slowest measured endpoint', () => {
    // Measured: the match centre answered in ~2s. A deadline near that would cut off
    // a working phone; 12s is slack, not a normal-case limit.
    expect(MATCHES_FETCH_DEADLINE_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('the message matches what happened', () => {
  it('names a timeout as a slow connection, not a generic error', () => {
    const kind = classifyFailure(Object.assign(new Error('x'), { timeout: true }), () => false);
    expect(kind).toBe('timeout');
    expect(failureMessage(kind)).toMatch(/بطيء/);
    expect(staleFailureMessage(kind)).toMatch(/وقت طويل/);
  });

  it('tells offline apart from a server error', () => {
    expect(classifyFailure(new TypeError('Network request failed'), () => true)).toBe('offline');
    expect(classifyFailure(new Error('500'), () => false)).toBe('server');
    expect(failureMessage('offline')).toMatch(/تعذّر الاتصال/);
    expect(failureMessage('server')).toMatch(/تعذّر تحميل/);
  });

  it('keeps the honest wording when an older copy stays on screen', () => {
    expect(staleFailureMessage('server')).toContain('آخر نسخة');
  });
});
