// Serving one article as blocks for the app's reader mode (#51).
//
// The app asks for this when the reader opens an article. The response is either a
// body to render natively, or a reason the app should fall back to the source page
// (which it opens in its WebView with ads blocked). Nothing is invented: on any
// failure the answer is "not readable", never a partly-made-up article.

import { fetchPage, isGoogleNewsUrl, resolveGoogleNewsUrl } from './articleText.js';
import { readerFromHtml, type ReaderArticle } from './reader.js';

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
  options: { title?: string | null; fetchImpl?: typeof fetch; now?: number } = {},
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
      const target = isGoogleNewsUrl(url) ? await resolveGoogleNewsUrl(url) : url;
      if (!target) return { title: null, blocks: [], readable: false, reason: 'unreachable' };
      const page = await fetchPage(target);
      if (!page.ok) {
        // 401/403/429 mean the publisher refused us, not that the page is empty: the
        // app must open it in the browser rather than claim the story is unreadable.
        return {
          title: null,
          blocks: [],
          readable: false,
          reason: page.status === 401 || page.status === 403 || page.status === 429 ? 'blocked' : 'unreachable',
        };
      }
      return readerFromHtml(page.text, options.title ?? null);
    } catch {
      return { title: null, blocks: [], readable: false, reason: 'unreachable' };
    }
  })();

  inFlight.set(key, job);
  try {
    const article = await job;
    cache.set(key, { at: Date.now(), article });
    return article;
  } finally {
    inFlight.delete(key);
  }
}
