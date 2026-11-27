// Push notifications for the news app — FCM-direct.
//
// Flow: ask permission -> create the Android channels -> read the device's
// native FCM token -> register it with our server (Bearer auth). The server
// talks to Firebase Cloud Messaging itself; there is no Expo push service and no
// Expo push token anywhere in this flow.
//
// Failures carry a typed reason (see pushErrors.ts) so the UI can name the step
// that failed: permission, token (Firebase not configured), network, auth.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { API_BASE } from './api';
import {
  PushError,
  PUSH_ERROR_MESSAGES,
  classifyHttpStatus,
  classifyPushTokenError,
  type PushFailureKind,
} from './pushErrors';

export { PushError, PUSH_ERROR_MESSAGES, type PushFailureKind };

/** 'urgent' = breaking news only, 'all' = every new article. */
export type PushMode = 'urgent' | 'all';

export interface PushPrefs {
  token: string;
  enabled: boolean;
  mode: PushMode;
  /** The twice-daily digest, its own switch, on by default. */
  digestEnabled?: boolean;
  provider?: string;
}

export interface PermissionStatus {
  granted: boolean;
  /** iOS/Android can only be re-prompted once; a denied state needs Settings. */
  canAskAgain: boolean;
  /** True when the user denied and the system will not prompt again. */
  denied: boolean;
}

/** Android channels, mirrored by the server's channel_id values. */
export const CHANNEL_BREAKING = 'breaking';
export const CHANNEL_NEWS = 'news';
/** The twice-daily digest; default importance, never breaking. */
export const CHANNEL_DIGEST = 'digest';

// Foreground presentation: show the banner and play the sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Create the three notification channels. Breaking news arrives on a
 * high-importance channel so it can heads-up; everything else is default.
 * Safe to call repeatedly.
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_BREAKING, {
      name: 'أخبار عاجلة',
      description: 'إشعارات الأخبار العاجلة',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#22C55E',
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_NEWS, {
      name: 'الأخبار',
      description: 'إشعارات الأخبار الجديدة',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#22C55E',
    });
    // The digest keeps its own channel, so its toggle is independent of breaking
    // news and a reader can mute one without the other.
    await Notifications.setNotificationChannelAsync(CHANNEL_DIGEST, {
      name: 'الخلاصة اليومية',
      description: 'خلاصة مرتين في اليوم: ٩ صباحًا و٦ مساءً',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#22C55E',
    });
  } catch (err) {
    // Channels are an Android nicety; never block registration on them.
    console.warn('[notifications] could not create channels:', err);
  }
}

// An FCM token is stable for a long time; minting it hits Firebase, so keep it
// for the session instead of repeating the work.
let cachedPushToken: string | null = null;

export function clearCachedPushToken(): void {
  cachedPushToken = null;
}

/**
 * Read this device's native FCM token.
 *
 * On Android this is the Firebase registration token, which the server sends
 * through the FCM HTTP v1 API. It requires the app to be built with
 * google-services.json: without it `FirebaseMessaging.getInstance()` throws
 * inside expo-notifications and no token can exist.
 */
export async function getDevicePushToken(): Promise<string> {
  if (cachedPushToken) return cachedPushToken;

  let token: string;
  try {
    const result = await Notifications.getDevicePushTokenAsync();
    token = typeof result.data === 'string' ? result.data : '';
  } catch (err) {
    console.warn('[notifications] could not obtain an FCM token:', err);
    throw wrap(err, 'config');
  }
  if (!token) throw new PushError('config', PUSH_ERROR_MESSAGES.config);

  cachedPushToken = token;
  return token;
}

export async function getPermissionStatus(): Promise<PermissionStatus> {
  const current = await Notifications.getPermissionsAsync();
  const granted =
    current.granted ||
    current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  return {
    granted,
    canAskAgain: current.canAskAgain,
    denied: !granted && !current.canAskAgain,
  };
}

