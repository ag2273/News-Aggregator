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

