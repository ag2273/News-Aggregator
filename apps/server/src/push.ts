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
import { clusterArticles } from './cluster.js';
import { confirmBreakingWithAi, type ConfirmBreaking } from './breakingAi.js';
import {
  getPreferences,
  matchingFollowedKeywords,
  keywordPushBudget,
  recordKeywordPush,
  isMuted,
  type FollowedKeyword,
} from './keywords.js';

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
  /**
   * The twice-daily digest notification. Its own switch, on by default, and it
   * never reads `mode`: a reader who wants only the digest must be able to say so.
   */
  digestEnabled?: boolean;
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
  prefs: { enabled?: boolean; mode?: PushMode; digestEnabled?: boolean },
): PushRecord | null {
  const rows = load();
  const record = rows.find((r) => r.token === token && r.userId === userId);
  if (!record) return null;
  if (typeof prefs.enabled === 'boolean') record.enabled = prefs.enabled;
  if (isValidMode(prefs.mode)) record.mode = prefs.mode;
  if (typeof prefs.digestEnabled === 'boolean') record.digestEnabled = prefs.digestEnabled;
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

/**
 * How old (by `publishedAt`) a newly ingested article may be and still push.
 *
 * Was 15 minutes, and that silently dropped most breaking alerts: measured on
 * 2026-11-27 (#76), Google News surfaces items 20-135+ minutes after
 * publication, and 6 of the 11 breaking sources come through it; a source
 * polled every 30 minutes also loses about half its items to a 15-minute gate.
 * Only الجزيرة reliably got through.
 *
 * Freshness is already guaranteed by the caller: only rows this run INSERTED
 * (first seen now) are passed in, and never on the backfill run after boot. This
 * ceiling only stops an old article that a feed re-surfaces for the first time.
 */
export const PUSH_MAX_AGE_MS = 90 * 60 * 1000;

/**
 * How long a sent story blocks another outlet's copy of the same event. The
 * in-run cluster dedupe only saw one refresh; a second outlet reporting the same
 * event 20 minutes later buzzed the phone again.
 */
export const RECENT_PUSH_WINDOW_MS = 3 * 60 * 60 * 1000;
const RECENT_PUSH_MAX = 200;

/**
 * Pure matching rule: should this article go to this device?
 * Breaking news reaches 'urgent' and 'all'; everything else only 'all'.
 */
export function shouldPushTo(record: PushRecord, article: Article): boolean {
  if (!record.enabled) return false;
  if (article.isBreaking) return record.mode === 'urgent' || record.mode === 'all';
  return record.mode === 'all';
}

/** Article ids already sent as a keyword push this process — one per article. */
const keywordPushedIds = new Set<string>();

/**
 * Stories already notified recently, with the users they reached.
 *
 * Several outlets covering one event must produce ONE notification, not one per
 * outlet, also across refreshes. Each run clusters its new articles together
 * with these, so a new copy of an already-sent event lands in the same cluster
 * and is dropped for the users who already have it.
 */
const recentPushes: Array<{ article: Article; users: Set<string>; at: number }> = [];

function rememberPush(article: Article, userId: string, now: number): void {
  let entry = recentPushes.find((e) => e.article.id === article.id);
  if (!entry) {
    entry = { article, users: new Set(), at: now };
    recentPushes.push(entry);
  }
  entry.users.add(userId);
}

function pruneRecentPushes(now: number): void {
  while (recentPushes.length && (now - recentPushes[0]!.at > RECENT_PUSH_WINDOW_MS || recentPushes.length > RECENT_PUSH_MAX)) {
    recentPushes.shift();
  }
}

/** Build a map from article id to a stable cluster key (lead id, or own id). */
export function clusterKeysFor(articles: Article[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const a of articles) keys.set(a.id, a.id);
  for (const cluster of clusterArticles(articles)) {
    if (cluster.members.length < 2) continue;
    for (const member of cluster.members) keys.set(member.id, cluster.lead.id);
  }
  return keys;
}

/**
 * Pure rule for a keyword push: the article matches a keyword the user follows
 * with notifications on, the device is enabled, and the article is not already
 * going out as a breaking/all push for the same device.
 */
export function shouldKeywordPush(
  record: PushRecord,
  matched: FollowedKeyword[],
  alreadyPushed: boolean,
): boolean {
  if (!record.enabled) return false;
  if (alreadyPushed) return false;
  return matched.some((k) => k.notify);
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
export function buildFcmMessage(
  article: Article,
  token: string,
  options: { keyword?: string } = {},
): FcmMessage {
  // A keyword push always goes out on the "news" channel: it is a topic match,
  // not a breaking alert, so it must not arrive with breaking importance.
  const isKeyword = typeof options.keyword === 'string';
  const title = isKeyword
    ? `${options.keyword}`
    : article.isBreaking
      ? 'خبر عاجل'
      : article.sourceName;
  return {
    token,
    notification: { title, body: article.title },
    data: { articleId: article.id, ...(isKeyword ? { keyword: options.keyword! } : {}) },
    android: {
      priority: !isKeyword && article.isBreaking ? 'high' : 'normal',
      notification: {
        channel_id: !isKeyword && article.isBreaking ? CHANNEL_BREAKING : CHANNEL_NEWS,
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
 * - only articles this run inserted, published within PUSH_MAX_AGE_MS (no backfill bursts),
 * - breaking candidates get an AI veto (breakingAi.ts); no answer keeps the rule,
 * - one notification per story per device, also across refreshes (RECENT_PUSH_WINDOW_MS),
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
  options: { confirmBreaking?: ConfirmBreaking | null } = {},
): Promise<string[]> {
  if (!newArticles.length) return [];

  const records = getAllPushRecords().filter((r) => r.enabled && r.provider === 'fcm');
  if (!records.length) return [];

  const account = loadServiceAccount();
  if (!account) return [];

  const now = Date.now();
  const cutoff = now - PUSH_MAX_AGE_MS;
  const fresh = newArticles.filter(
    (a) => a.publishedAt >= cutoff && !pushedArticleIds.has(a.id),
  );
  if (!fresh.length) return [];

  // AI veto on breaking candidates: a «no» demotes the article to ordinary news
  // (it still reaches 'all' devices on the normal channel); no answer keeps the
  // rule's decision. Off in tests unless a confirmer is passed in.
  const confirm =
    options.confirmBreaking !== undefined
      ? options.confirmBreaking
      : process.env['NODE_ENV'] === 'test' || process.env['BREAKING_AI'] === '0'
        ? null
        : confirmBreakingWithAi;
  const aiNote = new Map<string, string>();
  const pushable: Article[] = [...fresh];
  if (confirm) {
    const flagged = pushable.map((a, i) => [a, i] as const).filter(([a]) => a.isBreaking);
    await runWithConcurrency(flagged, 4, async ([article, i]) => {
      let verdict: boolean | null = null;
      try {
        verdict = await confirm(article);
      } catch {
        verdict = null;
      }
      aiNote.set(article.id, verdict === null ? 'ai-unavailable' : verdict ? 'ai-confirmed' : 'ai-rejected');
      if (verdict === false) pushable[i] = { ...article, isBreaking: false };
    });
  }

  const jobs: Array<{ article: Article; record: PushRecord }> = [];
  const delivered: string[] = [];
  pruneRecentPushes(now);
  // Cluster this run's articles together with what was sent recently, so a new
  // outlet's copy of an event already on the phone is recognised.
  const clusterKeys = clusterKeysFor([...recentPushes.map((e) => e.article), ...pushable]);
  /** Cluster keys already claimed, per device: seeded with recent sends. */
  const claimed = new Set<string>();
  for (const entry of recentPushes) {
    const key = clusterKeys.get(entry.article.id) ?? entry.article.id;
    for (const userId of entry.users) claimed.add(`${userId}:${key}`);
  }

  for (const article of pushable) {
    const targets = records.filter((r) => shouldPushTo(r, article));
    if (!targets.length) continue;
    const clusterKey = clusterKeys.get(article.id) ?? article.id;
    for (const record of targets) {
      const claim = `${record.userId}:${clusterKey}`;
      // One notification per cluster per device: a second outlet reporting the
      // same event is dropped here rather than buzzing the phone again.
      if (claimed.has(claim)) continue;
      claimed.add(claim);
      jobs.push({ article, record });
    }
    pushedArticleIds.add(article.id);
    delivered.push(article.id);
  }
  // Breaking candidates the AI turned down are logged even when nobody is in
  // 'all' mode, so a wrong veto is visible in the server log.
  for (const original of fresh) {
    if (original.isBreaking && aiNote.get(original.id) === 'ai-rejected') {
      console.log(`[push] breaking vetoed by AI (${original.sourceId}): ${original.title.slice(0, 120)}`);
    }
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

  const sentOk = new Map<string, number>();
  await runWithConcurrency(jobs, FCM_CONCURRENCY, async ({ article, record }) => {
    const result = await sendFcmMessage(
      account.project_id,
      accessToken,
      buildFcmMessage(article, record.token),
      fetcher,
    );
    if (result === 'dead') removeDeadToken(record.token);
    if (result === 'ok') sentOk.set(article.id, (sentOk.get(article.id) ?? 0) + 1);
  });
  for (const { article, record } of jobs) rememberPush(article, record.userId, now);
  // One line per breaking alert, so production can answer "did it go out?".
  const seen = new Set<string>();
  for (const { article } of jobs) {
    if (!article.isBreaking || seen.has(article.id)) continue;
    seen.add(article.id);
    const devices = jobs.filter((j) => j.article.id === article.id).length;
    console.log(
      `[push] breaking sent to ${sentOk.get(article.id) ?? 0}/${devices} devices ` +
        `(${article.sourceId}, ${Math.round((now - article.publishedAt) / 60000)}min old, ` +
        `${aiNote.get(article.id) ?? 'ai-off'}): ${article.title.slice(0, 120)}`,
    );
  }

  // Second pass: keyword pushes. An article already sent to a device as a
  // breaking/all push is not sent again for a keyword, and each user has a daily
  // budget. Muted articles are never keyword-pushed.
  const alreadySent = new Set(jobs.map((j) => `${j.article.id}:${j.record.userId}`));
  const keywordJobs: Array<{ article: Article; record: PushRecord; keyword: string }> = [];
  const budgetUsed = new Map<string, number>();

  // Devices belong to users; group by user so preferences are read once. Built once
  // per run — it was rebuilt inside the article loop, articles × devices of work.
  const byUser = new Map<string, PushRecord[]>();
  for (const record of records) {
    const list = byUser.get(record.userId) ?? [];
    list.push(record);
    byUser.set(record.userId, list);
  }

  for (const article of pushable) {
    if (keywordPushedIds.has(article.id)) continue;
    // Same cluster already notified for this user? Then the story is already on
    // their phone; do not buzz again for another outlet's copy.
    const articleClusterKey = clusterKeys.get(article.id) ?? article.id;

    for (const [userId, userRecords] of byUser) {
      const prefs = getPreferences(userId);
      if (!prefs.keywords.length) continue;
      if (isMuted(article, prefs)) continue;

      const matched = matchingFollowedKeywords(article, prefs);
      if (!matched.length) continue;

      const budget = keywordPushBudget(userId);
      const used = budgetUsed.get(userId) ?? 0;
      if (budget.remaining - used <= 0) continue;

      let sent = false;
      for (const record of userRecords) {
        if (claimed.has(`${userId}:${articleClusterKey}`)) continue;
        if (!shouldKeywordPush(record, matched, alreadySent.has(`${article.id}:${record.userId}`))) continue;
        const keyword = matched[0]!.label;
        keywordJobs.push({ article, record, keyword });
        sent = true;
      }
      if (sent) {
        budgetUsed.set(userId, used + 1);
        recordKeywordPush(userId, 1);
      }
    }
    keywordPushedIds.add(article.id);
  }

  if (keywordJobs.length) {
    await runWithConcurrency(keywordJobs, FCM_CONCURRENCY, async ({ article, record, keyword }) => {
      const result = await sendFcmMessage(
        account.project_id,
        accessToken,
        buildFcmMessage(article, record.token, { keyword }),
        fetcher,
      );
      if (result === 'dead') removeDeadToken(record.token);
    });
  }

  trimDedupe(pushedArticleIds);
  trimDedupe(keywordPushedIds);
  return delivered;
}

/**
 * The dedupe sets only need recent ids: an article older than PUSH_MAX_AGE_MS is
 * never pushed anyway. Without a cap they grew by every new article for the life of
 * the process. A Set iterates in insertion order, so the oldest ids go first.
 */
const DEDUPE_MAX = 20_000;
function trimDedupe(set: Set<string>): void {
  if (set.size <= DEDUPE_MAX) return;
  for (const id of set) {
    if (set.size <= DEDUPE_MAX) break;
    set.delete(id);
  }
}

/** Reset the in-process dedupe set (tests only). */
export function _resetPushedIds(): void {
  pushedArticleIds.clear();
  keywordPushedIds.clear();
  recentPushes.length = 0;
}

/** The digest channel Android shows for a twice-daily summary. */
export const CHANNEL_DIGEST = 'digest';

/** The FCM payload for a new digest: a count and a deep link, no article data. */
export function buildDigestMessage(
  token: string,
  summary: { count: number; slot: string },
): FcmMessage {
  return {
    token,
    notification: {
      title: 'خلاصتك اليومية',
      body:
        summary.count > 0
          ? `${summary.count} أخبار مختارة لك — اضغط للاطلاع`
          : 'خلاصتك جاهزة — اضغط للاطلاع',
    },
    data: { digest: '1', slot: summary.slot },
    android: {
      // Never `breaking` importance: a digest is not an emergency.
      priority: 'normal',
      notification: { channel_id: CHANNEL_DIGEST, color: '#22C55E' },
    },
  };
}

/**
 * Tell every device that opted into the digest that a new one is ready.
 *
 * Deliberately separate from `sendPushNotifications`: it ignores the breaking/all
 * modes, so a reader who muted breaking news still gets the digest, and one who
 * only wants breaking news can turn this off. Returns how many devices accepted.
 */
export async function sendDigestNotifications(
  digest: { slot: string; count: number },
  fetcher: typeof fetch = fetch,
): Promise<number> {
  // `digestEnabled` is on unless it was explicitly turned off.
  const records = getAllPushRecords().filter(
    (r) => r.provider === 'fcm' && r.enabled && r.digestEnabled !== false,
  );
  if (!records.length) return 0;
  const account = loadServiceAccount();
  if (!account) return 0;

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, fetcher);
  } catch (err) {
    console.error('[push] digest: could not get an access token:', err);
    return 0;
  }

  let sent = 0;
  for (const record of records) {
    const outcome = await sendFcmMessage(
      account.project_id,
      accessToken,
      buildDigestMessage(record.token, digest),
      fetcher,
    );
    if (outcome === 'ok') sent += 1;
    if (outcome === 'dead') unregisterPushToken(record.userId, record.token);
  }
  return sent;
}

/** The FCM payload for a football event on a followed team. */
export function buildMatchMessage(
  token: string,
  event: { kind: 'kickoff' | 'goal' | 'final'; home: string; away: string; score?: string },
): FcmMessage {
  const title =
    event.kind === 'goal'
      ? `هدف — ${event.home} × ${event.away}`
      : event.kind === 'kickoff'
        ? `انطلاق المباراة — ${event.home} × ${event.away}`
        : `انتهت المباراة — ${event.home} × ${event.away}`;
  return {
    token,
    notification: {
      title,
      body:
        event.kind === 'goal'
          ? `النتيجة الآن ${event.score ?? ''}`.trim()
          : event.kind === 'kickoff'
            ? 'المباراة بدأت الآن'
            : `النتيجة النهائية ${event.score ?? ''}`.trim(),
    },
    // Its own channel, so a reader can mute football without muting the news.
    data: { football: '1', kind: event.kind },
    android: {
      priority: event.kind === 'goal' ? 'high' : 'normal',
      notification: { channel_id: 'football', color: '#34D399' },
    },
  };
}

/**
 * Tell the followers of a team about a match transition.
 *
 * Only called for a real change the source reported (a score that moved, a match
 * that started or ended), never on a guess, and each device's own switches are
 * respected. Returns how many devices accepted.
 */
export async function sendMatchNotifications(
  event: { kind: 'kickoff' | 'goal' | 'final'; home: string; away: string; score?: string },
  followers: Array<{ userId: string; follow: { notifyKickoff: boolean; notifyGoals: boolean; notifyFinal: boolean } }>,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const wanted = followers.filter(({ follow }) =>
    event.kind === 'goal' ? follow.notifyGoals : event.kind === 'kickoff' ? follow.notifyKickoff : follow.notifyFinal,
  );
  if (!wanted.length) return 0;
  const records = getAllPushRecords().filter(
    (r) => r.provider === 'fcm' && r.enabled && wanted.some((w) => w.userId === r.userId),
  );
  if (!records.length) return 0;
  const account = loadServiceAccount();
  if (!account) return 0;
  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, fetcher);
  } catch (err) {
    console.error('[push] match: could not get an access token:', err);
    return 0;
  }
  let sent = 0;
  for (const record of records) {
    const outcome = await sendFcmMessage(account.project_id, accessToken, buildMatchMessage(record.token, event), fetcher);
    if (outcome === 'ok') sent += 1;
    if (outcome === 'dead') unregisterPushToken(record.userId, record.token);
  }
  return sent;
}

/** One event of a followed match, ready to send (see matchWatch.ts). */
export interface WatchPush {
  title: string;
  body: string;
  /** The event kind, for the app's own routing and analytics. */
  kind: string;
  matchId: string;
  date: string;
  /** Goals, red cards, kick-off and the final whistle wake the phone. */
  urgent: boolean;
}

/** The FCM payload for one event of a match the reader follows. */
export function buildWatchMessage(token: string, push: WatchPush): FcmMessage {
  return {
    token,
    notification: { title: push.title, body: push.body },
    // `matchId` + `date` let a tap open the match centre directly.
    data: { football: '1', kind: push.kind, matchId: push.matchId, date: push.date },
    android: {
      priority: push.urgent ? 'high' : 'normal',
      notification: { channel_id: 'football', color: '#34D399' },
    },
  };
}

/**
 * Send one match event to the readers who follow that match.
 *
 * One access token for the whole round, and dead tokens are dropped, exactly like
 * the team notifications. Returns how many devices accepted.
 */
export async function sendWatchNotifications(
  userIds: string[],
  pushes: WatchPush[],
  fetcher: typeof fetch = fetch,
): Promise<number> {
  if (!userIds.length || !pushes.length) return 0;
  const wanted = new Set(userIds);
  const records = getAllPushRecords().filter((r) => r.provider === 'fcm' && r.enabled && wanted.has(r.userId));
  if (!records.length) return 0;
  const account = loadServiceAccount();
  if (!account) return 0;
  let accessToken: string;
  try {
    accessToken = await getAccessToken(account, fetcher);
  } catch (err) {
    console.error('[push] match watch: could not get an access token:', err);
    return 0;
  }
  let sent = 0;
  for (const push of pushes) {
    for (const record of records) {
      const outcome = await sendFcmMessage(account.project_id, accessToken, buildWatchMessage(record.token, push), fetcher);
      if (outcome === 'ok') sent += 1;
      if (outcome === 'dead') unregisterPushToken(record.userId, record.token);
    }
  }
  return sent;
}
