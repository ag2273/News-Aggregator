// Feed balancing.
//
// The store is newest-first across all articles, so one high-volume source
// (المصري اليوم, ~670 articles/day versus ~30 for others) filled 33 of the first
// 50 slots and the feed showed 5 of 9 live sources. That is a distribution
// problem, not a fetch problem: the other sources had fresh articles that simply
// never reached page 1.
//
// Fix: interleave by rank within each source. Every article gets a rank = its
// position in its own source (0 = that source's newest). Ordering by
// (rank, publishedAt desc) puts every source's newest article first, then every
// source's second-newest, and so on. Page 1 therefore shows many sources,
// near-duplicates of one source cannot crowd out the rest, and — because the
// interleaved list is built once and then sliced — pagination has no duplicates
// and no skips.
//
// A source's dominance still shows through when the others run dry: it keeps
// contributing its rank-N article each round, so the page fills.

export const DEFAULT_MAX_PER_SOURCE = 6;

export interface SourceLike {
  sourceId: string;
}

/**
 * Reorder articles for fair display: round N holds every source's Nth-newest
 * article, newest-first inside the round.
 *
 * Input must already be newest-first (the store guarantees that). Output holds
 * every input article exactly once.
 */
export function interleaveBySource<T extends SourceLike>(ordered: T[]): T[] {
  const bySource = new Map<string, T[]>();
  const sourceOrder: string[] = [];

  for (const article of ordered) {
    let bucket = bySource.get(article.sourceId);
    if (!bucket) {
      bucket = [];
      bySource.set(article.sourceId, bucket);
      sourceOrder.push(article.sourceId);
    }
    bucket.push(article);
  }

  const deepest = Math.max(0, ...Array.from(bySource.values(), (b) => b.length));
  const out: T[] = [];
  for (let rank = 0; rank < deepest; rank++) {
    for (const id of sourceOrder) {
      const bucket = bySource.get(id)!;
      if (rank < bucket.length) out.push(bucket[rank] as T);
    }
  }
  return out;
}

/**
 * One page of the balanced feed.
 *
 * `maxPerSource` caps how many a single source may contribute to ONE page on top
 * of the interleave (a hard ceiling for pathological corpora); it is lifted when
 * honouring it would leave the page short of articles that exist, so no page is
 * ever emptier than it should be.
 */
export function balancedPage<T extends SourceLike>(
  ordered: T[],
  offset: number,
  limit: number,
  maxPerSource: number = DEFAULT_MAX_PER_SOURCE,
): T[] {
  if (limit <= 0) return [];
  const balanced = interleaveBySource(ordered);
  if (maxPerSource <= 0) return balanced.slice(offset, offset + limit);

  // Apply the ceiling over the balanced order, then page that.
  const capped: T[] = [];
  const overflow: T[] = [];
  const counts = new Map<string, number>();
  for (const article of balanced) {
    const used = counts.get(article.sourceId) ?? 0;
    if (used < maxPerSource) {
      counts.set(article.sourceId, used + 1);
      capped.push(article);
    } else {
      overflow.push(article);
    }
  }

  const final = capped.concat(overflow);
  return final.slice(offset, offset + limit);
}
