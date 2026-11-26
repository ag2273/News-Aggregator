// Usage analytics: aggregate counts only.
//
// Privacy is the hard rule, and it is enforced by shape rather than by promise:
//   - the only identifier that ever reaches this module is the anonymous install
//     id on the `X-Install-Id` header;
//   - it is immediately reduced to a salted hash for the current day's dedupe and
//     then discarded — the raw id is never written, logged or returned;
//   - the salt rotates at midnight, so hashes from different days cannot be
//     correlated into a person, and old salts are pruned;
//   - no email, user id, IP or article-reader identity is stored, and nothing here
//     joins an install id to an account.
//
// Storage is one JSON file under DATA_DIR (survives restarts and deploys) with a
// bucket per Cairo day. Old buckets are pruned to KEEP_DAYS, so the file is
// bounded: per day it holds counters, a query map and — for today and yesterday
// only — the hashed device list used for DAU dedupe.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coalescedWriter } from './coalescedWrite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');

/** Rolling retention. The brief asks for 90 days. */
export const KEEP_DAYS = 90;

/** Beacon budget per IP per window. */
export const BEACON_RATE_LIMIT = 120;
export const BEACON_RATE_WINDOW_MS = 60 * 1000;

/** A query shorter than this is not worth keeping (the brief's rule). */
export const MIN_QUERY_LENGTH = 2;

/** Top-N limits on the page. */
export const TOP_ARTICLES = 20;
export const TOP_QUERIES = 50;

/** Hard ceiling on one day's device list, so a flood cannot grow the file. */
const MAX_DEVICES_PER_DAY = 200_000;

export type EventKind = 'save' | 'follow' | 'keyword_follow' | 'keyword_mute';

/** Per-day bucket: counters only, plus the day's hashed devices while it is open. */
export interface DayBucket {
  /** Salted hashes of distinct install ids seen that day. Dropped after rollover. */
  devices?: string[];
  /** Unknown length: does the day still accept new hashes. */
  dau?: number;
  opens?: Record<string, number>;
  shares?: Record<string, number>;
  sourceViews?: Record<string, number>;
  queries?: Record<string, number>;
  signups?: number;
  events?: Record<string, number>;
}

export interface AnalyticsStore {
  days: Record<string, DayBucket>;
  /** day -> salt used for that day's device hashes. Only recent days kept. */
  salts: Record<string, string>;
  updatedAt: number;
}

let cache: AnalyticsStore | null = null;

function load(): AnalyticsStore {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8')) as Partial<AnalyticsStore>;
    cache = {
      days: parsed.days ?? {},
      salts: parsed.salts ?? {},
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    cache = { days: {}, salts: {}, updatedAt: 0 };
  }
  return cache;
}

// Coalesced: this runs on every open, share, search and ping (see coalescedWrite.ts).
const writeAnalytics = coalescedWriter(ANALYTICS_FILE, () =>
  JSON.stringify(cache ?? { days: {}, salts: {}, updatedAt: 0 }),
);

function save(): void {
  if (cache) cache.updatedAt = Date.now();
  writeAnalytics();
}

export function _resetAnalyticsCache(): void {
  cache = null;
}

