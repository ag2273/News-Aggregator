import type { Article } from './api';

export const PRELOAD_RADIUS = 3;

export interface CoverDimensions {
  width: number;
  height: number;
}

export interface DeckAdjacentCards {
  nextArticle: Article | null;
  prevArticle: Article | null;
  farStrips: Article[];
}

/**
 * Returns the card models for deck rendering:
 * - nextArticle (index + 1): rendered as a full card behind front card
 * - prevArticle (index - 1): rendered as a full card behind front card
 * - farStrips (index + 2, index + 3): rendered as decorative pile hint strips
 */
export function getDeckAdjacentCards(
  articles: Article[],
  currentIndex: number,
): DeckAdjacentCards {
  if (!articles.length || currentIndex < 0 || currentIndex >= articles.length) {
    return { nextArticle: null, prevArticle: null, farStrips: [] };
  }
  const prevArticle = currentIndex > 0 ? articles[currentIndex - 1] ?? null : null;
  const nextArticle = currentIndex + 1 < articles.length ? articles[currentIndex + 1] ?? null : null;
  const farStrips: Article[] = [];
  if (currentIndex + 2 < articles.length && articles[currentIndex + 2]) {
    farStrips.push(articles[currentIndex + 2]);
  }
  if (currentIndex + 3 < articles.length && articles[currentIndex + 3]) {
    farStrips.push(articles[currentIndex + 3]);
  }
  return { nextArticle, prevArticle, farStrips };
}

/** In-memory set of image URLs that have completed native decoding/loading */
const loadedCoverUrls = new Set<string>();

export function markCoverLoaded(url: string | null | undefined): void {
  if (url) loadedCoverUrls.add(url);
}

export function isCoverLoaded(url: string | null | undefined): boolean {
  return Boolean(url && loadedCoverUrls.has(url));
}

export function markCoverError(url: string | null | undefined): void {
  if (url) loadedCoverUrls.delete(url);
}

export function _resetLoadedCovers(): void {
  loadedCoverUrls.clear();
}

/**
 * Determines whether the front card cover opacity should be reset to 0.
 * Returns false when the URL is already decoded/loaded (e.g. from adjacent card reveal),
 * preventing the post-swipe re-fade flicker.
 */
export function shouldResetCoverOpacity(
  incomingUrl: string | null | undefined,
  lastLoadedUrl: string | null | undefined,
): boolean {
  if (!incomingUrl) return true;
  if (isCoverLoaded(incomingUrl) || incomingUrl === lastLoadedUrl) {
    return false;
  }
  return true;
}

/** Fallback cover dimensions before native layout measurement */
export const DEFAULT_COVER_DIMENSIONS: CoverDimensions = {
  width: 320,
  height: 200,
};

/**
 * Returns display dimensions for off-screen neighbor cover pre-rendering.
 * Ensures native image pipeline decodes textures at real render size rather than 1x1.
 */
export function getOffscreenCoverStyle(
  dimensions?: CoverDimensions | null,
  fallbackWidth?: number,
): CoverDimensions {
  const width =
    dimensions && dimensions.width > 1
      ? Math.round(dimensions.width)
      : fallbackWidth && fallbackWidth > 64
        ? Math.round(fallbackWidth - 64)
        : DEFAULT_COVER_DIMENSIONS.width;

  const height =
    dimensions && dimensions.height > 1
      ? Math.round(dimensions.height)
      : DEFAULT_COVER_DIMENSIONS.height;

  return { width, height };
}

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
