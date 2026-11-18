// Followed keywords and mutes: storage, matching, and the push rules.
//
// Matching uses the same Arabic normalization as search, so "الاهلي" matches
// "الأهلي" and diacritics are ignored. Matching is WHOLE-WORD where the keyword
// is a single word: "الأهلي" must not match inside "الأهلاوية" or an unrelated
// word. Multi-word keywords match as a normalized phrase.
//
// Mutes are the inverse: a muted keyword hides matching articles from that user's
// feeds, and a muted source hides that outlet. Filtering is server-side, so the
// client cannot accidentally bypass it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeForSearch } from './text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const KEYWORDS_FILE = path.join(DATA_DIR, 'keywords.json');

/** Caps from the brief. */
export const MAX_FOLLOWED_KEYWORDS = 20;
export const MAX_MUTED_KEYWORDS = 20;
export const MAX_MUTED_SOURCES = 50;
/** Keyword pushes per user per rolling day. */
export const KEYWORD_PUSH_DAILY_CAP = 10;
export const KEYWORD_PUSH_DAY_MS = 24 * 60 * 60 * 1000;

export interface FollowedKeyword {
  /** Normalized form, used for matching and uniqueness. */
  keyword: string;
  /** What the user typed, shown back in the UI. */
  label: string;
  /** Per-keyword notification toggle. */
  notify: boolean;
  addedAt: number;
}

export interface UserKeywordRecord {
  keywords: FollowedKeyword[];
  mutedKeywords: string[];
  mutedSources: string[];
  /** Timestamps of keyword pushes, for the daily cap. */
  pushes: number[];
}

export type KeywordStore = Record<string, UserKeywordRecord>;

let cache: KeywordStore | null = null;

function load(): KeywordStore {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8')) as unknown;
    cache = parsed && typeof parsed === 'object' ? (parsed as KeywordStore) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(KEYWORDS_FILE), { recursive: true });
  fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(cache ?? {}, null, 2));
}

function recordFor(userId: string): UserKeywordRecord {
  const store = load();
  store[userId] ??= { keywords: [], mutedKeywords: [], mutedSources: [], pushes: [] };
  return store[userId]!;
}

function persist(): void {
  cache = cache ?? {};
  save();
}

export function getPreferences(userId: string): UserKeywordRecord {
  const record = recordFor(userId);
  return {
    keywords: [...record.keywords],
    mutedKeywords: [...record.mutedKeywords],
    mutedSources: [...record.mutedSources],
    pushes: [...record.pushes],
  };
}

export type KeywordResult =
  | { ok: true; keywords: FollowedKeyword[] }
  | { ok: false; error: 'limit' | 'duplicate' | 'invalid' };

/** Add a followed keyword. Enforces the 20-keyword cap and uniqueness. */
export function addKeyword(
  userId: string,
  raw: string,
  notify = true,
  now: number = Date.now(),
): KeywordResult {
  const label = raw.trim();
  const keyword = normalizeForSearch(label);
  if (!keyword || keyword.length < 2) return { ok: false, error: 'invalid' };

  const record = recordFor(userId);
  if (record.keywords.length >= MAX_FOLLOWED_KEYWORDS) return { ok: false, error: 'limit' };
  if (record.keywords.some((k) => k.keyword === keyword)) return { ok: false, error: 'duplicate' };

  record.keywords.push({ keyword, label, notify, addedAt: now });
  persist();
  return { ok: true, keywords: [...record.keywords] };
}

export function removeKeyword(userId: string, keyword: string): FollowedKeyword[] {
  const norm = normalizeForSearch(keyword);
  const record = recordFor(userId);
  record.keywords = record.keywords.filter((k) => k.keyword !== norm);
  persist();
  return [...record.keywords];
}

/** Toggle notifications for one followed keyword. */
export function setKeywordNotify(
  userId: string,
  keyword: string,
  notify: boolean,
): FollowedKeyword[] {
  const norm = normalizeForSearch(keyword);
  const record = recordFor(userId);
  record.keywords = record.keywords.map((k) => (k.keyword === norm ? { ...k, notify } : k));
  persist();
  return [...record.keywords];
}

