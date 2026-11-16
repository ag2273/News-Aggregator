import {
  insertArticles,
  getAllArticles,
  findArticleById,
  getDistinctSources,
} from './db.js';
import type { StoredArticle } from './db.js';
import { fetchSource } from './fetcher.js';
import { SOURCES } from './types.js';
import type { Article } from './types.js';
import { CATEGORIES, normalizeCategory } from './categorize.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let lastFetchTime = 0;

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
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const src = SOURCES[i];
    if (r.status === 'fulfilled') {
      const inserted = insertArticles(r.value);
      console.log(`[ingest] ${src.id}: ${r.value.length} articles, ${inserted} new`);
      totalNew += inserted;
    } else {
      console.error(`[ingest] ${src.id}: ERROR`, r.reason);
    }
  }
  console.log('[ingest] done —', totalNew, 'new articles total');
}

export function getArticles(limit = 50, offset = 0): Article[] {
  return getAllArticles()
    .slice(offset, offset + limit)
    .map(toArticle);
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
export function getTrending(limit = 20): Article[] {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  return getAllArticles()
    .filter((a) => a.publishedAt >= cutoff)
    .slice(0, limit)
    .map(toArticle);
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
