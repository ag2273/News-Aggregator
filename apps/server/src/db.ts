import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Article } from './types.js';
import { categorize, detectBreaking } from './categorize.js';
import { SOURCES } from './types.js';
import { isSectionPageTitle } from './fetcher.js';

/** Sources whose titles may be flagged breaking; every other outlet is pinned off. */
const BREAKING_ENABLED = new Set(SOURCES.filter((s) => s.breaking).map((s) => s.id));

/**
 * Sources whose whole beat is technology. Their `misc` rows are re-classified on
 * load after a vocabulary change, because those are precisely the rows a fixed
 * classifier can now file correctly. A general paper's `misc` is left alone: a
 * later vocabulary change should not silently re-label the wider corpus.
 */
const TECH_SOURCES = new Set([
  'tech-wd',
  'hashtagarabi',
  'arabhardware',
  'arabgamerz',
  'aitnews',
]);
import { decodeHtmlEntities } from './text.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir
  ? path.resolve(rawDataDir)
  : path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'news.json');

export interface StoredArticle extends Article {
  fetchedAt: number;
}

let cache: StoredArticle[] | null = null;

/**
 * Bumped whenever the stored rows change, so work derived from the whole store
 * (the grouped feed's clusters) can be reused until the next change instead of
 * being recomputed on every request.
 */
let storeVersion = 0;

/** The current store version; changes whenever rows are added, loaded or migrated. */
export function getStoreVersion(): number {
  return storeVersion;
}

/** Reset cache (for test suites) */
export function _resetDbCache(): void {
  cache = null;
  storeVersion++;
}

/** Lazy migration: re-classify legacy 'general' categories and decode leftover HTML entities. */
function migrate(rows: StoredArticle[]): { rows: StoredArticle[]; changed: boolean } {
  let changed = false;
  // Purge rows that were never news: a soft-404 page served with HTTP 200, or a
  // channel front. Measured: 5 copies of الأهرام's «عفوا الصفحة…» and 34 fronts
  // had been ingested over time. Scoped to the ingest filter's own rules, so
  // nothing else is touched, and reported so the count is visible.
  const before = rows.length;
  const kept = rows.filter((r) => !isSectionPageTitle(r.title));
  const purged = before - kept.length;
  if (purged > 0) {
    console.log(`[db] purged ${purged} non-article row(s): error pages and channel fronts`);
    changed = true;
  }
  const out = kept.map((r) => {
    let row = r;
    // Re-classify when the category is missing, legacy 'general', or when the
    // stored label is `misc` under a source that now has real vocabulary. Without
    // the last case a classifier fix only ever reaches NEW rows: measured, the
    // 24h tech count stayed at 4.4% after the vocabulary shipped because every
    // stored `misc` row kept its old label.
    const reclassify =
      !row.category ||
      row.category === 'general' ||
      (row.category === 'misc' && TECH_SOURCES.has(row.sourceId));
    if (reclassify) {
      const next = categorize(row.title, row.summary);
      if (next !== row.category) {
        row = { ...row, category: next };
        changed = true;
      }
    }
    const title = decodeHtmlEntities(row.title);
    const summary = row.summary === null ? null : decodeHtmlEntities(row.summary) || null;
    if (title !== row.title || summary !== row.summary) {
      row = { ...row, title, summary };
      changed = true;
    }
    // The rule re-runs on every load, so a source whose breaking is disabled has
    // to be pinned here too — otherwise the migration would quietly re-enable it.
    const isBreaking = BREAKING_ENABLED.has(row.sourceId) && detectBreaking(row.title);
    if (row.isBreaking !== isBreaking) {
      row = { ...row, isBreaking };
      changed = true;
    }
    return row;
  });
  return { rows: out, changed };
}

function load(): StoredArticle[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    cache = Array.isArray(parsed) ? (parsed as StoredArticle[]) : [];
  } catch {
    cache = [];
  }
  const { rows, changed } = migrate(cache);
  storeVersion++;
  if (changed) {
    cache = rows;
    save();
  }
  return cache;
}

/**
 * Persist the store in the background (#60).
 *
 * Measured on the production store (20,155,190 bytes / 21,409 rows): one
 * stringify + writeFileSync costs ~173ms of BLOCKING work. `refreshAll` inserts per
 * source, so one sweep of 29 feeds blocked the event loop for ~4.3s — and every
 * route, including the match centre, queued behind it. That is the user's "match
 * centre almost never opened" and "the app is slow after the cache", with no route
 * of theirs actually slow.
 *
 * The write is now asynchronous and coalesced: many inserts in one sweep produce ONE
 * write of the latest state, not 29. A crash between insert and flush can lose the
 * newest rows (they would simply be fetched again), which is the trade this makes on
 * purpose: serving readers beats fsync honesty for a news cache.
 */
let saveInFlight: Promise<void> | null = null;
let saveQueued = false;

