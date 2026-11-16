import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FOLLOWS_FILE = path.resolve(__dirname, '../../data/follows.json');

export type FollowsMap = Record<string, string[]>;

let cache: FollowsMap | null = null;

function load(): FollowsMap {
  if (cache) return cache;
  let parsedMap: FollowsMap = {};
  try {
    const raw = fs.readFileSync(FOLLOWS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsedMap = parsed as FollowsMap;
    }
  } catch {
    parsedMap = {};
  }
  cache = parsedMap;
  return parsedMap;
}

function save(): void {
  fs.mkdirSync(path.dirname(FOLLOWS_FILE), { recursive: true });
  fs.writeFileSync(FOLLOWS_FILE, JSON.stringify(cache, null, 2));
}

export function getFollowedSources(userId: string): string[] {
  const map = load();
  return map[userId] ? [...map[userId]] : [];
}

export function followSource(userId: string, sourceId: string): string[] {
  const map = load();
  const current = new Set(map[userId] ?? []);
  current.add(sourceId);
  map[userId] = [...current];
  cache = map;
  save();
  return map[userId];
}

export function unfollowSource(userId: string, sourceId: string): string[] {
  const map = load();
  const current = new Set(map[userId] ?? []);
  current.delete(sourceId);
  map[userId] = [...current];
  cache = map;
  save();
  return map[userId];
}

/** Reset cache (for vitest test isolation) */
export function _resetFollowsCache(): void {
  cache = null;
}
