import {
  insertArticlesDetailed,
  getAllArticles,
  findArticleById,
  getDistinctSources,
} from './db.js';
import type { StoredArticle } from './db.js';
import { fetchSource } from './fetcher.js';
import { SOURCES } from './types.js';
import type { Article } from './types.js';
import { CATEGORIES, normalizeCategory } from './categorize.js';
import { sendPushNotifications } from './push.js';
import { balancedPage } from './balance.js';
import { rankTrending } from './trending.js';
import { countsFor, myReaction, reactionWeight } from './reactions.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let lastFetchTime = 0;
/** The first refresh after boot is a backfill, never a push trigger. */
let firstRefreshDone = false;

export async function refreshAll(): Promise<void> {
  const now = Date.now();

  if (now - lastFetchTime < CACHE_TTL_MS) {
    console.log('[ingest] cache still fresh, skipping fetch');
    return;
  }

  lastFetchTime = now;
  console.log('[ingest] fetching', SOURCES.length, 'sources in parallel…');

  const results = await Promise.allSettled(SOURCES.map((s) => fetchSource(s)));

  let totalNew = 0;
  const freshArticles: Article[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const src = SOURCES[i];
    if (r.status === 'fulfilled') {
      const inserted = insertArticlesDetailed(r.value);
      freshArticles.push(...inserted);
      console.log(`[ingest] ${src.id}: ${r.value.length} articles, ${inserted.length} new`);
      totalNew += inserted.length;
    } else {
      console.error(`[ingest] ${src.id}: ERROR`, r.reason);
    }
  }
  console.log('[ingest] done —', totalNew, 'new articles total');

  // Push only what this run actually inserted, and never on the first run
  // after process start (that one is a backfill of the whole store).
  if (firstRefreshDone && freshArticles.length) {
    try {
      await sendPushNotifications(freshArticles);
    } catch (err) {
      console.error('[ingest] push failed:', err);
    }
  }
  firstRefreshDone = true;
}

export function getArticles(limit = 50, offset = 0): Article[] {
  return getAllArticles()
    .slice(offset, offset + limit)
    .map(toArticle);
}

/**
 * The public feed: newest-first but balanced across sources, so one
 * high-volume outlet cannot fill the page. `total` stays the size of the
 * underlying store so clients can keep paging.
 */
export function getBalancedFeed(
  limit = 50,
  offset = 0,
  maxPerSource?: number,
): { articles: Article[]; total: number } {
  const rows = getAllArticles();
  const page = balancedPage(rows, offset, limit, maxPerSource);
  return { articles: page.map(toArticle), total: rows.length };
}

export function getArticleById(id: string): Article | null {
  const row = findArticleById(id);
  return row ? toArticle(row) : null;
}

export function getSources(): Array<{ id: string; name: string; country: string }> {
  const rows = getDistinctSources();

  // Always include configured sources even if they have 0 articles yet.
  const seen = new Set(rows.map((r) => r.id));
  for (const s of SOURCES) {
    if (!seen.has(s.id)) {
      rows.push({ id: s.id, name: s.nameAr, country: s.country });
    }
  }
  return rows;
}

/** Distinct categories present in stored articles, in fixed display order. */
export function getCategories(): Array<{ id: string; name: string }> {
  const present = new Set(getAllArticles().map((a) => normalizeCategory(a.category)));
  return CATEGORIES.filter((c) => present.has(c.id)).map((c) => ({ id: c.id, name: c.nameAr }));
}

/** Recent articles (last 48h) ordered newest-first. */
/**
 * Trending: ranked by recency + a capped reaction weight (see trending.ts).
 * The ranking is over recent articles only, so the log-weighted reaction term
 * can never lift an old story over a fresh one.
 */
export function getTrending(limit = 20): Article[] {
  const ranked = rankTrending(getAllArticles(), (id) => reactionWeight(id));
  return ranked.slice(0, limit).map(toArticle);
}

/** Articles for one source, newest-first, with limit/offset. */
export function getArticlesBySource(sourceId: string, limit = 50, offset = 0): Article[] {
  return getAllArticles()
    .filter((a) => a.sourceId === sourceId)
    .slice(offset, offset + limit)
    .map(toArticle);
}

/** Articles from multiple followed sources, newest-first, with limit/offset. */
export function getArticlesByFollowedSources(sourceIds: string[], limit = 50, offset = 0): Article[] {
  if (!sourceIds.length) return [];
  const allowed = new Set(sourceIds);
  return getAllArticles()
    .filter((a) => allowed.has(a.sourceId))
    .slice(offset, offset + limit)
    .map(toArticle);
}

/** Source metadata (Arabic name) for a source id, or null. */
export function getSourceMeta(sourceId: string): { id: string; name: string } | null {
  const s = SOURCES.find((x) => x.id === sourceId);
  return s ? { id: s.id, name: s.nameAr } : null;
}

/**
 * Attach reaction data to an article for the caller.
 * Counts always ship (the UI hides small ones); myReaction is null for guests.
 */
export function withReactions(article: Article, userId: string | null): Article {
  return {
    ...article,
    reactions: countsFor(article.id),
    myReaction: myReaction(article.id, userId),
  };
}

function toArticle(row: StoredArticle): Article {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    imageUrl: row.imageUrl,
    url: row.url,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    category: row.category,
    country: row.country,
    publishedAt: row.publishedAt,
    isBreaking: row.isBreaking,
  };
}
