// Push notifications for the news app.
//
// Flow: ask permission -> get the Expo push token -> register it with our server
// (Bearer auth) so the server can target this device. Tapping a notification
// opens the article it refers to.
//
// Failures carry a typed reason (see pushErrors.ts) so the UI can tell the truth:
// a build with no Firebase config cannot mint a token at all, and saying "check
// your connection" for it sends the user chasing the wrong thing.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
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
}

export interface PermissionStatus {
  granted: boolean;
  /** iOS/Android can only be re-prompted once; a denied state needs Settings. */
  canAskAgain: boolean;
  /** True when the user denied and the system will not prompt again. */
  denied: boolean;
}

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
 * The EAS project id is required to mint an Expo push token. It comes from
 * app.json extra.eas.projectId.
 */
function getProjectId(): string | null {
  const id = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
    ?.projectId;
  if (typeof id !== 'string' || id.length === 0 || id.startsWith('TODO')) return null;
  return id;
}

function wrap(err: unknown, fallback: PushFailureKind = 'unknown'): PushError {
  if (err instanceof PushError) return err;
  const kind = classifyPushTokenError(err);
  return new PushError(kind === 'unknown' ? fallback : kind, PUSH_ERROR_MESSAGES[kind]);
}

// A push token is stable for the life of the install; minting it hits Firebase
// and Expo, so keep it for the session instead of repeating the work.
let cachedPushToken: string | null = null;

export function clearCachedPushToken(): void {
  cachedPushToken = null;
}

/**
 * Resolve this device's Expo push token.
 *
 * Throws PushError('config') when this build has no Firebase/FCM wiring: on
 * Android the Expo token is derived from an FCM token, and without
 * google-services.json `FirebaseMessaging.getInstance()` throws natively.
 */
export async function getDevicePushToken(): Promise<string> {
  if (cachedPushToken) return cachedPushToken;

  const projectId = getProjectId();
  if (!projectId) {
    throw new PushError('config', PUSH_ERROR_MESSAGES.config);
  }

  let token: string;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    token = data;
  } catch (err) {
    console.warn('[notifications] could not obtain an Expo push token:', err);
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
  prefs: { enabled?: boolean; mode?: PushMode },
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
 * Navigate to the article a notification refers to.
 * The server sends data { articleId, url }; prefer the id.
 */
export function openNotificationArticle(data: Record<string, unknown> | undefined): void {
  const articleId = data?.['articleId'];
  if (typeof articleId === 'string' && articleId.length > 0) {
    router.push({ pathname: '/article', params: { id: articleId } });
    return;
  }
  const url = data?.['url'];
  if (typeof url === 'string' && url.startsWith('http')) {
    router.push({ pathname: '/webview', params: { url } });
  }
}

/** Subscribe to taps while the app is running. Returns an unsubscribe fn. */
export function addNotificationResponseListener(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    openNotificationArticle(response.notification.request.content.data as Record<string, unknown>);
  });
  return () => sub.remove();
}
