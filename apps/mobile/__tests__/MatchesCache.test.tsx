/**
 * Opening the matches page from the device cache (#59).
 *
 * The measured problem: `GET /api/football/matches` took 1.54s cold and 1.09s warm on
 * production, so the page the user opens most was a blank spinner for that long.
 *
 * The rule the user set has two halves, and both are tested here:
 *   * open INSTANTLY from the last copy, refresh behind it, swap when it lands;
 *   * never present an old copy as current — say it is updating, and if the refresh
 *     fails say that too, instead of silence.
 */

import {
  FRESH_MS,
  USABLE_MS,
  UPDATING_LABEL,
  STALE_FAILED_LABEL,
  freshnessOf,
  cacheKey,
  usableForDay,
  shouldShowUpdating,
} from '../lib/matchesCache';
import type { CachedMatches } from '../lib/matchesCache';
import { useMatchesDay, prefetchTodayMatches } from '../lib/useMatchesDay';
import type { MatchesDay } from '../lib/api';

jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

// The network, as the page experiences it.
const mockFetchMatches = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchMatches: (...args: unknown[]) => (globalThis as any).__fetchMatches(...args),
    isNetworkFailure: (e: unknown) => (e as any)?.network === true,
  };
});
(globalThis as any).__fetchMatches = mockFetchMatches;

const day = (date: string, home = 'الأهلي'): MatchesDay =>
  ({
    date,
    unavailable: false,
    fetchedAt: Date.now(),
    followedTeams: [],
    followedLeagues: [],
    competitions: [],
    matches: [
      {
        id: 'm1',
        home,
        away: 'الزمالك',
        homeScore: 1,
        awayScore: 0,
        status: 'live',
        kickoff: '20:00',
        competitionId: 'egypt',
        competitionName: 'الدوري المصري',
        competitionPriority: 10,
        dataSource: 'filgoal',
      },
    ],
  }) as unknown as MatchesDay;

const cachedAt = (date: string, storedAt: number, home?: string): CachedMatches => ({
  day: day(date, home),
  storedAt,
});

/** A store that records what was written, so the "next open is instant" path is real. */
function memoryStore(initial: CachedMatches | null = null) {
  let stored = initial;
  return {
    read: jest.fn(async () => stored),
    write: jest.fn(async (_d: string, _t: string | null | undefined, next: MatchesDay) => {
      stored = { day: next, storedAt: Date.now() };
    }),
    get current() {
      return stored;
    },
  };
}

