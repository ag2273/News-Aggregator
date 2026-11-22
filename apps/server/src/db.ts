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

/** Reset cache (for test suites) */
export function _resetDbCache(): void {
  cache = null;
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
  if (changed) {
    cache = rows;
    save();
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(cache));
}

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
  const seen = new Set(rows.map((r) => r.url));
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
  save();
  return inserted;
}

export function getAllArticles(): StoredArticle[] {
  return load()
    .slice()
    .sort((a, b) => b.publishedAt - a.publishedAt);
}

export function findArticleById(id: string): StoredArticle | null {
  return load().find((r) => r.id === id) ?? null;
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
