/**
 * The fixes driven by the user's real performance log (#60).
 *
 * The log from their phone showed three distinct faults, and each gets a test here:
 *   1. the reader failed three times, each dying at the 20s deadline, with no retry;
 *   2. a late answer arrived AFTER the screen gave up, and was thrown away;
 *   3. the notification/spinner lifecycle had to keep ending honestly.
 */

jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

const mockFetch = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return { ...actual, fetchMatches: (...a: unknown[]) => (globalThis as any).__fm(...a), isNetworkFailure: () => true };
});
(globalThis as any).__fm = mockFetch;

jest.mock('expo-file-system', () => ({
  Directory: class { constructor(..._a: unknown[]) {} get exists() { return true; } create() {} },
  File: class { constructor(..._a: unknown[]) {} get exists() { return false; } async text() { return ''; } async write() {} },
  Paths: { cache: 'c' },
}));

import {
  fetchReaderWithRetry,
  readerKey,
  storedReaderUsable,
  STORED_READER_TTL_MS,
  READER_RETRY_BASE_MS,
} from '../lib/readerResilience';
import type { ReaderArticle } from '../lib/api';
import { renderHook, act } from '@testing-library/react-native';
import { useMatchesDay } from '../lib/useMatchesDay';

const body: ReaderArticle = {
  title: 'خبر',
  readable: true,
  blocks: [{ type: 'paragraph', text: 'نص الخبر كما استخرجه السيرفر.' }],
};

describe('the reader gets one bounded retry, not three 20s waits', () => {
  it('succeeds on the second attempt after one failure', async () => {
    let calls = 0;
    const fetchReader = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Network request failed: timeout');
      return body;
    };
    const result = await fetchReaderWithRetry('a1', 'https://x/1', {
      fetchReader,
      sleep: async () => {},
    });
    expect(result).toBe(body);
    expect(calls).toBe(2);
  });

  it('gives up after two attempts and does not loop', async () => {
    // A dead server must not be retried forever: the reader would wait for nothing.
    let calls = 0;
    const fetchReader = async () => {
      calls += 1;
      throw new TypeError('Network request failed: timeout');
    };
    await expect(
      fetchReaderWithRetry('a1', 'https://x/1', { fetchReader, sleep: async () => {} }),
    ).rejects.toBeTruthy();
    expect(calls).toBe(2);
  });

  it('returns the first answer when it works, with no retry', async () => {
    let calls = 0;
    const fetchReader = async () => {
      calls += 1;
      return body;
    };
    await fetchReaderWithRetry('a1', 'https://x/1', { fetchReader, sleep: async () => {} });
    expect(calls).toBe(1);
  });

  it('waits a short, bounded pause between attempts', () => {
    // Long enough to ride out a blip, short enough that the reader does not notice.
    expect(READER_RETRY_BASE_MS).toBeLessThanOrEqual(1000);
  });
});

describe('a stored body is only shown for its own article', () => {
  const now = 1_000_000_000_000;
  const stored = { article: body, storedAt: now, key: readerKey('a1', 'https://x/1') };

  it('is usable for the same article inside its window', () => {
    expect(storedReaderUsable(stored, readerKey('a1', 'https://x/1'), now)).toBe(true);
  });

  it('is never shown for a different article', () => {
    // The one rule that cannot bend: a body under the wrong headline is a lie.
    expect(storedReaderUsable(stored, readerKey('a2', 'https://x/2'), now)).toBe(false);
  });

  it('expires, and refuses an unreadable or empty body', () => {
    expect(storedReaderUsable(stored, stored.key, now + STORED_READER_TTL_MS + 1)).toBe(false);
    const unreadable = { ...stored, article: { ...body, readable: false } };
    expect(storedReaderUsable(unreadable, stored.key, now)).toBe(false);
    const empty = { ...stored, article: { ...body, blocks: [] } };
    expect(storedReaderUsable(empty, stored.key, now)).toBe(false);
    expect(storedReaderUsable(null, stored.key, now)).toBe(false);
  });

  it('keys by id when the app has one, so a redirect cannot confuse it', () => {
    expect(readerKey('a1', 'https://anything')).toBe('id:a1');
    expect(readerKey(null, 'https://x/1')).toBe('url:https://x/1');
  });
});

describe('a late answer replaces the copy without a second spinner', () => {
  const mockFetch = (globalThis as any).__fm as jest.Mock;

  const day = (d: string, home: string) =>
    ({ date: d, unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], competitions: [], matches: [{ home }] }) as never;

  it('shows the stored copy, then the late answer, with no extra spinner', async () => {
    jest.useFakeTimers();
    try {
      const store = {
        read: async () => ({ day: day('2026-11-26', 'قديم'), storedAt: Date.now() - 5 * 60 * 1000 }),
        write: async () => {},
      };
      // The answer arrives after the 12s deadline.
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(day('2026-11-26', 'متأخر')), 14_000)),
      );
      const v = renderHook(() => useMatchesDay({ date: '2026-11-26', token: null, store }));

      await act(async () => { await Promise.resolve(); });
      // The stored copy is on screen, and the badge is up.
      expect((v.result.current as { day: { matches: { home: string }[] } }).day.matches[0]!.home).toBe('قديم');

      // Past the deadline: the badge ends honestly.
      await act(async () => {
        jest.advanceTimersByTime(13_000);
        await Promise.resolve();
      });
      expect((v.result.current as { refreshing: boolean }).refreshing).toBe(false);

      // The late answer still lands, silently.
      await act(async () => {
        jest.advanceTimersByTime(3_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      const end = v.result.current as { day: { matches: { home: string }[] }; updatingLabel: string | null; staleNotice: string | null };
      expect(end.day.matches[0]!.home).toBe('متأخر');
      expect(end.updatingLabel).toBeNull();
      expect(end.staleNotice).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
