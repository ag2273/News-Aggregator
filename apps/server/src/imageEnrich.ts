// Real pictures on feed cards (#57).
//
// MEASURED
// --------
// Most cards showed the outlet's logo even when the story's page has a photo. The
// image was only ever read from the RSS item (fetcher.ts `extractImage`), and the
// feeds that carry most of the corpus are Google News, whose items have no image at
// all. The picture lives on the publisher's page, as `og:image`.
//
// WHAT THIS DOES
// --------------
// After each feed refresh, in the background: take the newest imageless stories,
// resolve each Google link to the publisher (the same resolver and cache the reader
// uses, #54/#60), fetch that page with a short deadline, read `og:image` from its
// <head>, and store it on the row. The feed routes never wait for any of it — a card
// shows the logo until its picture is found, and the photo from then on.
//
// BOUNDS (the server is an e2-micro: 1 GB RAM, a quarter of a CPU sustained)
//   - at most PER_RUN stories per refresh, two pages in flight at a time;
//   - only stories from the last WINDOW_MS, newest first;
//   - a story that yielded nothing is not retried for RETRY_MS, and never more than
//     MAX_TRIES times; that memory is a bounded map;
//   - only the <head> of a page is searched, never the whole document.

import { resolveGoogleNewsUrl, fetchPageWithTimeout } from './articleText.js';
import { remember } from './boundedCache.js';
import type { StoredArticle } from './db.js';

const PER_RUN = Number(process.env['IMAGE_ENRICH_PER_RUN'] ?? 40);
const CONCURRENCY = 2;
const WINDOW_MS = 36 * 60 * 60 * 1000;
const RETRY_MS = 6 * 60 * 60 * 1000;
const MAX_TRIES = 2;
const PAGE_TIMEOUT_MS = 8000;
/** A `<head>` is a few KB; a page that has not closed it by here is not worth reading. */
const HEAD_LIMIT = 200_000;

/**
 * An outlet's default share image, not the story's.
 *
 * Several outlets put the same `og:image` (their logo or a branded card) on every
 * page that has no photo. Showing that would be the logo again, only bigger. The
 * same image URL on two different stories is treated as that default.
 */
const GENERIC_AFTER = 2;

