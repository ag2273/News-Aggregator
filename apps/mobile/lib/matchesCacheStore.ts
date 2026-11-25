// Where the matches cache lives on the device (#59).
//
// A file, not the key/value stores the app already uses: `SecureStore` is for tokens
// and has a small per-value limit, while the day's payload is tens of kilobytes of
// JSON. `expo-file-system` is already part of Expo's SDK, so this adds no new native
// module beyond declaring it.
//
// Everything here is best-effort. A cache that cannot be written, read or parsed is
// simply NO cache: the page then behaves exactly as it did before, which is the
// correct failure for a speed feature. Nothing in this file may throw into the screen.

import { Directory, File, Paths } from 'expo-file-system';
import { cacheKey } from './matchesCache';
import type { CachedMatches } from './matchesCache';
import type { MatchesDay } from './api';

/** One directory, so the app's cached days are not loose in the cache root. */
const DIR = 'matches';

/**
 * The file for one day+identity.
 *
 * The token itself is never part of the name — only folded into a short hash — so
 * nothing in the cache directory says who is signed in.
 */
export function cacheFileName(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const safe = key.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `${safe}-${Math.abs(hash).toString(36)}.json`;
}

function fileFor(date: string, token: string | null | undefined): File {
  return new File(Paths.cache, DIR, cacheFileName(cacheKey(date, token)));
}

function dir(): Directory {
  return new Directory(Paths.cache, DIR);
}

export interface MatchesCacheStore {
  read(date: string, token?: string | null): Promise<CachedMatches | null>;
  write(date: string, token: string | null | undefined, day: MatchesDay): Promise<void>;
}

/** The real store. */
export const matchesCacheStore: MatchesCacheStore = {
  async read(date, token) {
    try {
      const file = fileFor(date, token);
      if (!file.exists) return null;
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;
      const candidate = parsed as Partial<CachedMatches>;
      // A payload that is not the shape this module wrote is not a cache. Guessing
      // would put invented scores on a screen, which is the one thing not allowed.
      if (
        typeof candidate.storedAt !== 'number' ||
        !candidate.day ||
        typeof candidate.day !== 'object' ||
        typeof candidate.day.date !== 'string' ||
        !Array.isArray(candidate.day.matches)
      ) {
        return null;
      }
      return { day: candidate.day as MatchesDay, storedAt: candidate.storedAt };
    } catch {
      return null;
    }
  },

  async write(date, token, day) {
    try {
      const folder = dir();
      if (!folder.exists) folder.create({ idempotent: true });
      const payload: CachedMatches = { day, storedAt: Date.now() };
      await fileFor(date, token).write(JSON.stringify(payload));
    } catch {
      // A full disk or a read-only cache dir must not break the screen.
    }
  },
};
