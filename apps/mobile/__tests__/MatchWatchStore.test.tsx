/**
 * The follow-a-match store: the match centre's button and the day list's bells
 * share it, a failed tap rolls back, and the server's refusals get their own words.
 */
const mockWatch = jest.fn();
const mockUnwatch = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchMatchWatches: jest.fn(async () => []),
    watchFootballMatch: (...a: unknown[]) => mockWatch(...a),
    unwatchFootballMatch: (...a: unknown[]) => mockUnwatch(...a),
  };
});
import { ApiError } from '../lib/api';
import { toggleMatchWatch, watchOutcomeText, _resetMatchWatchStore } from '../lib/matchWatchStore';

const row = (matchId: string) => ({ matchId, date: '2026-11-27', home: 'أ', away: 'ب', competitionId: 'x', addedAt: 0 });

beforeEach(() => {
  _resetMatchWatchStore();
  mockWatch.mockReset();
  mockUnwatch.mockReset();
});

it('follows, then unfollows', async () => {
  mockWatch.mockResolvedValue([row('fg-1')]);
  mockUnwatch.mockResolvedValue([]);
  expect(await toggleMatchWatch('tok', 'fg-1', '2026-11-27')).toBe('on');
  expect(mockWatch).toHaveBeenCalledWith('tok', 'fg-1', '2026-11-27');
  expect(await toggleMatchWatch('tok', 'fg-1', '2026-11-27')).toBe('off');
  expect(mockUnwatch).toHaveBeenCalledWith('tok', 'fg-1');
});

it('names the server refusals and rolls back', async () => {
  mockWatch.mockRejectedValueOnce(new ApiError(409, 'match is over', 'finished'));
  expect(await toggleMatchWatch('tok', 'fg-2', '')).toBe('finished');
  mockWatch.mockRejectedValueOnce(new ApiError(429, 'too many', 'limit'));
  expect(await toggleMatchWatch('tok', 'fg-2', '')).toBe('limit');
  mockWatch.mockRejectedValueOnce(new TypeError('Network request failed'));
  expect(await toggleMatchWatch('tok', 'fg-2', '')).toBe('failed');
  // Still not followed, so the next tap is a follow again.
  mockWatch.mockResolvedValueOnce([row('fg-2')]);
  expect(await toggleMatchWatch('tok', 'fg-2', '')).toBe('on');
  expect(watchOutcomeText('finished')).toMatch(/انتهت/);
});