/** `og:image` (or its fallbacks) from a page, absolute, or null. */
export function extractOgImage(html: string, pageUrl: string): string | null {
  const end = html.search(/<\/head>/i);
  const head = html.slice(0, end >= 0 ? end : HEAD_LIMIT);
  const candidates: string[] = [];
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    if (!['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image'].includes(key)) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) candidates.push(content);
  }
  const link = head.match(/<link\b[^>]*rel\s*=\s*["']image_src["'][^>]*>/i)?.[0];
  const href = link?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  if (href) candidates.push(href);

  for (const raw of candidates) {
    const decoded = raw.trim().replace(/&amp;/g, '&');
    let abs: string;
    try {
      abs = new URL(decoded, pageUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(abs)) continue;
    if (isNotAPhoto(abs)) continue;
    return abs;
  }
  return null;
}

/** Logos, icons, placeholders and Google's own artwork. */
export function isNotAPhoto(url: string): boolean {
  const u = url.toLowerCase();
  if (/\.(svg|ico|gif)(\?|$)/.test(u)) return true;
  if (/(^|[\/_.-])(logo|favicon|icon|sprite|placeholder|default|no-?image|blank|avatar)[^/]*\.(png|jpe?g|webp)(\?|$)/.test(u)) return true;
  if (/\/(logo|logos|icons?)\//.test(u)) return true;
  // The Google News shell's own image, served before the resolve succeeds.
  if (/(^https?:\/\/)?[^/]*(news\.google\.com|gstatic\.com|googleusercontent\.com)\//.test(u)) return true;
  return false;
}

export interface EnrichDeps {
  resolve: (url: string) => Promise<string | null>;
  fetchHtml: (url: string) => Promise<{ ok: boolean; text: string }>;
  save: (images: ReadonlyMap<string, string | null>) => number;
  now: () => number;
}

const defaultDeps: EnrichDeps = {
  resolve: (url) => resolveGoogleNewsUrl(url),
  fetchHtml: (url) => fetchPageWithTimeout(url, undefined, PAGE_TIMEOUT_MS),
  save: () => 0,
  now: () => Date.now(),
};

const attempts = new Map<string, { at: number; tries: number }>();
/**
 * image URL → the publisher pages that carried it and the stored rows that got it,
 * to spot an outlet's default image. Counted by publisher page, not by row: Google
 * often lists one story under two links, and that is one story, not a default.
 */
const seenImages = new Map<string, { pages: Set<string>; rows: Set<string> }>();
const generic = new Set<string>();

/** Test seam. */
export function _resetImageEnrich(): void {
  attempts.clear();
  seenImages.clear();
  generic.clear();
}

/** The stories worth a page fetch now, newest first. */
export function pickCandidates(rows: readonly StoredArticle[], now: number, limit = PER_RUN): StoredArticle[] {
  const out: StoredArticle[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    if (now - r.publishedAt > WINDOW_MS) continue;
    if (r.imageUrl) continue;
    const a = attempts.get(r.url);
    if (a && (a.tries >= MAX_TRIES || now - a.at < RETRY_MS)) continue;
    out.push(r);
  }
  return out;
}

/** Fetch one story's page and return its image, or null. Never throws. */
async function imageFor(row: StoredArticle, deps: EnrichDeps): Promise<{ page: string; img: string } | null> {
  try {
    const target = await deps.resolve(row.url);
    if (!target) return null;
    const page = await deps.fetchHtml(target);
    if (!page.ok || !page.text) return null;
    const img = extractOgImage(page.text.length > HEAD_LIMIT ? page.text.slice(0, HEAD_LIMIT) : page.text, target);
    return img ? { page: target, img } : null;
  } catch {
    return null;
  }
}

let running: Promise<number> | null = null;

/**
 * One bounded pass over the newest imageless stories. Single-flight: a call while a
 * pass is running joins it. Resolves to how many rows got a picture.
 *
 * `rows` must be newest first (the store's sorted view).
 */
export function enrichImages(rows: readonly StoredArticle[], deps: Partial<EnrichDeps> = {}): Promise<number> {
  if (running) return running;
  const d = { ...defaultDeps, ...deps };
  running = (async () => {
    const queue = pickCandidates(rows, d.now());
    if (!queue.length) return 0;
    const found = new Map<string, string | null>();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < queue.length) {
        const row = queue[next++]!;
        const prev = attempts.get(row.url);
        remember(attempts, row.url, { at: d.now(), tries: (prev?.tries ?? 0) + 1 }, 5000, (e) => d.now() - e.at > WINDOW_MS);
        const hit = await imageFor(row, d);
        if (!hit || generic.has(hit.img)) continue;
        const { img } = hit;
        let seen = seenImages.get(img);
        if (!seen) {
          seen = { pages: new Set(), rows: new Set() };
          remember(seenImages, img, seen, 3000, () => false);
        }
        seen.pages.add(hit.page);
        seen.rows.add(row.url);
        if (seen.pages.size >= GENERIC_AFTER) {
          // The outlet's default image: take it back off every story that got it.
          generic.add(img);
          for (const u of seen.rows) found.set(u, null);
          seenImages.delete(img);
          continue;
        }
        found.set(row.url, img);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    // A story that only "lost" a default image had none to begin with; writing null
    // over null is skipped by the store, and an earlier run's default is cleared.
    const changed = d.save(found);
    let got = 0;
    for (const v of found.values()) if (v) got++;
    console.log(`[images] ${queue.length} checked, ${got} picture(s) found, ${changed} row(s) updated`);
    return got;
  })().finally(() => {
    running = null;
  });
  return running;
}