/** Cairo day key (UTC+2, no DST since 2015) as YYYY-MM-DD. Defaults to now. */
export function dayKey(ms: number = Date.now()): string {
  const d = new Date(ms + 2 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** The day key N days before `ms`. */
export function dayKeyBefore(ms: number, days: number): string {
  return dayKey(ms - days * 24 * 60 * 60 * 1000);
}

/** Inclusive list of day keys from `from` to `to`, newest first. */
export function dayRange(fromMs: number, toMs: number): string[] {
  const out: string[] = [];
  const last = dayKey(toMs);
  let cursor = toMs;
  for (let i = 0; i < 400; i += 1) {
    const key = dayKey(cursor);
    out.push(key);
    if (key === dayKey(fromMs)) break;
    // Step back exactly one Cairo day.
    cursor -= 24 * 60 * 60 * 1000;
    if (dayKey(cursor) === last && out.length > 1) break;
  }
  return out;
}

function bump(map: Record<string, number> | undefined, key: string, by = 1): Record<string, number> {
  const next = map ?? {};
  next[key] = (next[key] ?? 0) + by;
  return next;
}

/** The salt for a day, created on first use. */
function saltFor(store: AnalyticsStore, day: string): string {
  const existing = store.salts[day];
  if (existing) return existing;
  const salt = crypto.randomBytes(16).toString('hex');
  store.salts[day] = salt;
  return salt;
}

/**
 * Reduce an install id to a day-scoped hash. The raw id never leaves this
 * function. `null` for a missing, blank or implausibly long value.
 */
export function deviceHash(installId: string | undefined | null, salt: string): string | null {
  if (typeof installId !== 'string') return null;
  const trimmed = installId.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  return crypto.createHash('sha256').update(`${salt}:${trimmed}`).digest('hex').slice(0, 32);
}

/**
 * Prune to KEEP_DAYS and drop the hashed device lists of closed days.
 * Run before every write; cheap because it walks a 90-entry map.
 */
export function prune(store: AnalyticsStore, now: number = Date.now()): void {
  const today = dayKey(now);
  const yesterday = dayKeyBefore(now, 1);
  const oldest = dayKeyBefore(now, KEEP_DAYS);
  for (const [day, bucket] of Object.entries(store.days)) {
    if (day < oldest) {
      delete store.days[day];
      delete store.salts[day];
      continue;
    }
    if (day !== today && day !== yesterday && bucket.devices) {
      // Closed day: keep the count, drop the hashes. This is what makes the file
      // bounded and what makes cross-day correlation impossible.
      bucket.dau = bucket.dau ?? bucket.devices.length;
      delete bucket.devices;
    }
  }
  for (const day of Object.keys(store.salts)) {
    if (day !== today && day !== yesterday) delete store.salts[day];
  }
}

/**
 * Is this day still inside the retention window? A back-dated write outside it
 * is dropped rather than stored and pruned on the next call.
 */
export function withinRetention(day: string, now: number = Date.now()): boolean {
  return day >= dayKeyBefore(now, KEEP_DAYS);
}

function bucketFor(store: AnalyticsStore, day: string): DayBucket {
  store.days[day] = store.days[day] ?? {};
  return store.days[day];
}

/** Count one distinct device for the day. Idempotent for the same hash. */
export function recordDevice(installId: string | null | undefined, now: number = Date.now()): boolean {
  const store = load();
  const day = dayKey(now);
  if (!withinRetention(day)) return false;
  const hash = deviceHash(installId, saltFor(store, day));
  if (!hash) return false;
  // Retention follows the wall clock, so a back-dated write cannot keep a day
  // alive after its window has passed.
  prune(store);
  const bucket = bucketFor(store, day);
  // A closed day has already dropped its hashes, so it cannot dedupe. Count the
  // sighting without storing an identifier: the number is all that is kept.
  const today = dayKey();
  const yesterday = dayKey(Date.now() - 24 * 60 * 60 * 1000);
  if (day !== today && day !== yesterday) {
    bucket.dau = (bucket.dau ?? 0) + 1;
    save();
    return true;
  }
  const list = bucket.devices ?? [];
  if (list.includes(hash)) return false;
  if (list.length >= MAX_DEVICES_PER_DAY) return false;
  list.push(hash);
  bucket.devices = list;
  save();
  return true;
}

/** Record one article open. Unauthenticated by design; carries no identity. */
export function recordOpen(articleId: string, now: number = Date.now()): void {
  if (!articleId) return;
  const store = load();
  // Retention is always relative to the wall clock, not to the event time: a
  // late write for an old day must not resurrect a pruned bucket.
  const day = dayKey(now);
  if (!withinRetention(day)) return;
  prune(store);
  const bucket = bucketFor(store, day);
  bucket.opens = bump(bucket.opens, articleId);
  save();
}

/** Record one share. */
export function recordShare(articleId: string, now: number = Date.now()): void {
  if (!articleId) return;
  const store = load();
  // Retention is always relative to the wall clock, not to the event time: a
  // late write for an old day must not resurrect a pruned bucket.
  const day = dayKey(now);
  if (!withinRetention(day)) return;
  prune(store);
  const bucket = bucketFor(store, day);
  bucket.shares = bump(bucket.shares, articleId);
  save();
}

/** Record a source-page view. */
export function recordSourceView(sourceId: string, now: number = Date.now()): void {
  if (!sourceId) return;
  const store = load();
  // Retention is always relative to the wall clock, not to the event time: a
  // late write for an old day must not resurrect a pruned bucket.
  const day = dayKey(now);
  if (!withinRetention(day)) return;
  prune(store);
  const bucket = bucketFor(store, day);
  bucket.sourceViews = bump(bucket.sourceViews, sourceId);
  save();
}

/** Record one save / follow / keyword action (counts only, no identity). */
export function recordEvent(kind: EventKind, now: number = Date.now()): void {
  const store = load();
  // Retention is always relative to the wall clock, not to the event time: a
  // late write for an old day must not resurrect a pruned bucket.
  const day = dayKey(now);
  if (!withinRetention(day)) return;
  prune(store);
  const bucket = bucketFor(store, day);
  bucket.events = bump(bucket.events, kind);
  save();
}

/** Record a sign-up, attributed to the day it happened. */
export function recordSignup(at: number = Date.now()): void {
  const store = load();
  const day = dayKey(at);
  if (!withinRetention(day)) return;
  prune(store);
  const bucket = bucketFor(store, day);
  bucket.signups = (bucket.signups ?? 0) + 1;
  save();
}

/**
 * Record a search query, normalized and with no link to whoever typed it.
 * Queries shorter than MIN_QUERY_LENGTH after trimming are dropped.
 */
export function recordQuery(rawQuery: string | null | undefined, now: number = Date.now()): void {
  const text = (rawQuery ?? '').trim();
  if (text.length < MIN_QUERY_LENGTH) return;
  const store = load();
  // Retention is always relative to the wall clock, not to the event time: a
  // late write for an old day must not resurrect a pruned bucket.
  const day = dayKey(now);
  if (!withinRetention(day)) return;
  prune(store);
  const bucket = bucketFor(store, day);
  bucket.queries = bump(bucket.queries, text);
  save();
}

// --- beacon rate limit (per IP, in memory) ---

const beaconHits = new Map<string, number[]>();

export function beaconRateState(
  ip: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterMs: number } {
  const times = (beaconHits.get(ip) ?? []).filter((t) => t > now - BEACON_RATE_WINDOW_MS);
  beaconHits.set(ip, times);
  if (times.length < BEACON_RATE_LIMIT) return { allowed: true, retryAfterMs: 0 };
  const oldest = Math.min(...times);
  return { allowed: false, retryAfterMs: oldest + BEACON_RATE_WINDOW_MS - now };
}

export function recordBeaconHit(ip: string, now: number = Date.now()): void {
  const times = (beaconHits.get(ip) ?? []).filter((t) => t > now - BEACON_RATE_WINDOW_MS);
  times.push(now);
  beaconHits.set(ip, times);
}

export function _resetBeaconRateLimit(): void {
  beaconHits.clear();
}

/** Read the raw store for aggregation. Callers must not mutate it. */
export function getAnalytics(): AnalyticsStore {
  return load();
}

/** Every stored day key, newest first. */
export function storedDays(store: AnalyticsStore): string[] {
  return Object.keys(store.days).sort().reverse();
}
