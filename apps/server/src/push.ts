// Push notification registry: device tokens + per-device preferences.
//
// Storage is the same JSON-file pattern as saved.ts/follows.ts so the server can
// stay dependency-free: DATA_DIR/push-tokens.json holds an array of records.
// Delivery itself goes through Expo's push service (https://exp.host), which
// needs no server-side credentials — only the device's Expo push token.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Article } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const PUSH_FILE = path.join(DATA_DIR, 'push-tokens.json');

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** 'urgent' = breaking news only, 'all' = every newly ingested article. */
export type PushMode = 'urgent' | 'all';

export interface PushRecord {
  id: string;
  userId: string;
  token: string;
  platform: string;
  enabled: boolean;
  mode: PushMode;
  updatedAt: number;
}

export function isValidMode(mode: unknown): mode is PushMode {
  return mode === 'urgent' || mode === 'all';
}

let cache: PushRecord[] | null = null;

function load(): PushRecord[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')) as unknown;
    cache = Array.isArray(parsed) ? (parsed as PushRecord[]) : [];
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
): PushRecord {
  const rows = load();
  const existing = rows.find((r) => r.token === token);
  if (existing) {
    existing.userId = userId;
    existing.platform = platform;
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

/**
 * Deliver newly ingested articles to matching devices.
 *
 * Deliberately conservative:
 * - only articles published within the last 15 minutes (no backfill bursts),
 * - never on the first refresh after process start (the caller decides that),
 * - one push per article per process,
 * - failures per token are logged and skipped, never thrown.
 *
 * @returns the article ids that were pushed.
 */
export async function sendPushNotifications(
  newArticles: Article[],
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  if (!newArticles.length) return [];

  const records = getAllPushRecords().filter((r) => r.enabled);
  if (!records.length) return [];

  const cutoff = Date.now() - PUSH_MAX_AGE_MS;
  const pushable = newArticles.filter(
    (a) => a.publishedAt >= cutoff && !pushedArticleIds.has(a.id),
  );
  if (!pushable.length) return [];

  const messages: Array<{ to: string; title: string; body: string; data: Record<string, string> }> = [];
  const delivered: string[] = [];

  for (const article of pushable) {
    const targets = records.filter((r) => shouldPushTo(r, article));
    if (!targets.length) continue;
    for (const record of targets) {
      messages.push({
        to: record.token,
        title: article.isBreaking ? 'خبر عاجل' : article.sourceName,
        body: article.title,
        data: { articleId: article.id, url: article.url },
      });
    }
    pushedArticleIds.add(article.id);
    delivered.push(article.id);
  }

  if (!messages.length) return delivered;

  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetcher(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.error('[push] Expo push failed with status', res.status);
      }
    } catch (err) {
      console.error('[push] Expo push request failed:', err);
    }
  }

  return delivered;
}

/** Reset the in-process dedupe set (tests only). */
export function _resetPushedIds(): void {
  pushedArticleIds.clear();
}
