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
//   - at most PER_RUN stories per refresh, three pages in flight at a time;
//   - only stories from the last WINDOW_MS, newest first;
//   - a story that yielded nothing is not retried for RETRY_MS, and never more than
//     MAX_TRIES times; that memory is a bounded map;
//   - only the <head> of a page is searched, never the whole document.

import { resolveGoogleNewsUrl, fetchPageWithTimeout, isChallengePage } from './articleText.js';
import { remember } from './boundedCache.js';
import type { StoredArticle } from './db.js';

// Measured after the first deploy: 40 a run was below the inflow. 23 of the 29
// feeds are Google News, the polls bring in well over 100 imageless stories an hour,
// and 40 every 10 minutes left most of them waiting until they fell out of the
// window. The work per story is network wait plus one regex over a <head>, so the
// cap goes up and one more page is allowed in flight; CPU stays negligible.
const PER_RUN = Number(process.env['IMAGE_ENRICH_PER_RUN'] ?? 120);
const CONCURRENCY = 3;
const WINDOW_MS = 48 * 60 * 60 * 1000;
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
 * same image URL on several different publisher pages is treated as that default.
 */
// Four, not two: an outlet often runs several stories on one event with the same
// photo (a match, a minister's portrait), and two was enough to strip a real picture
// off all of them. A default share image reaches four pages within one pass.
const GENERIC_AFTER = 4;

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

type Outcome = 'found' | 'unresolved' | 'fetch-failed' | 'blocked' | 'no-image' | 'default-image';

/** Fetch one story's page and return its image, or why there is none. Never throws. */
async function imageFor(
  row: StoredArticle,
  deps: EnrichDeps,
): Promise<{ page: string; img: string } | { miss: Exclude<Outcome, 'found' | 'default-image'> }> {
  try {
    const target = await deps.resolve(row.url);
    if (!target || /^https?:\/\/news\.google\.com\//i.test(target)) return { miss: 'unresolved' };
    const page = await deps.fetchHtml(target);
    if (!page.ok || !page.text) return { miss: 'fetch-failed' };
    const head = page.text.length > HEAD_LIMIT ? page.text.slice(0, HEAD_LIMIT) : page.text;
    if (isChallengePage(page.text)) return { miss: 'blocked' };
    const img = extractOgImage(head, target);
    return img ? { page: target, img } : { miss: 'no-image' };
  } catch {
    return { miss: 'fetch-failed' };
  }
}

/**
 * Accept `img` for the stored row `rowUrl` (read from `page`), writing the result
 * into `found`. Returns false when it is an outlet's default image instead.
 */
function accept(found: Map<string, string | null>, rowUrl: string, page: string, img: string): boolean {
  if (generic.has(img)) return false;
  let seen = seenImages.get(img);
  if (!seen) {
    seen = { pages: new Set(), rows: new Set() };
    remember(seenImages, img, seen, 3000, () => false);
  }
  seen.pages.add(page);
  seen.rows.add(rowUrl);
  if (seen.pages.size >= GENERIC_AFTER) {
    // The outlet's default image: take it back off every story that got it.
    generic.add(img);
    for (const u of seen.rows) found.set(u, null);
    seenImages.delete(img);
    return false;
  }
  found.set(rowUrl, img);
  return true;
}

let saver: (images: ReadonlyMap<string, string | null>) => number = () => 0;

/** Where pictures found outside a pass (the reader) are stored. Set once at boot. */
export function setImageSaver(save: (images: ReadonlyMap<string, string | null>) => number): void {
  saver = save;
}

/**
 * A publisher page someone opened in the reader (#57 follow-up). The reader has
 * just fetched it anyway, so its picture costs one regex over the <head>, and the
 * card gets it even when the story is older than the pass's window or the pass has
 * not reached it yet. Never throws.
 */
export function noteImageFromPage(rowUrl: string, html: string, pageUrl: string): void {
  try {
    const img = extractOgImage(html.length > HEAD_LIMIT ? html.slice(0, HEAD_LIMIT) : html, pageUrl);
    if (!img) return;
    const found = new Map<string, string | null>();
    accept(found, rowUrl, pageUrl, img);
    if (found.size) saver(found);
  } catch {
    /* a picture is a nicety */
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
  const d = { ...defaultDeps, save: saver, ...deps };
  running = (async () => {
    const queue = pickCandidates(rows, d.now());
    if (!queue.length) return 0;
    const found = new Map<string, string | null>();
    // Why the rest had no picture, overall and per source, so the log says where
    // the gap is (the resolver, a publisher that refuses us, or pages with no
    // og:image) instead of only a total.
    const outcomes: Record<Outcome, number> = {
      found: 0, unresolved: 0, 'fetch-failed': 0, blocked: 0, 'no-image': 0, 'default-image': 0,
    };
    const missBySource = new Map<string, number>();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < queue.length) {
        const row = queue[next++]!;
        const prev = attempts.get(row.url);
        remember(attempts, row.url, { at: d.now(), tries: (prev?.tries ?? 0) + 1 }, 8000, (e) => d.now() - e.at > WINDOW_MS);
        const hit = await imageFor(row, d);
        let outcome: Outcome;
        if ('miss' in hit) outcome = hit.miss;
        else outcome = accept(found, row.url, hit.page, hit.img) ? 'found' : 'default-image';
        outcomes[outcome]++;
        if (outcome !== 'found') missBySource.set(row.sourceId, (missBySource.get(row.sourceId) ?? 0) + 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    // A story that only "lost" a default image had none to begin with; writing null
    // over null is skipped by the store, and an earlier run's default is cleared.
    const changed = d.save(found);
    let got = 0;
    for (const v of found.values()) if (v) got++;
    const reasons = (Object.keys(outcomes) as Outcome[])
      .filter((k) => k !== 'found' && outcomes[k])
      .map((k) => `${k} ${outcomes[k]}`)
      .join(', ');
    const worst = [...missBySource].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, n]) => `${s} ${n}`).join(', ');
    console.log(
      `[images] ${queue.length} checked, ${got} picture(s) found, ${changed} row(s) updated` +
        (reasons ? `; missed: ${reasons}` : '') +
        (worst ? `; most missed: ${worst}` : ''),
    );
    return got;
  })().finally(() => {
    running = null;
  });
  return running;
}
