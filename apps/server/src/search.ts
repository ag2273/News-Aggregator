// Full-text search over the in-memory article store.
// The store is already sorted newest-first, so searching only filters; it never
// re-sorts. Both the query and the haystack go through normalizeForSearch so
// Arabic orthography differences (أ/ا, ة/ه, ى/ي, tashkeel) cannot miss a match.

import { getAllArticles } from './db.js';
import type { StoredArticle } from './db.js';
import type { Article } from './types.js';
import { normalizeForSearch } from './text.js';

export interface SearchResult {
  articles: Article[];
  /** Number of matches before limit/offset are applied. */
  total: number;
}

/** True when the normalized query occurs in the normalized title, summary or source name. */
export function articleMatchesQuery(row: StoredArticle, normalizedQuery: string): boolean {
  if (!normalizedQuery) return false;
  return (
    normalizeForSearch(row.title).includes(normalizedQuery) ||
    normalizeForSearch(row.summary ?? '').includes(normalizedQuery) ||
    normalizeForSearch(row.sourceName).includes(normalizedQuery)
  );
}

/**
 * Pure search over an already newest-first row list. Kept separate from the
 * store so tests can run offline and deterministically.
 */
export function searchRows(
  rows: StoredArticle[],
  q: string | null | undefined,
  limit = 50,
  offset = 0,
): SearchResult {
  const normalizedQuery = normalizeForSearch(q);
  if (!normalizedQuery) return { articles: [], total: 0 };

  const matches = rows.filter((row) => articleMatchesQuery(row, normalizedQuery));
  const start = Math.max(0, offset);
  const page = matches.slice(start, start + Math.max(0, limit));

  return { articles: page.map(toArticle), total: matches.length };
}

/**
 * Search articles newest-first.
 *
 * @param q      raw user query (empty/blank returns no matches)
 * @param limit  page size
 * @param offset page start
 */
export function searchArticles(q: string | null | undefined, limit = 50, offset = 0): SearchResult {
  return searchRows(getAllArticles(), q, limit, offset);
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
