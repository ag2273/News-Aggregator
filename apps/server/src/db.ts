import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Article } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/news.json');

export interface StoredArticle extends Article {
  fetchedAt: number;
}

let cache: StoredArticle[] | null = null;

function load(): StoredArticle[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    cache = Array.isArray(parsed) ? (parsed as StoredArticle[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(cache));
}

export function insertArticles(articles: Article[]): number {
  const rows = load();
  const seen = new Set(rows.map((r) => r.url));
  let count = 0;
  const now = Date.now();
  for (const a of articles) {
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    rows.push({ ...a, fetchedAt: now });
    count++;
  }
  cache = rows;
  save();
  return count;
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
