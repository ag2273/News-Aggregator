// Push notification registry: device tokens + per-device preferences.
//
// Storage is the same JSON-file pattern as saved.ts/follows.ts so the server can
// stay dependency-free: DATA_DIR/push-tokens.json holds an array of records.
//
// Delivery goes straight to Firebase Cloud Messaging (HTTP v1), not through
// Expo's push service: the device registers its native FCM token and the server
// authenticates to Google with a service-account key. The OAuth2 access token is
// minted here with a signed JWT (node:crypto), so no Google SDK is needed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Article } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const PUSH_FILE = path.join(DATA_DIR, 'push-tokens.json');

/** Where the Firebase service-account key is mounted (read-only). */
export const DEFAULT_SERVICE_ACCOUNT_FILE = '/data/secrets/fcm-service-account.json';

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FCM_API_BASE = 'https://fcm.googleapis.com/v1/projects';

/** Android channels created on the device (see lib/notifications.ts). */
export const CHANNEL_BREAKING = 'breaking';
export const CHANNEL_NEWS = 'news';

/** 'urgent' = breaking news only, 'all' = every newly ingested article. */
export type PushMode = 'urgent' | 'all';

export interface PushRecord {
  id: string;
  userId: string;
  token: string;
  platform: string;
  /** 'fcm' for native Firebase tokens. */
  provider: string;
  enabled: boolean;
  mode: PushMode;
  updatedAt: number;
}

export function isValidMode(mode: unknown): mode is PushMode {
  return mode === 'urgent' || mode === 'all';
}

/**
 * Expo push tokens cannot be delivered by FCM — they belong to a service this
 * server no longer uses. Records written before the switch are dropped.
 */
export function isLegacyExpoToken(token: string): boolean {
  return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
}

let cache: PushRecord[] | null = null;

function load(): PushRecord[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')) as unknown;
    const rows = Array.isArray(parsed) ? (parsed as PushRecord[]) : [];
    // Migration: silently drop tokens from the old Expo push service.
    const kept = rows.filter((r) => !isLegacyExpoToken(r.token));
    const dropped = rows.length - kept.length;
    if (dropped > 0) console.log(`[push] dropped ${dropped} legacy Expo token(s)`);
    cache = kept.map((r) => ({ ...r, provider: r.provider ?? 'fcm' }));
  } catch {
    cache = [];
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(PUSH_FILE), { recursive: true });
  fs.writeFileSync(PUSH_FILE, JSON.stringify(cache ?? [], null, 2));
}

