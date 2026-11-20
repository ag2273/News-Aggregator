/**
 * Analytics beacons: what leaves the device, what must never leave it, and that a
 * beacon can never slow, break or storm the UI.
 */

import * as SecureStore from 'expo-secure-store';
import {
  getInstallId,
  newInstallId,
  sendBeacon,
  beaconOpen,
  beaconShare,
  beaconPing,
  _resetBeaconBackoff,
  BEACON_MIN_GAP_MS,
} from '../lib/analytics';

function fakeFetch(): jest.Mock {
  return jest.fn().mockResolvedValue({ ok: true, status: 200 } as never);
}

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;

beforeEach(() => {
  _resetBeaconBackoff();
  mockGet.mockReset().mockResolvedValue('install-id-abcdef0123456789');
  mockSet.mockReset().mockResolvedValue(undefined);
});

describe('install id', () => {
  it('is generated once and read back from storage', async () => {
    const first = await getInstallId();
    expect(first).toBe('install-id-abcdef0123456789');
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('creates and stores an id on first launch', async () => {
    mockGet.mockResolvedValue(null);
    const id = await getInstallId();
    expect(id).toMatch(/^[0-9a-f-]{32,}$/);
    expect(mockSet).toHaveBeenCalledWith('news_aggregator_install_id', id);
  });

  it('is random and not derived from anything about the user', () => {
    const a = newInstallId();
    const b = newInstallId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns null instead of throwing when storage fails', async () => {
    mockGet.mockRejectedValue(new Error('keychain locked'));
    await expect(getInstallId()).resolves.toBeNull();
  });
});

describe('sendBeacon', () => {
  it('posts an open with the install id header and the article id', async () => {
    const f = fakeFetch();
    await expect(sendBeacon('open', 'a1', f as never)).resolves.toBe(true);
    const [url, init] = f.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toContain('/api/events/open');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Install-Id']).toBe('install-id-abcdef0123456789');
    expect(JSON.parse(init.body)).toEqual({ articleId: 'a1' });
    // Nothing identity-bearing is in the payload.
    expect(init.body).not.toMatch(/email|token|user/i);
  });

  it('posts a share to its own endpoint', async () => {
    const f = fakeFetch();
    await sendBeacon('share', 'a1', f as never);
    expect((f.mock.calls[0] as [string])[0]).toContain('/api/events/share');
  });

  it('pings with no body', async () => {
    const f = fakeFetch();
    await sendBeacon('ping', undefined, f as never);
    const [url, init] = f.mock.calls[0] as [string, { body?: string; method?: string }];
    expect(url).toContain('/api/events/ping');
    expect(init.body).toBeUndefined();
    expect(init.method).toBeUndefined();
  });

  it('refuses an open or share without an article id', async () => {
    const f = fakeFetch();
    await expect(sendBeacon('open', undefined, f as never)).resolves.toBe(false);
    await expect(sendBeacon('share', '', f as never)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('swallows a network failure and reports no success', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(sendBeacon('open', 'a1', f as never)).resolves.toBe(false);
  });

  it('swallows a non-2xx response', async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 429 } as never);
    await expect(sendBeacon('open', 'a1', f as never)).resolves.toBe(false);
  });

  it('sends nothing when there is no install id', async () => {
    mockGet.mockRejectedValue(new Error('locked'));
    const f = fakeFetch();
    await expect(sendBeacon('open', 'a1', f as never)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('does not storm: a second identical beacon inside the gap sends nothing', async () => {
    const f = fakeFetch();
    const now = Date.now();
    await sendBeacon('open', 'a1', f as never, now);
    await sendBeacon('open', 'a2', f as never, now + Math.floor(BEACON_MIN_GAP_MS / 2));
    expect(f).toHaveBeenCalledTimes(1);
    await sendBeacon('open', 'a3', f as never, now + BEACON_MIN_GAP_MS + 1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('keeps open and share budgets independent', async () => {
    const f = fakeFetch();
    const now = Date.now();
    await sendBeacon('open', 'a1', f as never, now);
    await sendBeacon('share', 'a1', f as never, now);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('fire-and-forget wrappers', () => {
  it('never throw when the beacon fails', async () => {
    const original = globalThis.fetch;
    const f = jest.fn().mockRejectedValue(new Error('offline'));
    (globalThis as any).fetch = f;
    expect(() => beaconOpen('a1')).not.toThrow();
    expect(() => beaconShare('a1')).not.toThrow();
    expect(() => beaconPing()).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    (globalThis as any).fetch = original;
  });

  it('do not return a promise a screen could await', () => {
    expect(beaconOpen('a1')).toBeUndefined();
    expect(beaconShare('a1')).toBeUndefined();
    expect(beaconPing()).toBeUndefined();
  });
});
