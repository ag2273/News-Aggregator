/**
 * Anonymous usage beacons.
 *
 * What leaves the device: a random per-install id and the article id. No account,
 * email, name or reading history is attached, and the server stores only an
 * aggregate count.
 *
 * Rules that matter for the UI:
 *   - fire-and-forget: never awaited by a screen, so a slow network cannot delay
 *     opening a reader or the share sheet;
 *   - silent on failure: a failed beacon is dropped, never retried in a loop and
 *     never surfaced as an error;
 *   - one call per user action, with a small in-memory backoff so a flapping
 *     network cannot turn into a request storm.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from './api';

const INSTALL_ID_KEY = 'news_aggregator_install_id';

/** Minimum gap between two identical beacon kinds, per app session. */
export const BEACON_MIN_GAP_MS = 1000;

/** A random install id: not tied to the account, and reset by a reinstall. */
export function newInstallId(): string {
  // RFC 4122 v4 from Math.random is enough here: the value is a bucket key, not
  // a credential, and the server salts and hashes it anyway.
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) out += hex[Math.floor(Math.random() * 16)];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-a${out.slice(17, 20)}-${out.slice(20, 32)}`;
}

/** Read the stored id, creating one on first launch. Null when storage fails. */
export async function getInstallId(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(INSTALL_ID_KEY);
        if (stored) return stored;
        const fresh = newInstallId();
        window.localStorage.setItem(INSTALL_ID_KEY, fresh);
        return fresh;
      }
      return null;
    }
    const stored = await SecureStore.getItemAsync(INSTALL_ID_KEY);
    if (stored) return stored;
    const fresh = newInstallId();
    await SecureStore.setItemAsync(INSTALL_ID_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

type BeaconKind = 'open' | 'share' | 'ping';

/** Last send time per kind, so a double tap cannot double-count. */
const lastSent = new Map<BeaconKind, number>();

/** Test seam: reset the backoff without touching storage. */
export function _resetBeaconBackoff(): void {
  lastSent.clear();
}

function shouldSend(kind: BeaconKind, now: number): boolean {
  const last = lastSent.get(kind) ?? 0;
  if (now - last < BEACON_MIN_GAP_MS) return false;
  lastSent.set(kind, now);
  return true;
}

/**
 * Send one beacon. Never throws, never resolves to anything a caller needs.
 *
 * `articleId` is required for open/share and omitted for ping.
 */
export async function sendBeacon(
  kind: BeaconKind,
  articleId?: string,
  fetchImpl: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<boolean> {
  if ((kind === 'open' || kind === 'share') && !articleId) return false;
  if (!shouldSend(kind, now)) return false;
  const installId = await getInstallId();
  if (!installId) return false;

  try {
    const headers: Record<string, string> = { 'X-Install-Id': installId };
    if (kind === 'ping') {
      const res = await fetchImpl(`${API_BASE}/api/events/ping`, { headers });
      return res.ok;
    }
    headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(`${API_BASE}/api/events/${kind}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ articleId }),
    });
    return res.ok;
  } catch {
    // Offline, DNS failure, aborted: the count is lost on purpose.
    return false;
  }
}

/** The reader was opened. Fire and forget. */
export function beaconOpen(articleId: string): void {
  void sendBeacon('open', articleId);
}

/** The share sheet was used. Fire and forget. */
export function beaconShare(articleId: string): void {
  void sendBeacon('share', articleId);
}

/** App start: counts this device for today. Fire and forget. */
export function beaconPing(): void {
  void sendBeacon('ping');
}
