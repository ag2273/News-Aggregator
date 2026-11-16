import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVED_FILE = path.resolve(__dirname, '../../data/saved.json');

export type SavedMap = Record<string, string[]>;

let cache: SavedMap | null = null;

function load(): SavedMap {
  if (cache) return cache;
  let parsedMap: SavedMap = {};
  try {
    const raw = fs.readFileSync(SAVED_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsedMap = parsed as SavedMap;
    }
  } catch {
    parsedMap = {};
  }
  cache = parsedMap;
  return parsedMap;
}

function save(): void {
  fs.mkdirSync(path.dirname(SAVED_FILE), { recursive: true });
  fs.writeFileSync(SAVED_FILE, JSON.stringify(cache, null, 2));
}

export function getSavedArticleIds(userId: string): string[] {
  const map = load();
  return map[userId] ? [...map[userId]] : [];
}

export function isArticleSaved(userId: string, articleId: string): boolean {
  const map = load();
  const list = map[userId];
  if (!list) return false;
  return list.includes(articleId);
}

export function saveArticle(userId: string, articleId: string): string[] {
  const map = load();
  const current = map[userId] ? [...map[userId]] : [];
  if (!current.includes(articleId)) {
    // Newest saved first
    current.unshift(articleId);
  }
  map[userId] = current;
  cache = map;
  save();
  return map[userId];
}

export function unsaveArticle(userId: string, articleId: string): string[] {
  const map = load();
  const current = (map[userId] ?? []).filter((id) => id !== articleId);
  map[userId] = current;
  cache = map;
  save();
  return map[userId];
}

/** Reset cache (for vitest test isolation) */
export function _resetSavedCache(): void {
  cache = null;
}
