// Full-text search over the in-memory article store.
// The store is already sorted newest-first, so searching only filters; it never
// re-sorts. Both the query and the haystack go through normalizeForSearch so
// Arabic orthography differences (أ/ا, ة/ه, ى/ي, tashkeel) cannot miss a match.

import { getAllArticlesReadonly } from './db.js';
import type { StoredArticle } from './db.js';
import type { Article } from './types.js';
import { normalizeForSearch } from './text.js';

export interface SearchResult {
  articles: Article[];
  /** Number of matches before limit/offset are applied. */
  total: number;
}

/**
 * The three normalised fields of a row, computed once per row object.
 *
 * Search used to normalise title, summary and source name of every stored row on
 * every query — ~0.2s of blocking work per search on 21k rows. A row object is
 * replaced whenever its text changes, so the cache cannot go stale.
 */
const normalizedFields = new WeakMap<object, [string, string, string]>();

function fieldsOf(row: StoredArticle): [string, string, string] {
  let f = normalizedFields.get(row);
  if (!f) {
    f = [normalizeForSearch(row.title), normalizeForSearch(row.summary ?? ''), normalizeForSearch(row.sourceName)];
    normalizedFields.set(row, f);
  }
  return f;
}

/** True when the normalized query occurs in the normalized title, summary or source name. */
export function articleMatchesQuery(row: StoredArticle, normalizedQuery: string): boolean {
  if (!normalizedQuery) return false;
  const [title, summary, source] = fieldsOf(row);
  return title.includes(normalizedQuery) || summary.includes(normalizedQuery) || source.includes(normalizedQuery);
}

/** Fill the search cache in slices, yielding between them (after boot or a refresh). */
export function warmSearch(rows: readonly StoredArticle[], chunk = 500): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = (): void => {
      const end = Math.min(rows.length, i + chunk);
      for (; i < end; i++) fieldsOf(rows[i]!);
      if (i < rows.length) setImmediate(step);
      else resolve();
    };
    setImmediate(step);
  });
}

/**
 * Pure search over an already newest-first row list. Kept separate from the
 * store so tests can run offline and deterministically.
 */
export function searchRows(
  rows: readonly StoredArticle[],
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
  return searchRows(getAllArticlesReadonly(), q, limit, offset);
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
