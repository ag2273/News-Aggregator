// Digest storage: one file under DATA_DIR, shaped for the two jobs it does.
//
//   digests[slot] = the built digest for 09:00 or 18:00 Cairo
//   topics[userId] = which sections that reader wants
//
// A digest row carries the story, its source and the AI's verdict, so assembling
// a reader's digest is a filter, never another model call.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOPIC_IDS, type TopicId } from './digestAi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const DIGESTS_FILE = path.join(DATA_DIR, 'digests.json');

/** Cairo is UTC+2 with no DST since 2015. */
export const CAIRO_OFFSET_MS = 2 * 60 * 60 * 1000;

/** The two slots, in Cairo local time. */
export const DIGEST_SLOTS = ['09:00', '18:00'] as const;
export type DigestSlot = (typeof DIGEST_SLOTS)[number];

/** Keep at most this many digests: a week of history is plenty to fall back on. */
export const KEEP_DIGESTS = 14;

/** Items in one reader's digest. */
export const DIGEST_ITEMS = 6;

export interface DigestItem {
  articleId: string;
  title: string;
  url: string;
  sourceName: string;
  sourceId: string;
  category: TopicId;
  /** One or two Arabic sentences. */
  summary: string;
  /** Why it matters, short. */
  why: string;
  isBreaking: boolean;
  publishedAt: number;
  /** Prove how the summary was produced, so the UI never overstates. */
  textSource: 'full' | 'snippet';
}

export interface StoredDigest {
  /** `YYYY-MM-DDTHH:MM` in Cairo time — the slot key. */
  slot: string;
  builtAt: number;
  /** Candidates considered and how many reached the model. */
  considered: number;
  analysed: number;
  /** Sources whose full text could not be fetched, with counts. */
  failedSources: Record<string, number>;
  /** Model actually used, for the record. */
  model: string;
  items: DigestItem[];
}

export interface DigestStore {
  digests: Record<string, StoredDigest>;
  /** userId -> chosen topics. Absent means "the defaults". */
  topics: Record<string, TopicId[]>;
}

/** The sensible default for a first-time reader: sport off, everything else on. */
export const DEFAULT_TOPICS: TopicId[] = TOPIC_IDS.filter((t) => t !== 'sports');

let cache: DigestStore | null = null;

function load(): DigestStore {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DIGESTS_FILE, 'utf8')) as Partial<DigestStore>;
    cache = { digests: parsed.digests ?? {}, topics: parsed.topics ?? {} };
  } catch {
    cache = { digests: {}, topics: {} };
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(DIGESTS_FILE), { recursive: true });
  const store = cache ?? { digests: {}, topics: {} };
  fs.writeFileSync(DIGESTS_FILE, JSON.stringify(store));
  cache = store;
}

export function _resetDigestCache(): void {
  cache = null;
}

/** The slot key for a moment: `YYYY-MM-DDTHH:MM` in Cairo local time. */
export function slotKeyFor(ms: number, slot: DigestSlot): string {
  const local = new Date(ms + CAIRO_OFFSET_MS);
  return `${local.toISOString().slice(0, 10)}T${slot}`;
}

/** The slot whose build time has passed most recently, or null before 09:00. */
export function dueSlot(ms: number): { slot: DigestSlot; key: string; dueAt: number } | null {
  const local = new Date(ms + CAIRO_OFFSET_MS);
  const hours = local.getUTCHours();
  const minutes = local.getUTCMinutes();
  // 18:00 first: after it, today's evening digest is the current one.
  if (hours > 18 || (hours === 18 && minutes >= 0)) {
    const key = slotKeyFor(ms, '18:00');
    return { slot: '18:00', key, dueAt: slotDueAt(ms, '18:00') };
  }
  if (hours >= 9) {
    const key = slotKeyFor(ms, '09:00');
    return { slot: '09:00', key, dueAt: slotDueAt(ms, '09:00') };
  }
  return null;
}

/** When a given slot became due today, in epoch ms. */
export function slotDueAt(ms: number, slot: DigestSlot): number {
  const local = new Date(ms + CAIRO_OFFSET_MS);
  const [hh, mm] = slot.split(':').map(Number) as [number, number];
  const utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm);
  return utc - CAIRO_OFFSET_MS;
}

/** Every stored digest, newest first. */
export function allDigests(): StoredDigest[] {
  return Object.values(load().digests).sort((a, b) => (a.slot < b.slot ? 1 : -1));
}

/**
 * The digest to show: the newest built one. Never null after the first build, so
 * a failed run shows the previous digest instead of an empty screen.
 */
export function latestDigest(): StoredDigest | null {
  return allDigests()[0] ?? null;
}

export function digestForSlot(key: string): StoredDigest | null {
  return load().digests[key] ?? null;
}

/**
 * Store a freshly built digest, replacing the same slot and pruning old ones.
 * Returns the stored record.
 */
export function saveDigest(digest: StoredDigest): StoredDigest {
  const store = load();
  store.digests[digest.slot] = digest;
  const keys = Object.keys(store.digests).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - KEEP_DIGESTS))) delete store.digests[key];
  save();
  return digest;
}

/** A reader's topics, or the defaults when they have never chosen. */
export function topicsFor(userId: string | null): TopicId[] {
  if (!userId) return DEFAULT_TOPICS;
  const chosen = load().topics[userId];
  if (!chosen) return DEFAULT_TOPICS;
  // An explicitly empty selection is respected: the reader asked for nothing.
  return chosen.filter((t): t is TopicId => (TOPIC_IDS as readonly string[]).includes(t));
}

/** Set a reader's topics. Unknown ids are dropped; duplicates collapse. */
export function setTopics(userId: string, topics: TopicId[]): TopicId[] {
  const store = load();
  const clean = [...new Set(topics.filter((t) => (TOPIC_IDS as readonly string[]).includes(t)))];
  store.topics[userId] = clean;
  save();
  return clean;
}

/**
 * A reader's digest: the newest digest's items, filtered to their topics, newest
 * and most important first, capped so it stays short.
 */
export function digestForTopics(digest: StoredDigest | null, topics: TopicId[]): DigestItem[] {
  if (!digest) return [];
  const wanted = new Set(topics);
  return digest.items
    .filter((item) => wanted.has(item.category))
    .sort((a, b) => Number(b.isBreaking) - Number(a.isBreaking) || b.publishedAt - a.publishedAt)
    .slice(0, DIGEST_ITEMS);
}
