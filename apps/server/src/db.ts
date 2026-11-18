import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Article } from './types.js';
import { categorize, detectBreaking } from './categorize.js';
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
  const out = rows.map((r) => {
    let row = r;
    if (!row.category || row.category === 'general') {
      row = { ...row, category: categorize(row.title, row.summary) };
      changed = true;
    }
    const title = decodeHtmlEntities(row.title);
    const summary = row.summary === null ? null : decodeHtmlEntities(row.summary) || null;
    if (title !== row.title || summary !== row.summary) {
      row = { ...row, title, summary };
      changed = true;
    }
    const isBreaking = detectBreaking(row.title);
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
