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
import { sourceColor } from './sourceIcons.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let lastFetchTime = 0;

/**
 * Reset the refresh bookkeeping (tests only).
 *
 * Without this a suite that calls `/api/feed` twice gets "cache still fresh" on
 * the second call and sees a stale store — the route's refresh was masking it.
 */
export function _resetIngestState(): void {
  lastFetchTime = 0;
  firstRefreshDone = false;
  lastFetchBySource.clear();
}
/**
 * When each source was last polled. The ticker is 10 minutes; a source whose
 * `intervalMinutes` has not elapsed is skipped, so a 100-a-day paper is not
 * fetched as often as a 1,600-a-day one. Staggered by the registry order, so the
 * run never fires every source at once.
 */
const lastFetchBySource = new Map<string, number>();

/**
 * Strip the breaking flag for a source that is not allowed to set it.
 *
 * Two guards exist on purpose: this one stops the flag being written, and the
 * migration in db.ts stops it coming back on the next load. Either alone would
 * do for a fresh row, but the migration re-runs the rule over the whole store,
 * so both are needed.
 */
export function applySourceBreaking<T extends { isBreaking: boolean }>(
  rows: T[],
  source: { breaking: boolean },
): T[] {
  return source.breaking ? rows : rows.map((a) => ({ ...a, isBreaking: false }));
}

/** Which sources are due at `now`. Exported for the tests and the load check. */
export function dueSources(now: number = Date.now()): typeof SOURCES {
  return SOURCES.filter((source) => {
    const last = lastFetchBySource.get(source.id) ?? 0;
    return now - last >= source.intervalMinutes * 60 * 1000;
  });
}
/** The first refresh after boot is a backfill, never a push trigger. */
let firstRefreshDone = false;

export async function refreshAll(): Promise<void> {
  // Never fetch live feeds from a test process. `/api/feed` calls this on every
  // request, so without the guard a suite hits 29 real feeds, which both stalls
  // the run and silently inserts ~1,200 production rows into the test store —
  // that is what made an unrelated card test see a 1,198-row corpus.
  if (process.env['NODE_ENV'] === 'test' && process.env['ALLOW_TEST_INGEST'] !== '1') {
    return;
  }
  const now = Date.now();

  if (now - lastFetchTime < CACHE_TTL_MS) {
    console.log('[ingest] cache still fresh, skipping fetch');
    return;
  }

  lastFetchTime = now;
  const due = dueSources(now);
  if (!due.length) {
    console.log('[ingest] nothing due this tick');
    return;
  }
  console.log('[ingest] fetching', due.length, 'of', SOURCES.length, 'sources…');

  const results = await Promise.allSettled(due.map((s) => fetchSource(s)));

  let totalNew = 0;
  const freshArticles: Article[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const src = due[i] as (typeof SOURCES)[number];
    lastFetchBySource.set(src.id, now);
    if (r.status === 'fulfilled') {
      // A source with breaking disabled ingests normally but never carries the
      // flag, so it cannot reach the urgent push. See `Source.breaking`.
      const rows = applySourceBreaking(r.value, src);
      const inserted = insertArticlesDetailed(rows);
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

/** Every stored article as an API Article, newest-first (for the grouped feed). */
export function getFeedArticles(): Article[] {
  return getAllArticles().map(toArticle);
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
  const configured = new Map(SOURCES.map((s) => [s.id, s]));
  // The registry is the source of truth: a source removed from it must disappear
  // from مصادري even while its old rows are still in the corpus, otherwise the app
  // lists an outlet that will never update again.
  const rows = getDistinctSources()
    .filter((r) => configured.has(r.id))
    .map((r) => ({ ...r, name: configured.get(r.id)?.nameAr ?? r.name }));

  // Always include configured sources even if they have 0 articles yet.
  const seen = new Set(rows.map((r) => r.id));
  for (const s of SOURCES) {
    if (!seen.has(s.id)) rows.push({ id: s.id, name: s.nameAr, country: s.country });
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
    // A picture found on the publisher's page after this copy was made (#57): the
    // grouped feed's index holds copies built before the background image pass.
    imageUrl: article.imageUrl ?? findArticleById(article.id)?.imageUrl ?? null,
    // The outlet's colour, for the card's image slot when there is no picture.
    sourceColor: sourceColor(article.sourceId),
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