/** Ask for permission if needed. Returns true when notifications are allowed. */
export async function requestPermissions(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function ensurePermission(): Promise<boolean> {
  const granted = await requestPermissions();
  if (granted) await ensureNotificationChannels();
  return granted;
}

function wrap(err: unknown, fallback: PushFailureKind = 'unknown'): PushError {
  if (err instanceof PushError) return err;
  const kind = classifyPushTokenError(err);
  return new PushError(kind === 'unknown' ? fallback : kind, PUSH_ERROR_MESSAGES[kind]);
}

function authHeaders(authToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };
}

async function postJson(
  path: string,
  authToken: string,
  body: Record<string, unknown>,
  method: 'POST' | 'PUT' = 'POST',
): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      method,
      headers: authHeaders(authToken),
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw wrap(err, 'network');
  }
}

function prefsFrom(res: Response, json: { data?: PushPrefs }): PushPrefs {
  if (!json.data) throw new PushError('server', PUSH_ERROR_MESSAGES.server, res.status);
  return json.data;
}

/** Register (upsert) this device with the server. Throws PushError on failure. */
export async function registerDevice(authToken: string): Promise<PushPrefs> {
  const pushToken = await getDevicePushToken();
  const res = await postJson('/api/push/register', authToken, {
    token: pushToken,
    platform: Platform.OS,
    provider: 'fcm',
  });
  if (!res.ok) {
    const kind = classifyHttpStatus(res.status);
    throw new PushError(kind, PUSH_ERROR_MESSAGES[kind], res.status);
  }
  return prefsFrom(res, (await res.json()) as { data?: PushPrefs });
}

/** Remove this device from the server (sign-out). Best effort, never throws. */
export async function unregisterDevice(authToken: string): Promise<void> {
  try {
    const pushToken = await getDevicePushToken();
    await fetch(`${API_BASE}/api/push/register`, {
      method: 'DELETE',
      headers: authHeaders(authToken),
      body: JSON.stringify({ token: pushToken }),
    });
  } catch {
    // Sign-out must not fail because push cleanup did.
  } finally {
    clearCachedPushToken();
  }
}

