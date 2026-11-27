// Serving one article as blocks for the app's reader mode (#51).
//
// The app asks for this when the reader opens an article. The response is either a
// body to render natively, or a reason the app should fall back to the source page
// (which it opens in its WebView with ads blocked). Nothing is invented: on any
// failure the answer is "not readable", never a partly-made-up article.

import { remember } from './boundedCache.js';
import { fetchPage, isChallengePage, isGoogleNewsUrl, resolveGoogleNewsUrl } from './articleText.js';
import { type ReaderArticle, finishImages } from './reader.js';
import { readerFromHtmlOffThread } from './readerPool.js';
import { noteImageFromPage } from './imageEnrich.js';

/** How long a reader extract is reused. */
const READER_TTL_MS = 10 * 60 * 1000;

interface CachedReader {
  at: number;
  article: ReaderArticle;
}

const cache = new Map<string, CachedReader>();
/** One in-flight fetch per URL, so two readers do not make two publisher requests. */
const inFlight = new Map<string, Promise<ReaderArticle>>();

/** Test seam: forget everything cached. */
export function resetReaderCache(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * The article as blocks, or a truthful "not readable".
 *
 * Cached briefly because the same article is opened more than once (the reader
 * closes a sheet and reopens it), and a publisher should not be hit twice for the
 * same page. A failure is cached too: a page that refused us will refuse again in
 * the next ten minutes.
 */
export async function readerArticle(
  url: string,
  options: {
    title?: string | null;
    fetchImpl?: typeof fetch;
    now?: number;
    /** Test seam: how a Google-News link is resolved to the publisher's page. */
    resolve?: (u: string) => Promise<string | null>;
  } = {},
): Promise<ReaderArticle> {
  const key = url;
  const now = options.now ?? Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < READER_TTL_MS) return cached.article;
  const running = inFlight.get(key);
  if (running) return running;

  const job = (async (): Promise<ReaderArticle> => {
    try {
      // Google-News article URLs do not contain the publisher's URL; the existing
      // resolver is the supported way to recover it (see articleText.ts).
      const resolve = options.resolve ?? resolveGoogleNewsUrl;
      const target = isGoogleNewsUrl(url) ? await resolve(url) : url;
      if (!target) return { title: null, blocks: [], readable: false, reason: 'unreachable' };
      // A Google-News link that would not resolve must not be handed to the browser:
      // its shell page renders as an "invalid redirect" error (#54).
      if (isGoogleNewsUrl(target)) {
        return { title: null, blocks: [], readable: false, reason: 'unreachable', resolvedUrl: null };
      }
      let page: Awaited<ReturnType<typeof fetchPage>>;
      try {
        page = await fetchPage(target, options.fetchImpl);
      } catch {
        // The publisher could not be reached at all (measured: a TLS reset from this
        // host). The app still needs the publisher URL for its own browser fallback.
        return { title: null, blocks: [], readable: false, reason: 'unreachable', resolvedUrl: target };
      }
      if (!page.ok) {
        // 401/403/429 mean the publisher refused us, not that the page is empty: the
        // app must open it in the browser rather than claim the story is unreadable.
        return {
          title: null,
          blocks: [],
          readable: false,
          reason: page.status === 401 || page.status === 403 || page.status === 429 ? 'blocked' : 'unreachable',
          // Even when the extraction fails the app needs the PUBLISHER url: its
          // browser fallback would otherwise open the Google-News link and show
          // Google's invalid-redirect page instead of the story (#54).
          resolvedUrl: target,
        };
      }
      // A challenge page answers 200, so it is not caught by the status check above —
      // it would otherwise be reported as `thin` ("we read it, there was no body")
      // rather than what it is: the publisher refused this request (#61). Measured on
      // المصري اليوم over HTTP/1.1: 403 with "Just a moment…".
      if (isChallengePage(page.text)) {
        return { title: null, blocks: [], readable: false, reason: 'blocked', resolvedUrl: target };
      }
      // The page is in hand: give the story's card its picture too (#57).
      noteImageFromPage(url, page.text, target);
      const extracted = await readerFromHtmlOffThread(page.text, options.title ?? null);
      return { ...extracted, blocks: finishImages(extracted.blocks, target), resolvedUrl: target };
    } catch {
      return { title: null, blocks: [], readable: false, reason: 'unreachable' };
    }
  })();

  inFlight.set(key, job);
  try {
    const article = await job;
    remember(cache, key, { at: Date.now(), article }, 500, (e) => Date.now() - e.at >= READER_TTL_MS);
    return article;
  } finally {
    inFlight.delete(key);
  }
}