beforeEach(() => {
  mockFetchMatches.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('how long a stored copy may be trusted', () => {
  const now = 1_000_000_000_000;

  it('is fresh inside the window and stale outside it', () => {
    expect(freshnessOf(cachedAt('2026-11-25', now - 1000), now)).toBe('fresh');
    expect(freshnessOf(cachedAt('2026-11-25', now - FRESH_MS + 1), now)).toBe('fresh');
    expect(freshnessOf(cachedAt('2026-11-25', now - FRESH_MS - 1), now)).toBe('stale');
    expect(freshnessOf(cachedAt('2026-11-25', now - USABLE_MS - 1), now)).toBe('expired');
  });

  it('treats a clock that went backwards as stale, never fresh', () => {
    // A timezone change or a manual clock edit must not make an old list look new.
    expect(freshnessOf(cachedAt('2026-11-25', now + 60_000), now)).toBe('stale');
  });

  it('never uses another day’s copy', () => {
    const other = cachedAt('2026-11-24', now);
    expect(usableForDay(other, '2026-11-25', now)).toBe(false);
    expect(usableForDay(cachedAt('2026-11-25', now), '2026-11-25', now)).toBe(true);
  });

  it('keeps a signed-in reader’s copy apart from a guest’s', () => {
    // The same day carries different followed teams per account; showing one
    // account's pins on another's screen would be visibly wrong.
    expect(cacheKey('2026-11-25', 'tok')).not.toBe(cacheKey('2026-11-25', null));
    expect(cacheKey('2026-11-25', null)).toBe('matches:2026-11-25:guest');
  });
});

describe('when the page admits it is not current', () => {
  it('says so while refreshing over a stale copy', () => {
    expect(shouldShowUpdating({ freshness: 'stale', refreshing: true })).toBe(true);
    expect(shouldShowUpdating({ freshness: 'stale', refreshing: false })).toBe(true);
  });

  it('does not nag over a copy refreshed seconds ago', () => {
    expect(shouldShowUpdating({ freshness: 'fresh', refreshing: false })).toBe(false);
  });

  it('says nothing when there is no copy at all', () => {
    expect(shouldShowUpdating({ freshness: 'expired', refreshing: true })).toBe(false);
  });

  it('ships the two Arabic strings the screen and the test both use', () => {
    expect(UPDATING_LABEL).toContain('التحديث');
    expect(STALE_FAILED_LABEL).toMatch(/تعذّر تحديث/);
  });
});

describe('the page opens from the cache, then refresh makes it true', () => {
  const now = Date.now();

  it('draws the stored copy without waiting for the network', async () => {
    // This is the measured 1.5s spinner being removed.
    const store = memoryStore(cachedAt('2026-11-25', now - 1000, 'من الكاش'));
    let resolveNetwork: (d: MatchesDay) => void = () => {};
    mockFetchMatches.mockImplementation(
      () => new Promise<MatchesDay>((resolve) => (resolveNetwork = resolve)),
    );

    const state = await mount({
      date: '2026-11-25',
      store,
    });
    // The stored list is on screen while the request is still in flight.
    expect(state.day?.matches[0]?.home).toBe('من الكاش');
    expect(state.loading).toBe(false);

    // …and the fresh answer replaces it when it lands.
    resolveNetwork(day('2026-11-25', 'من الشبكة'));
    await settle();
    expect(state.day?.matches[0]?.home).toBe('من الشبكة');
    expect(state.updatingLabel).toBeNull();
  });

  it('writes what it fetched, so the next open is instant', async () => {
    const store = memoryStore(null);
    mockFetchMatches.mockResolvedValue(day('2026-11-25', 'شبكة'));

    await mount({ date: '2026-11-25', store });
    await settle();

    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.current?.day.matches[0]?.home).toBe('شبكة');
  });

  it('keeps the old copy but says the refresh failed, instead of silence', async () => {
    const store = memoryStore(cachedAt('2026-11-25', now - 1000, 'قديم'));
    mockFetchMatches.mockRejectedValue(Object.assign(new Error('down'), { network: true }));

    const state = await mount({ date: '2026-11-25', store });
    await settle();

    // The real data stays on screen…
    expect(state.day?.matches[0]?.home).toBe('قديم');
    // …and the reader is told it is not current.
    expect(state.staleNotice).toBe(STALE_FAILED_LABEL);
    expect(state.error).toBeNull();
  });

  it('shows the honest error when the refresh fails and there is no copy', async () => {
    const store = memoryStore(null);
    mockFetchMatches.mockRejectedValue(Object.assign(new Error('down'), { network: true }));

    const state = await mount({ date: '2026-11-25', store });
    await settle();

    expect(state.day).toBeNull();
    expect(state.error).toBe('تعذّر الاتصال. حاول مرة أخرى.');
  });

  it('refuses a copy from another day rather than showing the wrong fixtures', async () => {
    const store = memoryStore(cachedAt('2026-11-24', now - 1000, 'أمس'));
    let resolveNetwork: (d: MatchesDay) => void = () => {};
    mockFetchMatches.mockImplementation(
      () => new Promise<MatchesDay>((resolve) => (resolveNetwork = resolve)),
    );

    const state = await mount({ date: '2026-11-25', store });
    // Nothing from yesterday is drawn under today's ribbon.
    expect(state.day).toBeNull();
    expect(state.loading).toBe(true);

    resolveNetwork(day('2026-11-25', 'اليوم'));
    await settle();
    expect(state.day?.matches[0]?.home).toBe('اليوم');
  });
});

describe('prefetching today, once, at the reader’s rate', () => {
  const now = Date.now();

  it('fetches and stores when there is no fresh copy', async () => {
    const store = memoryStore(null);
    mockFetchMatches.mockResolvedValue(day('2026-11-25', 'مسبق'));

    const did = await prefetchTodayMatches({ date: '2026-11-25', store, now });
    expect(did).toBe(true);
    expect(mockFetchMatches).toHaveBeenCalledTimes(1);
    expect(store.current?.day.matches[0]?.home).toBe('مسبق');
  });

  it('makes no request when a fresh copy is already there', async () => {
    // The phone must not look like a scraper to a small server.
    const store = memoryStore(cachedAt('2026-11-25', now - 1000));
    const did = await prefetchTodayMatches({ date: '2026-11-25', store, now });
    expect(did).toBe(false);
    expect(mockFetchMatches).not.toHaveBeenCalled();
  });

  it('is silent when the prefetch fails', async () => {
    const store = memoryStore(null);
    mockFetchMatches.mockRejectedValue(new Error('offline'));
    await expect(prefetchTodayMatches({ date: '2026-11-25', store, now })).resolves.toBe(false);
  });
});

/* --- a tiny harness: the hook, driven without a renderer ---------------------- */

import { act, renderHook, waitFor } from '@testing-library/react-native';

/**
 * Render the hook and expose a LIVE view of its state.
 *
 * `result.current` is only read at the moment of access, so returning it directly
 * would freeze one snapshot and the assertions after an update would pass on stale
 * data — the exact kind of false green these tests exist to prevent.
 */
async function mount(args: { date: string; store: ReturnType<typeof memoryStore> }) {
  const view = renderHook(() =>
    useMatchesDay({ date: args.date, token: null, store: args.store as never }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  const get = () => view.result.current;
  return {
    get day() {
      return get().day;
    },
    get loading() {
      return get().loading;
    },
    get refreshing() {
      return get().refreshing;
    },
    get error() {
      return get().error;
    },
    get staleNotice() {
      return get().staleNotice;
    },
    get updatingLabel() {
      return get().updatingLabel;
    },
  };
}

/** Let queued promise callbacks run and the reducer re-render. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(true).toBe(true));
};
