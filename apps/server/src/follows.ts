import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir
  ? path.resolve(rawDataDir)
  : path.resolve(__dirname, '../../data');
const FOLLOWS_FILE = path.join(DATA_DIR, 'follows.json');

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
/** Delete every follow row for a user (account deletion). Returns rows removed. */
export function deleteFollowsForUser(userId: string): number {
  const map = load();
  const existing = map[userId];
  if (!existing) return 0;
  delete map[userId];
  cache = map;
  save();
  return existing.length;
}

export function _resetFollowsCache(): void {
  cache = null;
}
