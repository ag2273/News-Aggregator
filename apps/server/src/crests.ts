// Team crests, cached on our server.
//
// The sources carry a logo next to every team link, and the user asked for them on
// every screen. Two constraints shape this file:
//
//   1. NEVER hotlink. The app asks us for `/api/football/logo/:teamId` and we serve
//      bytes we fetched and stored, so the app's images never call the source and a
//      source that blocks us cannot break a screen.
//   2. Be polite and bounded. One crest is ~8KB, and there are a few hundred teams
//      across our competitions, so the whole cache is a few megabytes on disk with a
//      cap, not an unbounded growth path.
//
// A crest that cannot be fetched resolves to `null` and the app draws its existing
// placeholder. That is an honest gap, not a broken image.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const LOGO_DIR = path.join(DATA_DIR, 'logos');

/** Hard cap on the on-disk cache. ~8KB each, so this is roughly 2,500 crests. */
const MAX_CACHED_FILES = 2500;

/** How many team ids we have already tried and failed, so we do not retry hot. */
const failed = new Set<string>();
/** In-flight fetches, so two screens asking at once make one request. */
const inFlight = new Map<string, Promise<Buffer | null>>();

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface LogoTarget {
  /** Our stable key for the team, e.g. `filgoal:93`. */
  key: string;
  /** Where the crest comes from, when the provider gave us one. */
  sourceUrl: string | null;
}

function safeName(key: string): string {
  return key.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

/** Content type from the bytes, so a wrong extension cannot mislead a client. */
function detectType(buf: Buffer): string | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

function evictIfNeeded(): void {
  try {
    const files = fs.readdirSync(LOGO_DIR);
    if (files.length <= MAX_CACHED_FILES) return;
    // Oldest first by mtime; a crest that has not been read in a long time is the
    // cheapest thing to drop.
    const stats = files
      .map((f) => ({ f, m: fs.statSync(path.join(LOGO_DIR, f)).mtimeMs }))
      .sort((a, b) => a.m - b.m);
    for (const { f } of stats.slice(0, files.length - MAX_CACHED_FILES)) {
      fs.rmSync(path.join(LOGO_DIR, f), { force: true });
    }
  } catch {
    /* cache trimming must never break a request */
  }
}

/**
 * Where a crest lives for a key, when the caller did not pass one.
 *
 * FilGoal's crests are a predictable URL from the team id; Yallakora's live under
 * `mediayk.gemini.media` with a path we only learn from the page, so those must be
 * registered from the markup (`registerLogoSource`).
 */
export function defaultLogoUrl(key: string): string | null {
  const m = key.match(/^filgoal:(\d+)$/);
  if (m) return `https://semedia.filgoal.com/Photos/Team/Medium/${m[1]}.png`;
  return null;
}

/** Crest keys whose source URL the page told us about. */
const known = new Map<string, string>();

/** Remember where a crest comes from, for keys the page told us about. */
export function registerLogoSource(key: string, url: string | null): void {
  if (!url) return;
  known.set(key, url);
}

/**
 * The crest bytes for a team, from disk when present, otherwise fetched once.
 *
 * Returns null when the provider has no crest for this team or the fetch failed —
 * the caller renders its placeholder.
 */
export async function getCrest(
  target: LogoTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const name = safeName(target.key);
  const file = path.join(LOGO_DIR, name);

  try {
    const buf = fs.readFileSync(file);
    const type = detectType(buf);
    if (type) {
      // Touch, so eviction keeps crests that are actually being read.
      const now = new Date();
      fs.utimesSync(file, now, now);
      return { buffer: buf, contentType: type };
    }
    fs.rmSync(file, { force: true });
  } catch {
    /* not cached yet */
  }

  const sourceUrl = target.sourceUrl ?? defaultLogoUrl(target.key) ?? known.get(target.key) ?? null;
  if (!sourceUrl) return null;
  if (failed.has(target.key)) return null;
  const existing = inFlight.get(target.key);
  if (existing) {
    const buf = await existing;
    return buf ? { buffer: buf, contentType: detectType(buf) ?? 'image/png' } : null;
  }

  const job = (async (): Promise<Buffer | null> => {
    try {
      const res = await fetchImpl(sourceUrl, {
        headers: { 'User-Agent': UA, Accept: 'image/*' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      // A crest is small; anything huge is not a crest, so do not store it.
      if (buf.length === 0 || buf.length > 512 * 1024) return null;
      if (!detectType(buf)) return null;
      fs.mkdirSync(LOGO_DIR, { recursive: true });
      fs.writeFileSync(file, buf);
      evictIfNeeded();
      return buf;
    } catch {
      return null;
    } finally {
      inFlight.delete(target.key);
    }
  })();
  inFlight.set(target.key, job);

  const buf = await job;
  if (!buf) {
    failed.add(target.key);
    // A crest published later should still be picked up; forget the failure after a
    // while rather than caching "no logo" for the life of the process.
    setTimeout(() => failed.delete(target.key), 30 * 60 * 1000).unref?.();
    return null;
  }
  return { buffer: buf, contentType: detectType(buf) ?? 'image/png' };
}

/** How much the crest cache occupies, for the health/stats view. */
export function crestCacheStats(): { files: number; bytes: number } {
  try {
    const files = fs.readdirSync(LOGO_DIR);
    let bytes = 0;
    for (const f of files) {
      try {
        bytes += fs.statSync(path.join(LOGO_DIR, f)).size;
      } catch {
        /* ignore */
      }
    }
    return { files: files.length, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

/** Test helper. */
export function _resetCrestCache(): void {
  failed.clear();
  inFlight.clear();
  known.clear();
}