/**
 * Whether writes must land before `save()` returns.
 *
 * True in a test or a one-shot script: a caller that inserts and then re-reads the
 * file expects its rows to be there. False in the server, where blocking the event
 * loop per insert is the whole problem this fixes (#60).
 */
const SYNC_SAVE = process.env['NODE_ENV'] === 'test' || process.env['DB_SYNC_SAVE'] === '1';

function saveSync(): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(cache ?? []));
}

function save(): void {
  if (SYNC_SAVE) {
    saveSync();
    return;
  }
  // Coalesce: if a write is already running, remember that another is needed and
  // let the running one pick the newest state when it finishes.
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  const write = async (): Promise<void> => {
    do {
      saveQueued = false;
      const snapshot = JSON.stringify(cache ?? []);
      await fs.promises.mkdir(path.dirname(DB_PATH), { recursive: true });
      await fs.promises.writeFile(DB_PATH, snapshot);
    } while (saveQueued);
  };
  saveInFlight = write()
    .catch((err) => {
      console.error('[db] save failed:', err);
    })
    .finally(() => {
      saveInFlight = null;
    });
}

/**
 * Wait for the pending write to land. For tests and for a graceful shutdown; the
 * servers route never awaits this.
 */
export async function flushDb(): Promise<void> {
  while (saveInFlight) await saveInFlight;
}

let urlIndex: { rows: StoredArticle[]; urls: Set<string> } | null = null;

export function insertArticles(articles: Article[]): number {
  return insertArticlesDetailed(articles).length;
}

/**
 * Insert only articles whose URL was not stored yet, returning the inserted
 * rows. Callers that need the new articles themselves (e.g. push notifications)
 * use this; the count-only wrapper stays for existing call sites and tests.
 */
export function insertArticlesDetailed(articles: Article[]): StoredArticle[] {
  const rows = load();
  // The URL set is kept between calls instead of rebuilt from all ~21k rows on each
  // of a sweep's 29 per-source inserts; it is rebuilt only when the store is
  // replaced (load, migration, prune, reset).
  if (!urlIndex || urlIndex.rows !== rows) urlIndex = { rows, urls: new Set(rows.map((r) => r.url)) };
  const seen = urlIndex.urls;
  const inserted: StoredArticle[] = [];
  const now = Date.now();
  for (const a of articles) {
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    const row: StoredArticle = { ...a, fetchedAt: now };
    rows.push(row);
    inserted.push(row);
  }
  cache = rows;
  if (inserted.length) {
    storeVersion++;
    // Nothing new, nothing to write: a sweep where most feeds had no new story used
    // to queue a full re-serialisation of the store per feed.
    save();
  }
  return inserted;
}

/**
 * The newest-first view of the store, and an id index, rebuilt once per store
 * version instead of on every call. Every list route used to copy and sort all
 * ~21k rows per request, and `findArticleById` was a linear scan — called once
 * per saved article on مقالاتي, which made that screen N × 21k.
 */
let sortedView: { version: number; rows: StoredArticle[]; byId: Map<string, StoredArticle> } | null = null;

function view(): { rows: StoredArticle[]; byId: Map<string, StoredArticle> } {
  const rows = load();
  if (!sortedView || sortedView.version !== storeVersion) {
    const sorted = rows.slice().sort((a, b) => b.publishedAt - a.publishedAt);
    const byId = new Map<string, StoredArticle>();
    // First row wins, the same answer `Array.find` gave over the stored order.
    for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
    sortedView = { version: storeVersion, rows: sorted, byId };
  }
  return sortedView;
}

/**
 * Every stored article, newest first. A fresh array each call (callers may sort or
 * splice it), but the sort itself is shared until the store changes.
 */
export function getAllArticles(): StoredArticle[] {
  return view().rows.slice();
}

/**
 * The shared newest-first array itself, for hot read-only scans that must not pay
 * for a copy. Callers must not mutate it.
 */
export function getAllArticlesReadonly(): readonly StoredArticle[] {
  return view().rows;
}

export function findArticleById(id: string): StoredArticle | null {
  return view().byId.get(id) ?? null;
}

export function getDistinctSources(): Array<{ id: string; name: string; country: string }> {
  const map = new Map<string, { id: string; name: string; country: string }>();
  for (const r of load()) {
    if (!map.has(r.sourceId)) {
      map.set(r.sourceId, { id: r.sourceId, name: r.sourceName, country: r.country });
    }
  }
  return [...map.values()];
}

/**
 * Drop rows published before `cutoffMs`, except the ids in `keep` (saved or
 * reacted articles, which a reader can still open). Returns how many went.
 *
 * Without a retention window the store only ever grew, and everything that reads
 * it — the save, the grouped feed's clusters, search, a match's news — grew with
 * it.
 */
export function pruneArticles(cutoffMs: number, keep: ReadonlySet<string>): number {
  const rows = load();
  const kept = rows.filter((r) => r.publishedAt >= cutoffMs || keep.has(r.id));
  const removed = rows.length - kept.length;
  if (removed > 0) {
    cache = kept;
    storeVersion++;
    save();
  }
  return removed;
}

