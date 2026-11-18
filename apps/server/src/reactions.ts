// Article reactions: five emoji types, one per user per article.
//
// Storage mirrors the other stores (JSON under DATA_DIR, loaded into a cache and
// rewritten on change) so it survives restarts and deploys. Shape is keyed by
// article then user, which makes "one per user per article" a map assignment
// instead of a search, and makes the counts a fold over the article's entries.
//
// Abuse: a user may change reactions at most REACTION_RATE_LIMIT times per
// minute. The limit is per user, not per IP: the app is authenticated.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const REACTIONS_FILE = path.join(DATA_DIR, 'reactions.json');

export const REACTION_TYPES = ['like', 'love', 'wow', 'sad', 'angry'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

/** Emoji per type, shared by the API docs and the mobile UI. */
export const REACTION_EMOJI: Record<ReactionType, string> = {
  like: '👍',
  love: '❤️',
  wow: '😮',
  sad: '😢',
  angry: '😡',
};

export function isValidReaction(type: unknown): type is ReactionType {
  return typeof type === 'string' && (REACTION_TYPES as readonly string[]).includes(type);
}

/** articleId -> userId -> type */
export type ReactionMap = Record<string, Record<string, ReactionType>>;

/** userId -> timestamps of recent changes (rate limiting). */
export type RateMap = Record<string, number[]>;

export const REACTION_RATE_LIMIT = 60;
export const REACTION_RATE_WINDOW_MS = 60 * 1000;

interface Store {
  reactions: ReactionMap;
  rates: RateMap;
}

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(REACTIONS_FILE, 'utf8')) as Partial<Store>;
    cache = {
      reactions: parsed.reactions ?? {},
      rates: parsed.rates ?? {},
    };
  } catch {
    cache = { reactions: {}, rates: {} };
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(REACTIONS_FILE), { recursive: true });
  fs.writeFileSync(REACTIONS_FILE, JSON.stringify(cache ?? { reactions: {}, rates: {} }, null, 2));
}

export interface ReactionCounts {
  like: number;
  love: number;
  wow: number;
  sad: number;
  angry: number;
  /** Sum of all reactions, for the "N تفاعل" header. */
  total: number;
}

export function emptyCounts(): ReactionCounts {
  return { like: 0, love: 0, wow: 0, sad: 0, angry: 0, total: 0 };
}

/** Counts for one article. Pure fold over its entries. */
export function countsFor(articleId: string): ReactionCounts {
  const entry = load().reactions[articleId];
  const counts = emptyCounts();
  if (!entry) return counts;
  for (const type of Object.values(entry)) {
    counts[type] += 1;
    counts.total += 1;
  }
  return counts;
}

/** The caller's reaction on an article, or null. */
export function myReaction(articleId: string, userId: string | null): ReactionType | null {
  if (!userId) return null;
  return load().reactions[articleId]?.[userId] ?? null;
}

/**
 * Set or replace a reaction. Returns the new counts and the caller's reaction.
 * Setting the same type twice is not special — the route turns a repeat tap into
 * a removal, because that is the UI rule.
 */
export function setReaction(
  articleId: string,
  userId: string,
  type: ReactionType,
): { counts: ReactionCounts; myReaction: ReactionType } {
  const store = load();
  store.reactions[articleId] ??= {};
  store.reactions[articleId]![userId] = type;
  cache = store;
  save();
  return { counts: countsFor(articleId), myReaction: type };
}

/** Remove the caller's reaction. Returns counts and null when there was none. */
export function removeReaction(
  articleId: string,
  userId: string,
): { counts: ReactionCounts; myReaction: null; removed: boolean } {
  const store = load();
  const entry = store.reactions[articleId];
  const existed = Boolean(entry?.[userId]);
  if (entry) {
    delete entry[userId];
    if (Object.keys(entry).length === 0) delete store.reactions[articleId];
    cache = store;
    save();
  }
  return { counts: countsFor(articleId), myReaction: null, removed: existed };
}

/** Delete every reaction by a user (account deletion). */
export function deleteReactionsForUser(userId: string): number {
  const store = load();
  let removed = 0;
  for (const [articleId, entry] of Object.entries(store.reactions)) {
    if (entry[userId]) {
      delete entry[userId];
      removed++;
      if (Object.keys(entry).length === 0) delete store.reactions[articleId];
    }
  }
  delete store.rates[userId];
  if (removed > 0) {
    cache = store;
    save();
  }
  return removed;
}

/**
 * Rate limit: allow at most REACTION_RATE_LIMIT changes per rolling minute.
 * Returns the state without recording.
 */
export function checkReactionRate(
  userId: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const times = (load().rates[userId] ?? []).filter((t) => t > now - REACTION_RATE_WINDOW_MS);
  if (times.length < REACTION_RATE_LIMIT) {
    return { allowed: true, remaining: REACTION_RATE_LIMIT - times.length, retryAfterMs: 0 };
  }
  const oldest = Math.min(...times);
  return { allowed: false, remaining: 0, retryAfterMs: oldest + REACTION_RATE_WINDOW_MS - now };
}

/** Record one change for the rate limit. */
export function recordReaction(userId: string, now: number = Date.now()): void {
  const store = load();
  const kept = (store.rates[userId] ?? []).filter((t) => t > now - REACTION_RATE_WINDOW_MS);
  kept.push(now);
  store.rates[userId] = kept;
  cache = store;
  save();
}

/** Total reactions for an article, used by the trending score. */
export function reactionWeight(articleId: string): number {
  return countsFor(articleId).total;
}

export function _resetReactionsCache(): void {
  cache = null;
}
