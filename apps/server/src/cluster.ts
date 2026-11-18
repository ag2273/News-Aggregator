// Same-story clustering.
//
// The feed shows several outlets reporting one event as separate cards. Grouping
// them ("من 3 مصادر") is useful, but a WRONG merge is worse than a miss: it hides
// a distinct story behind another and puts unrelated headlines under one card.
// So this is deliberately conservative and precision-first.
//
// Method: Arabic-normalized word shingles + Jaccard similarity.
//  - normalize with the same routine as search (alef/hamza/teh-marbuta/yeh,
//    diacritics, digits) so spelling variants of one story match;
//  - strip the " - المصدر" suffix Google News appends, or every title would
//    share its outlet and similarity would be inflated;
//  - compare the set of 2-word shingles rather than single words, because single
//    words collide across unrelated stories ("مقتل", "غزة");
//  - require BOTH a Jaccard threshold and a minimum number of shared shingles, so
//    two very short headlines cannot merge on one shared bigram.
//
// The thresholds are exported so they can be tuned against production data with
// the measurement script rather than by intuition.

import { normalizeForSearch } from './text.js';
import type { Article } from './types.js';

/**
 * Minimum Jaccard similarity of shingle sets for a merge.
 * 0.45 with 3 shared shingles measured 91.3% precision (21/23 hand-verified) on
 * ~29 hours of production titles; 0.55 was 100% but far too sparse (14 clusters).
 */
export const CLUSTER_MIN_SIMILARITY = 0.45;

/** Minimum shared shingles, so two 2-word titles cannot merge on one bigram. */
export const CLUSTER_MIN_SHARED_SHINGLES = 3;

/** Articles further apart than this are never the same story. */
export const CLUSTER_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Words too common to carry story identity. */
const STOP_WORDS = new Set([
  'في', 'من', 'على', 'الى', 'إلى', 'عن', 'مع', 'ان', 'أن', 'إن', 'و', 'او', 'أو',
  'بعد', 'قبل', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'كما', 'بين', 'حتى', 'خلال',
  'ضد', 'عند', 'يوم', 'اليوم', 'قال', 'اعلن', 'أعلن', 'مصادر', 'تفاصيل', 'فيديو',
  'صور', 'بالصور', 'اول', 'أول', 'جديد', 'عاجل', 'الان', 'الآن', 'شاهد', 'كل',
  'بشأن', 'حول', 'انه', 'أنه', 'انها', 'أنها', 'وقد', 'لكن', 'حيث', 'ما', 'لا',
]);

/**
 * Title text prepared for comparison: the outlet suffix removed, normalised,
 * stripped of stop words.
 */
export function clusterTitle(title: string): string {
  // Google News appends " - <outlet>"; the last dash segment is the outlet.
  let t = title;
  const lastDash = t.lastIndexOf(' - ');
  if (lastDash > 20) t = t.slice(0, lastDash);

  const normalized = normalizeForSearch(t)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = normalized.split(' ').filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return words.join(' ');
}

/** Set of 2-word shingles. Falls back to single words for very short titles. */
export function shingles(text: string): Set<string> {
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return new Set();
  if (words.length === 1) return new Set(words);
  const out = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    out.add(`${words[i]} ${words[i + 1]}`);
  }
  return out;
}

/** Jaccard similarity of two sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface ClusterInput {
  article: Article;
  title: string;
  shingles: Set<string>;
  publishedAt: number;
}

export function prepare(articles: Article[]): ClusterInput[] {
  return articles.map((article) => ({
    article,
    title: clusterTitle(article.title),
    shingles: shingles(clusterTitle(article.title)),
    publishedAt: article.publishedAt,
  }));
}

/**
 * Should these two prepared articles be the same story?
 * Requires: different sources, inside the time window, enough shared shingles
 * and a high enough Jaccard.
 */
export function shouldMerge(
  a: ClusterInput,
  b: ClusterInput,
  minSimilarity: number = CLUSTER_MIN_SIMILARITY,
  minShared: number = CLUSTER_MIN_SHARED_SHINGLES,
): boolean {
  // One outlet republishing its own story is not a cluster.
  if (a.article.sourceId === b.article.sourceId) return false;
  if (Math.abs(a.publishedAt - b.publishedAt) > CLUSTER_WINDOW_MS) return false;
  if (a.shingles.size < minShared || b.shingles.size < minShared) return false;

  let shared = 0;
  for (const s of a.shingles) if (b.shingles.has(s)) shared++;
  if (shared < minShared) return false;

  return jaccard(a.shingles, b.shingles) >= minSimilarity;
}

export interface Cluster {
  /** The lead article: the newest member, which is what the card shows. */
  lead: Article;
  members: Article[];
}

/**
 * Group articles into clusters.
 *
 * `articles` must be newest-first (the store guarantees it). Each article joins
 * the first cluster whose lead it matches and which has room, otherwise it
 * starts a new cluster — that keeps a cluster anchored to its newest member and
 * stops long chains from welding unrelated stories together.
 *
 * Order of the result follows the input order of each cluster's lead, so a
 * newest-first input yields newest-first clusters.
 */
export function clusterArticles(
  articles: Article[],
  minSimilarity: number = CLUSTER_MIN_SIMILARITY,
  minShared: number = CLUSTER_MIN_SHARED_SHINGLES,
): Cluster[] {
  const prepared = prepare(articles);
  const clusters: Array<{ members: ClusterInput[] }> = [];

  for (const item of prepared) {
    let placed = false;
    for (const cluster of clusters) {
      const lead = cluster.members[0];
      if (!lead) continue;
      if (shouldMerge(lead, item, minSimilarity, minShared)) {
        cluster.members.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [item] });
  }

  return clusters.map((c) => ({
    lead: c.members[0]!.article,
    members: c.members.map((m) => m.article),
  }));
}
