import type { Article } from './api';

export const PRELOAD_RADIUS = 3;

export type PrefetchFn = (url: string) => Promise<boolean>;

/**
 * Returns a window of articles centered at currentIndex:
 * [currentIndex - radius ... currentIndex + radius] clamped to articles array bounds.
 */
export function getPreloadWindow(
  articles: Article[],
  currentIndex: number,
  radius: number = PRELOAD_RADIUS,
): Article[] {
  if (!articles.length || currentIndex < 0 || currentIndex >= articles.length) {
    return [];
  }
  const start = Math.max(0, currentIndex - radius);
  const end = Math.min(articles.length - 1, currentIndex + radius);
  return articles.slice(start, end + 1);
}

/**
 * Returns the neighbor articles around currentIndex (the window excluding currentIndex).
 * These are the cards ahead and behind that should be pre-rendered or warmed.
 */
export function getPreloadNeighbors(
  articles: Article[],
  currentIndex: number,
  radius: number = PRELOAD_RADIUS,
): Article[] {
  if (!articles.length || currentIndex < 0 || currentIndex >= articles.length) {
    return [];
  }
  const windowArticles = getPreloadWindow(articles, currentIndex, radius);
  const current = articles[currentIndex];
  return windowArticles.filter((a) => a.id !== current?.id);
}

/**
 * Returns unique, non-null cover image URLs for all articles in the preload window.
 */
export function getPreloadCoverUrls(
  articles: Article[],
  currentIndex: number,
  radius: number = PRELOAD_RADIUS,
): string[] {
  const windowArticles = getPreloadWindow(articles, currentIndex, radius);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const a of windowArticles) {
    if (a.imageUrl && !seen.has(a.imageUrl)) {
      seen.add(a.imageUrl);
      urls.push(a.imageUrl);
    }
  }
  return urls;
}

/** In-memory cache of already-prefetched URLs to avoid duplicate network fetches */
const prefetchedUrls = new Set<string>();

/**
 * Prefetches the cover images for the active window [index - radius ... index + radius].
 * Returns the list of newly prefetched URLs.
 */
export async function prefetchWindowCovers(
  articles: Article[],
  currentIndex: number,
  radius: number = PRELOAD_RADIUS,
  prefetcher?: PrefetchFn,
): Promise<string[]> {
  const urls = getPreloadCoverUrls(articles, currentIndex, radius);
  const toFetch = urls.filter((u) => !prefetchedUrls.has(u));
  if (!toFetch.length) return [];

  for (const url of toFetch) {
    prefetchedUrls.add(url);
  }

  if (prefetcher) {
    await Promise.allSettled(
      toFetch.map((url) =>
        prefetcher(url).catch(() => {
          prefetchedUrls.delete(url);
          return false;
        }),
      ),
    );
  }

  return toFetch;
}

/** Clear prefetch cache (for tests or feed refresh) */
export function _resetPrefetchCache(): void {
  prefetchedUrls.clear();
}
