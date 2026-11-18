// Trending score.
//
// Before this, "الأكثر تداولًا" was simply the newest articles from the last 48
// hours — not a ranking at all. Reactions now contribute, but deliberately
// lightly: the product's trending signal is recency, and a handful of reactions
// on an hour-old story must not bury a big story from ten minutes ago.
//
// Formula (all terms in "score points"):
//
//   score = recency + reaction
//   recency  = RECENCY_MAX * (1 - ageMs / WINDOW_MS)      -> 0..RECENCY_MAX
//   reaction = REACTION_MAX * ln(1 + reactions) / ln(1 + REACTION_SATURATION)
//
// with the reaction term clamped to REACTION_MAX. Recency therefore always
// outweighs reactions for articles of similar age, and the log curve means the
// 50th reaction adds far less than the 2nd — one organised burst cannot own the
// page. REACTION_SATURATION is the count at which a story is considered
// saturated; beyond it the term simply stays at its cap.

export const TRENDING_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RECENCY_MAX = 100;
export const REACTION_MAX = 25;
export const REACTION_SATURATION = 20;

export interface Scorable {
  publishedAt: number;
  id: string;
}

/** Reaction contribution alone; exposed for tests and for documenting the cap. */
export function reactionScore(reactions: number): number {
  if (reactions <= 0) return 0;
  const raw = (REACTION_MAX * Math.log(1 + reactions)) / Math.log(1 + REACTION_SATURATION);
  return Math.min(REACTION_MAX, raw);
}

/** Recency contribution alone: linear decay to zero at the window edge. */
export function recencyScore(publishedAt: number, now: number): number {
  const age = Math.max(0, now - publishedAt);
  if (age >= TRENDING_WINDOW_MS) return 0;
  return RECENCY_MAX * (1 - age / TRENDING_WINDOW_MS);
}

/** Full score for one article. */
export function trendingScore(
  article: Scorable,
  reactions: number,
  now: number = Date.now(),
): number {
  return recencyScore(article.publishedAt, now) + reactionScore(reactions);
}

/**
 * Rank articles for trending: score descending, newest first as the tie-break.
 * `reactionsOf` is a lookup so this stays pure and testable.
 */
export function rankTrending<T extends Scorable>(
  articles: T[],
  reactionsOf: (id: string) => number,
  now: number = Date.now(),
  windowMs: number = TRENDING_WINDOW_MS,
): T[] {
  return articles
    .filter((a) => now - a.publishedAt < windowMs)
    .map((a) => ({ article: a, score: trendingScore(a, reactionsOf(a.id), now) }))
    .sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      return y.article.publishedAt - x.article.publishedAt;
    })
    .map((entry) => entry.article);
}