/** Register (or refresh) a device token. Upserts by token. */
export function registerPushToken(
  userId: string,
  token: string,
  platform: string,
  provider = 'fcm',
): PushRecord {
  const rows = load();
  const existing = rows.find((r) => r.token === token);
  if (existing) {
    existing.userId = userId;
    existing.platform = platform;
    existing.provider = provider;
    existing.updatedAt = Date.now();
    cache = rows;
    save();
    return existing;
  }
  const record: PushRecord = {
    id: `push_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    token,
    platform,
    provider,
    enabled: true,
    mode: 'urgent',
    updatedAt: Date.now(),
  };
  rows.push(record);
  cache = rows;
  save();
  return record;
}

/** Update enabled/mode for one of the caller's own tokens. Null when unknown. */
export function updatePushPrefs(
  userId: string,
  token: string,
  prefs: { enabled?: boolean; mode?: PushMode },
): PushRecord | null {
  const rows = load();
  const record = rows.find((r) => r.token === token && r.userId === userId);
  if (!record) return null;
  if (typeof prefs.enabled === 'boolean') record.enabled = prefs.enabled;
  if (isValidMode(prefs.mode)) record.mode = prefs.mode;
  record.updatedAt = Date.now();
  cache = rows;
  save();
  return record;
}

/** Remove one of the caller's own tokens (e.g. sign-out). */
export function unregisterPushToken(userId: string, token: string): boolean {
  const rows = load();
  const next = rows.filter((r) => !(r.token === token && r.userId === userId));
  const removed = next.length !== rows.length;
  if (removed) {
    cache = next;
    save();
  }
  return removed;
}

/** Preferences for one of the caller's own tokens, or null when unknown. */
export function getPushPrefs(userId: string, token: string): PushRecord | null {
  return load().find((r) => r.token === token && r.userId === userId) ?? null;
}

/** Every registered record (used by the sender). */
export function getAllPushRecords(): PushRecord[] {
  return load().slice();
}

/** Delete every push token for a user (account deletion). */
export function deletePushTokensForUser(userId: string): number {
  const rows = load();
  const next = rows.filter((r) => r.userId !== userId);
  const removed = rows.length - next.length;
  if (removed > 0) {
    console.log(`[push] removed ${removed} token(s) for a deleted account`);
    cache = next;
    save();
  }
  return removed;
}

/** Drop a token the push service rejected (unregistered / permanently invalid). */
export function removeDeadToken(token: string): boolean {
  const rows = load();
  const next = rows.filter((r) => r.token !== token);
  const removed = next.length !== rows.length;
  if (removed) {
    console.log('[push] removed a token FCM rejected');
    cache = next;
    save();
  }
  return removed;
}

/** Reset cache (for vitest test isolation). */
export function _resetPushCache(): void {
  cache = null;
}

export const PUSH_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Pure matching rule: should this article go to this device?
 * Breaking news reaches 'urgent' and 'all'; everything else only 'all'.
 */
export function shouldPushTo(record: PushRecord, article: Article): boolean {
  if (!record.enabled) return false;
  if (article.isBreaking) return record.mode === 'urgent' || record.mode === 'all';
  return record.mode === 'all';
}

/** Ids already delivered this process — one article never pushes twice. */
const pushedArticleIds = new Set<string>();

// --- Firebase credentials ---

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const serviceAccountPath = (): string =>
  process.env['FCM_SERVICE_ACCOUNT_FILE'] || DEFAULT_SERVICE_ACCOUNT_FILE;

/**
 * Read the service account, or null with one warning. Missing credentials must
 * never crash the server: it simply cannot push.
 */
export function loadServiceAccount(
  filePath: string = serviceAccountPath(),
): ServiceAccount | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ServiceAccount>;
    if (!raw.project_id || !raw.client_email || !raw.private_key) {
      console.warn(
        `[push] ${filePath} is missing project_id/client_email/private_key — push disabled`,
      );
      return null;
    }
    return {
      project_id: raw.project_id,
      client_email: raw.client_email,
      private_key: raw.private_key,
      token_uri: raw.token_uri,
    };
  } catch {
    console.warn(
      `[push] no Firebase service account at ${filePath} — push notifications disabled. ` +
        'Mount the key there (FCM_SERVICE_ACCOUNT_FILE overrides the path).',
    );
    return null;
  }
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Build the signed OAuth2 JWT assertion for the FCM scope. */
export function buildJwtAssertion(
  account: ServiceAccount,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope: FCM_SCOPE,
    aud: account.token_uri ?? GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
  return `${unsigned}.${base64url(signature)}`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
let cachedAccessToken: CachedToken | null = null;

/** Exchange the JWT for a short-lived OAuth2 access token (cached). */
export async function getAccessToken(
  account: ServiceAccount,
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.token;
  }
  const assertion = buildJwtAssertion(account, Math.floor(now / 1000));
  const res = await fetcher(account.token_uri ?? GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Google token response had no access_token');
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return cachedAccessToken.token;
}

/** Reset the cached OAuth token (tests). */
export function _resetAccessToken(): void {
  cachedAccessToken = null;
}

// --- FCM payloads ---

export interface FcmMessage {
  token: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
  android: {
    priority: 'high' | 'normal';
    notification: { channel_id: string; color?: string };
  };
}

/**
 * One FCM v1 message for one article.
 * Breaking news goes to the high-importance channel with high priority; every
 * other article uses the default-importance channel.
 */
export function buildFcmMessage(article: Article, token: string): FcmMessage {
  return {
    token,
    notification: {
      title: article.isBreaking ? 'خبر عاجل' : article.sourceName,
      body: article.title,
    },
    data: { articleId: article.id },
    android: {
      priority: article.isBreaking ? 'high' : 'normal',
      notification: {
        channel_id: article.isBreaking ? CHANNEL_BREAKING : CHANNEL_NEWS,
        color: '#22C55E',
      },
    },
  };
}

/** True when FCM says this token is gone and must be deleted. */
export function isDeadTokenResponse(status: number, body: unknown): boolean {
  if (status !== 404 && status !== 400) return false;
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  if (/UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(text)) return true;
  // 404 for a message endpoint is only ever "no such token".
  return status === 404;
}

/** Send one message. Returns 'ok', 'dead' (delete the token) or 'error'. */
export async function sendFcmMessage(
  projectId: string,
  accessToken: string,
  message: FcmMessage,
  fetcher: typeof fetch = fetch,
): Promise<'ok' | 'dead' | 'error'> {
  try {
    const res = await fetcher(`${FCM_API_BASE}/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return 'ok';
    const body = await res.text().catch(() => '');
    if (isDeadTokenResponse(res.status, body)) return 'dead';
    console.error(`[push] FCM send failed (${res.status}): ${body.slice(0, 200)}`);
    return 'error';
  } catch (err) {
    console.error('[push] FCM request failed:', err);
    return 'error';
  }
}