export function muteKeyword(userId: string, raw: string): string[] {
  const norm = normalizeForSearch(raw);
  if (!norm) return getPreferences(userId).mutedKeywords;
  const record = recordFor(userId);
  if (!record.mutedKeywords.includes(norm) && record.mutedKeywords.length < MAX_MUTED_KEYWORDS) {
    record.mutedKeywords.push(norm);
    persist();
  }
  return [...record.mutedKeywords];
}

export function unmuteKeyword(userId: string, raw: string): string[] {
  const norm = normalizeForSearch(raw);
  const record = recordFor(userId);
  record.mutedKeywords = record.mutedKeywords.filter((k) => k !== norm);
  persist();
  return [...record.mutedKeywords];
}

export function muteSource(userId: string, sourceId: string): string[] {
  const record = recordFor(userId);
  if (!record.mutedSources.includes(sourceId) && record.mutedSources.length < MAX_MUTED_SOURCES) {
    record.mutedSources.push(sourceId);
    persist();
  }
  return [...record.mutedSources];
}

export function unmuteSource(userId: string, sourceId: string): string[] {
  const record = recordFor(userId);
  record.mutedSources = record.mutedSources.filter((s) => s !== sourceId);
  persist();
  return [...record.mutedSources];
}

export function deleteKeywordsForUser(userId: string): boolean {
  const store = load();
  if (!store[userId]) return false;
  delete store[userId];
  cache = store;
  save();
  return true;
}

// --- matching ---

/**
 * Whole-word match of a normalized keyword inside normalized text.
 *
 * Substring matching is deliberately not used: "الأهلي" normalized is "الاهلي",
 * and a substring test would also fire on "الاهلاويه". Boundaries are checked on
 * the normalized string, where word characters are letters and digits.
 */
export function matchesKeyword(normalizedText: string, normalizedKeyword: string): boolean {
  if (!normalizedKeyword) return false;
  const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

  let from = 0;
  for (;;) {
    const at = normalizedText.indexOf(normalizedKeyword, from);
    if (at === -1) return false;
    const before = at === 0 ? undefined : normalizedText[at - 1];
    const after = normalizedText[at + normalizedKeyword.length];
    // A multi-word keyword already contains its own spaces, so boundary checks
    // only matter at the two ends.
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

/** True when an article's title or summary matches the keyword. */
export function articleMatchesKeyword(
  article: { title: string; summary: string | null },
  keyword: string,
): boolean {
  const body = normalizeForSearch(`${article.title} ${article.summary ?? ''}`);
  return matchesKeyword(body, keyword);
}

/**
 * Should this article be hidden from the user's feeds?
 * A muted source hides everything from it; a muted keyword hides any matching
 * article, regardless of source.
 */
export function isMuted(
  article: { sourceId: string; title: string; summary: string | null },
  prefs: UserKeywordRecord,
): boolean {
  if (prefs.mutedSources.includes(article.sourceId)) return true;
  if (!prefs.mutedKeywords.length) return false;
  const body = normalizeForSearch(`${article.title} ${article.summary ?? ''}`);
  return prefs.mutedKeywords.some((k) => matchesKeyword(body, k));
}

/** Which followed keywords an article matches (for keyword pushes). */
export function matchingFollowedKeywords(
  article: { title: string; summary: string | null },
  prefs: UserKeywordRecord,
): FollowedKeyword[] {
  const body = normalizeForSearch(`${article.title} ${article.summary ?? ''}`);
  return prefs.keywords.filter((k) => matchesKeyword(body, k.keyword));
}

/**
 * Budget for keyword pushes: at most KEYWORD_PUSH_DAILY_CAP per rolling day.
 * Returns the remaining budget without recording.
 */
export function keywordPushBudget(
  userId: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number } {
  const recent = (load()[userId]?.pushes ?? []).filter((t) => t > now - KEYWORD_PUSH_DAY_MS);
  const remaining = Math.max(0, KEYWORD_PUSH_DAILY_CAP - recent.length);
  return { allowed: remaining > 0, remaining };
}

/** Record keyword pushes (one per delivered article). */
export function recordKeywordPush(userId: string, count = 1, now: number = Date.now()): void {
  const record = recordFor(userId);
  record.pushes = record.pushes.filter((t) => t > now - KEYWORD_PUSH_DAY_MS);
  for (let i = 0; i < count; i++) record.pushes.push(now);
  persist();
}

export function _resetKeywordsCache(): void {
  cache = null;
}
