// Push notifications for the news app.
//
// Flow: ask permission -> get the Expo push token -> register it with our server
// (Bearer auth) so the server can target this device. Tapping a notification
// opens the article it refers to.
//
// Every entry point is defensive: a missing EAS projectId, a denied permission,
// a simulator, or no network must never crash the app — it returns null/false
// and logs one clear message.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { API_BASE } from './api';

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
 * The EAS project id is required to mint an Expo push token. It is deliberately
 * not invented here: app.json ships a TODO placeholder, replaced after `eas init`.
 */
function getProjectId(): string | null {
  const id = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
    ?.projectId;
  if (typeof id !== 'string' || id.length === 0 || id.startsWith('TODO')) return null;
  return id;
}

export async function getPermissionStatus(): Promise<PermissionStatus> {
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
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

/**
 * Resolve this device's Expo push token, or null with a clear reason.
 * Simulators and missing projectId cannot produce a token.
 */
export async function getDevicePushToken(): Promise<string | null> {
  try {
    const projectId = getProjectId();
    if (!projectId) {
      console.warn(
        '[notifications] Missing extra.eas.projectId in app.json — run `eas init` and set it. Push registration skipped.',
      );
      return null;
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data ?? null;
  } catch (err) {
    console.warn('[notifications] Could not obtain an Expo push token:', err);
    return null;
  }
}

/** Register (upsert) this device with the server. */
export async function registerDevice(authToken: string): Promise<PushPrefs | null> {
  try {
    const pushToken = await getDevicePushToken();
    if (!pushToken) return null;
    const res = await fetch(`${API_BASE}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: pushToken, platform: Platform.OS }),
    });
    if (!res.ok) {
      console.warn('[notifications] register failed with status', res.status);
      return null;
    }
    const json = (await res.json()) as { data?: PushPrefs };
    return json.data ?? null;
  } catch (err) {
    console.warn('[notifications] register request failed:', err);
    return null;
  }
}

/** Remove this device from the server (sign-out). Best effort. */
export async function unregisterDevice(authToken: string): Promise<void> {
  try {
    const pushToken = await getDevicePushToken();
    if (!pushToken) return;
    await fetch(`${API_BASE}/api/push/register`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: pushToken }),
    });
  } catch {
    // Sign-out must not fail because push cleanup did.
  }
}

/** Current preferences for this device, or null when it is not registered. */
export async function fetchPrefs(authToken: string): Promise<PushPrefs | null> {
  try {
    const pushToken = await getDevicePushToken();
    if (!pushToken) return null;
    const res = await fetch(
      `${API_BASE}/api/push/preferences?token=${encodeURIComponent(pushToken)}`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: PushPrefs };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** Persist enabled/mode for this device. */
export async function updatePrefs(
  authToken: string,
  prefs: { enabled?: boolean; mode?: PushMode },
): Promise<PushPrefs | null> {
  try {
    const pushToken = await getDevicePushToken();
    if (!pushToken) return null;
    const res = await fetch(`${API_BASE}/api/push/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: pushToken, ...prefs }),
    });
    if (!res.ok) {
      console.warn('[notifications] preference update failed with status', res.status);
      return null;
    }
    const json = (await res.json()) as { data?: PushPrefs };
    return json.data ?? null;
  } catch (err) {
    console.warn('[notifications] preference update request failed:', err);
    return null;
  }
}

/**
 * Navigate to the article a notification refers to.
 * The server sends data { articleId, url }; the article route is deep-linkable,
 * and the card's reader also accepts the stored url, so prefer the id.
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
