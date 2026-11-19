// Publish a fetched page of articles to the cross-screen reaction store.
//
// Separate from lib/api.ts on purpose: the node check scripts import that module
// directly (scripts/check-verification.mjs), so it must stay free of app-side
// imports. Screens call this right after a successful fetch.
//
// The floor is captured BEFORE the request so a page that was in flight while the
// user reacted cannot undo the write when it lands.

import { currentRevision, publishArticleList } from './reactionStore';
import type { Article, FeedRow } from './api';

/** Mark the start of a request whose response must not undo a later write. */
export function beginPageFetch(): number {
  return currentRevision();
}

export function publishPage(articles: Article[], floor: number): void {
  publishArticleList(articles, floor);
}

export function publishGroupedPage(rows: FeedRow[], floor: number): void {
  for (const row of rows) {
    // The cluster sheet lists members in the same card component, so they need
    // their counts too, not just the rows the deck shows.
    if (row.kind === 'article') publishArticleList([row.article], floor);
    else publishArticleList([row.lead, ...row.members], floor);
  }
}
