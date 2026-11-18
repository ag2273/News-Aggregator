/**
 * Sharing an article through the native Android share sheet.
 *
 * Message format (per the batch-2 spec):
 *   <title>\n<link>\nعبر تطبيق رئيس التحرير
 *
 * Link choice: the publisher's own URL when we have it; for Google News items we
 * share the Google News link. Resolution was investigated and rejected — the
 * Google link 302s to itself and the publisher URL only appears after fetching
 * ~600 KB of HTML, with no stable marker (the non-Google URLs in that page are
 * image CDNs). A share sheet that hangs for a megabyte of scraping is worse than
 * a working redirect, and the redirect still opens the story.
 */

import { Share } from 'react-native';
import type { Article } from './api';

export const SHARE_VIA = 'عبر تطبيق رئيس التحرير';

/** True when the stored link is a Google News redirect rather than the publisher. */
export function isAggregatorUrl(url: string): boolean {
  return /^https?:\/\/news\.google\.com\//i.test(url);
}

/**
 * The link to share. Prefers the publisher URL; falls back to the aggregator
 * redirect when that is all we have. Never invents a URL.
 */
export function shareLink(article: Pick<Article, 'url'>): string {
  return article.url;
}

/** The exact message body for the share sheet. */
export function shareMessage(article: Pick<Article, 'title' | 'url'>): string {
  return `${article.title}\n${shareLink(article)}\n${SHARE_VIA}`;
}

/**
 * Open the native share sheet. Resolves with the action taken, or false when the
 * sheet could not open — never throws, so a share failure cannot break a card.
 */
export async function shareArticle(article: Pick<Article, 'title' | 'url'>): Promise<boolean> {
  try {
    const result = await Share.share(
      { title: article.title, message: shareMessage(article) },
      { dialogTitle: 'مشاركة الخبر' },
    );
    return result.action === Share.sharedAction || result.action === Share.dismissedAction;
  } catch {
    return false;
  }
}