/** Run tasks with at most `limit` in flight. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current] as T);
    }
  });
  await Promise.all(runners);
}

export const FCM_CONCURRENCY = 10;

/**
 * Deliver newly ingested articles to matching devices.
 *
 * Deliberately conservative:
 * - only articles published within the last 15 minutes (no backfill bursts),
 * - never on the first refresh after process start (the caller decides that),
 * - one push per article per process,
 * - one FCM request per token, at most 10 in flight,
 * - no credentials or no recipients is a quiet no-op.
 *
 * @returns the article ids that were pushed.
 */
export async function sendPushNotifications(
  newArticles: Article[],
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  if (!newArticles.length) return [];

  const records = getAllPushRecords().filter((r) => r.enabled && r.provider === 'fcm');
  if (!records.length) return [];

  const account = loadServiceAccount();
  if (!account) return [];

  const cutoff = Date.now() - PUSH_MAX_AGE_MS;
  const pushable = newArticles.filter(
    (a) => a.publishedAt >= cutoff && !pushedArticleIds.has(a.id),
  );
  if (!pushable.length) return [];

  const jobs: Array<{ article: Article; record: PushRecord }> = [];
  const delivered: string[] = [];
  for (const article of pushable) {
    const targets = records.filter((r) => shouldPushTo(r, article));
    if (!targets.length) continue;
    for (const record of targets) jobs.push({ article, record });
    pushedArticleIds.add(article.id);
    delivered.push(article.id);
  }
  if (!jobs.length) return delivered;

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, fetcher);
  } catch (err) {
    console.error('[push] could not authenticate with Firebase:', err);
    // Nothing was sent; let the next refresh retry these articles.
    for (const article of pushable) pushedArticleIds.delete(article.id);
    return [];
  }

  await runWithConcurrency(jobs, FCM_CONCURRENCY, async ({ article, record }) => {
    const result = await sendFcmMessage(
      account.project_id,
      accessToken,
      buildFcmMessage(article, record.token),
      fetcher,
    );
    if (result === 'dead') removeDeadToken(record.token);
  });

  return delivered;
}

/** Reset the in-process dedupe set (tests only). */
export function _resetPushedIds(): void {
  pushedArticleIds.clear();
}