/** Current preferences for this device, or null when it is not registered yet. */
export async function fetchPrefs(authToken: string): Promise<PushPrefs | null> {
  const pushToken = await getDevicePushToken();

  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/api/push/preferences?token=${encodeURIComponent(pushToken)}`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
  } catch (err) {
    throw wrap(err, 'network');
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const kind = classifyHttpStatus(res.status);
    throw new PushError(kind, PUSH_ERROR_MESSAGES[kind], res.status);
  }

  const json = (await res.json()) as { data?: PushPrefs };
  return json.data ?? null;
}

/** Persist enabled/mode for this device. Throws PushError on failure. */
export async function updatePrefs(
  authToken: string,
  prefs: { enabled?: boolean; mode?: PushMode; digestEnabled?: boolean },
): Promise<PushPrefs> {
  const pushToken = await getDevicePushToken();

  let res = await postJson(
    '/api/push/preferences',
    authToken,
    { token: pushToken, ...prefs },
    'PUT',
  );

  // 404: this device was never registered (or the server lost the record).
  // Register once and retry, so the first toggle does not fail for that reason.
  if (res.status === 404) {
    await registerDevice(authToken);
    res = await postJson(
      '/api/push/preferences',
      authToken,
      { token: pushToken, ...prefs },
      'PUT',
    );
  }

  if (!res.ok) {
    const kind = classifyHttpStatus(res.status);
    throw new PushError(kind, PUSH_ERROR_MESSAGES[kind], res.status);
  }
  return prefsFrom(res, (await res.json()) as { data?: PushPrefs });
}

/**
 * FCM can rotate a device token while the app is running; the old one silently
 * stops working. Re-register the new token as soon as it appears.
 */
export function addPushTokenRefreshListener(
  getAuthToken: () => string | null,
): () => void {
  const sub = Notifications.addPushTokenListener((deviceToken) => {
    const token = typeof deviceToken.data === 'string' ? deviceToken.data : '';
    if (!token) return;
    cachedPushToken = token;
    const authToken = getAuthToken();
    if (!authToken) return;
    registerDevice(authToken).catch((err) => {
      console.warn('[notifications] re-registering a rotated token failed:', err);
    });
  });
  return () => sub.remove();
}

/** Where a notification tap should land, from its `data` payload. */
export type NotificationTarget =
  | { kind: 'digest' }
  | { kind: 'article'; articleId: string }
  | { kind: 'webview'; url: string }
  | { kind: 'match'; matchId: string; date: string }
  | null;

/**
 * Decide the destination for a tapped notification.
 *
 * The server sends THREE payload shapes and this is the one place they are read:
 *   - digest:   { digest: '1', slot }   -> the الخلاصة screen
 *   - article:  { articleId }           -> that article
 *   - keyword:  { articleId, keyword }  -> that article
 *   - webview:  { url }                 -> in-app browser
 *
 * Pure, so the routing decision is testable without a running app. A digest tap
 * used to fall through to "no destination", which left the user on whatever
 * screen was already open — the bug this fixes.
 */
export function notificationTarget(data: Record<string, unknown> | undefined): NotificationTarget {
  if (!data) return null;
  // Check the digest first: its payload has no articleId, but a future one might
  // carry both, and the digest is the more specific destination.
  if (data['digest'] === '1' || data['digest'] === 1 || data['digest'] === true) {
    return { kind: 'digest' };
  }
  // A followed match's event: { football: '1', matchId, date } -> the match centre.
  const matchId = data['matchId'];
  if (typeof matchId === 'string' && matchId.length > 0) {
    const date = typeof data['date'] === 'string' ? data['date'] : '';
    return { kind: 'match', matchId, date };
  }
  const articleId = data['articleId'];
  if (typeof articleId === 'string' && articleId.length > 0) {
    return { kind: 'article', articleId };
  }
  const url = data['url'];
  if (typeof url === 'string' && url.startsWith('http')) {
    return { kind: 'webview', url };
  }
  return null;
}

/**
 * Navigate to what a notification refers to.
 *
 * Returns the destination it used, so a caller (and a test) can assert the tap
 * was honoured rather than inferring it from side effects.
 */
export function openNotificationArticle(data: Record<string, unknown> | undefined): NotificationTarget {
  const target = notificationTarget(data);
  if (!target) return null;
  if (target.kind === 'digest') {
    router.push('/digest');
  } else if (target.kind === 'match') {
    router.push({ pathname: '/matches/[id]', params: { id: target.matchId, date: target.date } });
  } else if (target.kind === 'article') {
    router.push({ pathname: '/article', params: { id: target.articleId } });
  } else {
    router.push({ pathname: '/webview', params: { url: target.url } });
  }
  return target;
}

/** Subscribe to taps while the app is running. Returns an unsubscribe fn. */
export function addNotificationResponseListener(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    openNotificationArticle(response.notification.request.content.data as Record<string, unknown>);
  });
  return () => sub.remove();
}

/**
 * Handle the tap that LAUNCHED the app.
 *
 * `addNotificationResponseReceivedListener` only fires while the app is already
 * running, so a cold start (the common case: the phone is asleep, the user taps
 * the push) never reached the handler at all and the app opened on its default
 * screen. This reads the response the launch carried and routes it.
 *
 * The router must be mounted before pushing, so callers pass `waitForRouter`.
 * Returns the destination, or null when the launch was not a notification tap.
 */
export async function handleInitialNotification(
  waitForRouter?: () => Promise<void>,
): Promise<NotificationTarget> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    const data = response.notification.request.content.data as Record<string, unknown>;
    const target = notificationTarget(data);
    if (!target) return null;
    if (waitForRouter) await waitForRouter();
    openNotificationArticle(data);
    // Clear it, so a later foreground/background cycle does not re-navigate to
    // the same digest every time the app is resumed.
    await Notifications.clearLastNotificationResponseAsync?.();
    return target;
  } catch (err) {
    console.warn('[notifications] cold-start routing failed:', err);
    return null;
  }
}
