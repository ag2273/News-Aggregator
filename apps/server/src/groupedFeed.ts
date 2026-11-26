// The grouped feed: same-story clusters, for GET /api/feed?grouped=1.
//
// Pagination contract: the unit of paging is a "row", which is either a single
// article or a cluster. A cluster's members never appear separately, so no
// member can show up again on another page. Balancing still applies: the row
// order is the balanced article order with each cluster collapsed into its
// first appearance.

import { balancedPage } from './balance.js';
import { clusterArticles, clusterArticlesAsync, type Cluster } from './cluster.js';
import type { Article } from './types.js';

export type FeedRow =
  | { kind: 'article'; article: Article }
  | { kind: 'cluster'; lead: Article; members: Article[] };

/**
 * Collapse clusters into rows, preserving the given article order.
 *
 * Every cluster is keyed by its members' ids. Walking the ordered articles, the
 * first member encountered emits the cluster row and the rest are skipped, so a
 * member appears in exactly one place.
 */
export function collapseToRows(articles: Article[], clusters: Cluster[]): FeedRow[] {
  const ownerOf = new Map<string, Cluster>();
  for (const cluster of clusters) {
    if (cluster.members.length < 2) continue;
    for (const member of cluster.members) ownerOf.set(member.id, cluster);
  }

  const emitted = new Set<string>();
  const rows: FeedRow[] = [];

  for (const article of articles) {
    const cluster = ownerOf.get(article.id);
    if (!cluster) {
      rows.push({ kind: 'article', article });
      continue;
    }
    if (emitted.has(cluster.lead.id)) continue;
    emitted.add(cluster.lead.id);
    rows.push({ kind: 'cluster', lead: cluster.lead, members: cluster.members });
  }

  return rows;
}

export interface GroupedPage {
  rows: FeedRow[];
  totalRows: number;
  /** Articles covered by the page, for the existing `total` contract. */
  totalArticles: number;
}

/**
 * Everything about the grouped feed that depends on the whole store but not on the
 * page asked for: the clusters, the rows, and which row owns each article.
 *
 * Built once per store version and reused for every page and every reader (see
 * `groupedFeedPageCached`), so a request costs a balanced slice, not a re-cluster
 * of ~21,000 titles.
 */
export interface GroupedIndex {
  ordered: Article[];
  rows: FeedRow[];
  byArticleId: Map<string, FeedRow>;
}

export function buildGroupedIndex(ordered: Article[]): GroupedIndex {
  const clusters = clusterArticles(ordered);
  const rows = collapseToRows(ordered, clusters);
  // Which row each article heads: a single article, or a cluster by its lead.
  const byArticleId = new Map<string, FeedRow>();
  for (const row of rows) {
    if (row.kind === 'article') byArticleId.set(row.article.id, row);
    else byArticleId.set(row.lead.id, row);
  }
  return { ordered, rows, byArticleId };
}

/** One page cut from a prebuilt index. Same result as `groupedFeedPage`. */
export function pageFromIndex(
  index: GroupedIndex,
  offset: number,
  limit: number,
  maxPerSource?: number,
): GroupedPage {
  const { ordered, rows, byArticleId } = index;
  // Balance over articles first, so the page still spreads across sources.
  const balancedArticles = balancedPage(ordered, offset, limit, maxPerSource);

  const seen = new Set<string>();
  const pageRows: FeedRow[] = [];
  for (const article of balancedArticles) {
    const row = byArticleId.get(article.id);
    if (!row) continue;
    const key = row.kind === 'article' ? row.article.id : row.lead.id;
    if (seen.has(key)) continue;
    seen.add(key);
    pageRows.push(row);
  }

  return {
    rows: pageRows,
    totalRows: rows.length,
    totalArticles: ordered.length,
  };
}

/**
 * One page of the grouped feed.
 *
 * `ordered` is newest-first; balancing is applied at article level first so the
 * page still spreads across sources, then clusters are collapsed and the page is
 * cut at row boundaries.
 */
export function groupedFeedPage(
  ordered: Article[],
  offset: number,
  limit: number,
  maxPerSource?: number,
): GroupedPage {
  return pageFromIndex(buildGroupedIndex(ordered), offset, limit, maxPerSource);
}

let cachedIndex: { version: number; index: GroupedIndex } | null = null;
let rebuilding: { version: number; promise: Promise<void> } | null = null;

/** The index from already-clustered rows (shared by the sync and async builds). */
function indexFrom(ordered: Article[], clusters: Cluster[]): GroupedIndex {
  const rows = collapseToRows(ordered, clusters);
  const byArticleId = new Map<string, FeedRow>();
  for (const row of rows) {
    if (row.kind === 'article') byArticleId.set(row.article.id, row);
    else byArticleId.set(row.lead.id, row);
  }
  return { ordered, rows, byArticleId };
}

/**
 * Rebuild the index for `version` without blocking: the clustering yields between
 * slices. One rebuild at a time; a newer version waits for the running one.
 */
export function rebuildGroupedIndex(version: number, load: () => Article[]): Promise<void> {
  if (cachedIndex?.version === version) return Promise.resolve();
  if (rebuilding?.version === version) return rebuilding.promise;
  const previous = rebuilding?.promise ?? Promise.resolve();
  const ordered = load();
  const promise = previous
    .then(() => clusterArticlesAsync(ordered))
    .then((clusters) => {
      // A newer build may have landed while this one ran; never go backwards.
      if (!cachedIndex || cachedIndex.version < version) {
        cachedIndex = { version, index: indexFrom(ordered, clusters) };
      }
    })
    .finally(() => {
      if (rebuilding?.promise === promise) rebuilding = null;
    });
  rebuilding = { version, promise };
  return promise;
}

/**
 * The grouped page, reusing the index while the store has not changed.
 *
 * `version` is the store version (`getStoreVersion`); `load` is only called when it
 * moved. The feed refreshes every few minutes, so readers in between share one build.
 *
 * With `serveStale`, a reader who arrives right after a refresh gets the previous
 * index (one refresh old) while the new one is built in the background, instead of
 * waiting for — and blocking every other route behind — a synchronous re-cluster.
 * Only the very first build, when there is nothing to serve, is synchronous.
 */
export function groupedFeedPageCached(
  version: number,
  load: () => Article[],
  offset: number,
  limit: number,
  maxPerSource?: number,
  options: { serveStale?: boolean } = {},
): GroupedPage {
  if (!cachedIndex || cachedIndex.version !== version) {
    if (options.serveStale && cachedIndex) {
      void rebuildGroupedIndex(version, load).catch((err) =>
        console.error('[feed] grouped rebuild failed:', err),
      );
    } else {
      cachedIndex = { version, index: buildGroupedIndex(load()) };
    }
  }
  return pageFromIndex(cachedIndex.index, offset, limit, maxPerSource);
}
