// Reading an article survives a stalled server (#60).
//
// FROM THE USER'S REAL LOG
// ------------------------
// Three `reader` requests in one window all failed at exactly 20,010ms — the client
// deadline — one after another, which is what the reader felt as "the digest will not
// open". Two of the three were the same article reopened, so the retry cost another
// full 20s each time.
//
// WHAT THIS DOES
// --------------
//   * ONE retry, short and bounded, instead of the reader tapping again and waiting
//     another 20s. Not a loop: the point is to ride out a blip, not to hide a dead
//     server.
//   * A stored copy of the last readable body per article, so reopening an article he
//     just read is instant and works with no network at all.
//
// A stored body is only ever shown when it is the SAME article, and it is labelled as
// stored — never passed off as freshly extracted.

import type { ReaderArticle } from './api';
import { logEvent } from './perfLog';

/** How long the first attempt waits before the single retry starts. */
export const READER_RETRY_BASE_MS = 400;

/** The reader's own deadline, shorter than the generic API one: it is a screen. */
export const READER_ATTEMPT_DEADLINE_MS = 9000;

/**
 * Try the extractor twice at most.
 *
 * `attempt` is injected so a test can drive a one-shot failure without waiting.
 */
export async function fetchReaderWithRetry(
  articleId: string | null,
  url: string,
  deps: {
    fetchReader: (id: string | null, url: string) => Promise<ReaderArticle>;
    sleep?: (ms: number) => Promise<void>;
    attempts?: number;
  },
): Promise<ReaderArticle> {
  const { fetchReader, attempts = 2 } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown = null;
  const started = Date.now();
  for (let i = 0; i < attempts; i += 1) {
    try {
      const article = await fetchReader(articleId, url);
      logEvent('screen', 'reader-attempt', {
        attempt: i + 1,
        ok: true,
        readable: article?.readable ?? false,
        ms: Date.now() - started,
      });
      return article;
    } catch (err) {
      lastError = err;
      logEvent('screen', 'reader-attempt', {
        attempt: i + 1,
        ok: false,
        err: err instanceof Error ? err.name : 'unknown',
        ms: Date.now() - started,
      });
      if (i < attempts - 1) await sleep(READER_RETRY_BASE_MS);
    }
  }
  throw lastError ?? new Error('reader failed');
}

/** One stored article body. */
export interface StoredReader {
  article: ReaderArticle;
  storedAt: number;
  /** The article this body belongs to, so a copy can never be shown for another. */
  key: string;
}

/** How long a stored body may be reused. Bodies do not change after publication. */
export const STORED_READER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function readerKey(articleId: string | null, url: string): string {
  return articleId ? `id:${articleId}` : `url:${url}`;
}

/** Is a stored body usable for this article right now? */
export function storedReaderUsable(
  stored: StoredReader | null,
  key: string,
  now: number,
): boolean {
  if (!stored) return false;
  if (stored.key !== key) return false;
  if (!stored.article?.readable || !stored.article.blocks?.length) return false;
  if (now - stored.storedAt > STORED_READER_TTL_MS) return false;
  return true;
}

/** The line shown when a body came from storage rather than a fresh extraction. */
export const STORED_BODY_LABEL = 'نسخة محفوظة من الخبر';
