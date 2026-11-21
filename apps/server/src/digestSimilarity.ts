// Digest-level duplicate detection.
//
// Separate from `cluster.ts` on purpose: that one groups TITLES for the feed's
// «من N مصادر» card and is tuned for that (precision-first, 0.45 similarity).
// The digest has two advantages the feed does not:
//
//   1. it already holds the FULL ARTICLE TEXT of every candidate;
//   2. it only looks at ~30 stories, so it can afford a heavier comparison.
//
// Comparing bodies catches duplicates that headline clustering misses — the same
// event written up by two outlets with different headlines ("CNN: تعطل شبكة…
// مخصصة للأمن القومي" vs "مصادر لـCNN: تعطل شبكة اتصالات بالغة السرية تابعة
// لوكالة الأمن القومي") share almost no title n-grams but the same body facts.
//
// Method: normalise Arabic the same way search does, take character 5-grams of
// the LEAD of the text (the opening carries who/what/where), keep the most
// frequent `TOP_K` of them, and compare with weighted Jaccard (intersection over
// union of the top-k sets, weights = term frequency). Character n-grams survive
// Arabic morphology (والمصابون / مصابون) where word shingles do not.
//
// The threshold is measured, not guessed: see src/__tests__/digestSimilarity.test.ts
// and docs/adr/0008-digest-dedup.md.

import { normalizeForSearch } from './text.js';

/** Character n-gram width. 5 balances Arabic morphology and specificity. */
export const SHINGLE_SIZE = 5;

/** How many of the most frequent n-grams to keep. Bounds the comparison. */
export const TOP_K = 600;

/** How much of the body to read. The lead carries the event; the rest is colour. */
export const LEAD_CHARS = 2000;

/**
 * Similarity at or above which two candidates are the same story.
 *
 * Measured on 180 production bodies (see docs/adr/0008-digest-dedup.md): the
 * highest scoring NON-duplicate pair reached 0.183, and the lowest scoring true
 * duplicate 0.328, so 0.30 sits in the gap between them rather than on a shoulder.
 * At 0.30 the pool yields 3 groups and every one is a genuine same-event pair.
 */
export const SIMILARITY_THRESHOLD = 0.3;

/**
 * Two bodies below this many characters are not compared on content.
 *
 * 60 normalised characters is roughly one sentence. Below that a body is a
 * one-line brief (or a snippet) with no lead to speak of, and character n-grams
 * over it collide with everything. Measured briefs in the corpus run 100+
 * characters, so this excludes only fragments.
 */
export const MIN_COMPARABLE_CHARS = 60;

export interface TextProfile {
  /** Sorted n-grams with frequency, as a map for weighted Jaccard. */
  grams: Map<string, number>;
  /** Normalised lead text, kept for debugging a merge decision. */
  lead: string;
  comparable: boolean;
}

/** The lead of an article, normalised and stripped to letters and digits. */
export function leadOf(text: string): string {
  return normalizeForSearch(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LEAD_CHARS);
}

/** Character n-grams with their counts, capped at the TOP_K most frequent. */
export function gramProfile(lead: string, size: number = SHINGLE_SIZE, topK: number = TOP_K): Map<string, number> {
  const counts = new Map<string, number>();
  const compact = lead.replace(/\s+/g, ' ');
  for (let i = 0; i + size <= compact.length; i += 1) {
    const gram = compact.slice(i, i + size);
    if (gram.trim().length < size) continue; // n-grams spanning a skipped space
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  if (counts.size <= topK) return counts;
  // Keep the most frequent: rare grams are typos and page furniture.
  return new Map(
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topK),
  );
}

export function profileOf(text: string): TextProfile {
  const lead = leadOf(text);
  return {
    grams: gramProfile(lead),
    lead,
    comparable: lead.length >= MIN_COMPARABLE_CHARS,
  };
}

/** Weighted Jaccard: sum of min counts over sum of max counts. */
export function similarity(a: Map<string, number>, b: Map<string, number>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  let union = 0;
  for (const [gram, count] of a) {
    const other = b.get(gram);
    intersection += other === undefined ? 0 : Math.min(count, other);
    union += Math.max(count, other ?? 0);
  }
  for (const [gram, count] of b) if (!a.has(gram)) union += count;
  return union === 0 ? 0 : intersection / union;
}

export interface StoryCandidate {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  publishedAt: number;
  text: string;
  textSource: 'full' | 'snippet';
}

export interface StoryGroupOf<T extends StoryCandidate> {
  /** The member shown in the digest: newest, so the freshest wording wins. */
  lead: T;
  members: T[];
  /** Distinct outlets — the repetition signal that reaches the prompt. */
  sourceCount: number;
  otherSources: string[];
  /** Why the members were merged, for the log and the tests. */
  via: 'text' | 'single';
  /** Highest pairwise similarity inside the group, when merged. */
  similarity?: number;
}

/**
 * Group candidates that are the same story, comparing article BODIES.
 *
 * A group is seeded by the newest unmerged candidate; every remaining candidate
 * joins the first group whose lead it matches. Anchoring on the lead (the newest
 * member) stops long chains of near-duplicates welding two stories together —
 * the same reason the feed's clusterer does it.
 *
 * Snippet-only candidates are compared on their snippet and flagged in `via`,
 * so a merge made without full text is never silently presented as one.
 */
export function groupByText<T extends StoryCandidate>(
  candidates: T[],
  options: { threshold?: number; profiles?: Map<string, TextProfile> } = {},
): StoryGroupOf<T>[] {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const profiles = options.profiles ?? new Map<string, TextProfile>();
  for (const c of candidates) {
    if (!profiles.has(c.id)) profiles.set(c.id, profileOf(c.text || c.title));
  }

  const groups: Array<{ lead: T; members: T[]; best: number }> = [];
  for (const candidate of candidates) {
    const profile = profiles.get(candidate.id) as TextProfile;
    let placed = false;
    for (const group of groups) {
      // Never merge two reports from one outlet: that is a republish or a
      // follow-up, not independent coverage, and the count would be a lie.
      if (group.members.some((m) => m.sourceId === candidate.sourceId)) continue;
      if (!profile.comparable) continue;
      const leadProfile = profiles.get(group.lead.id) as TextProfile;
      if (!leadProfile.comparable) continue;
      const score = similarity(leadProfile.grams, profile.grams);
      if (score >= threshold) {
        group.members.push(candidate);
        group.best = Math.max(group.best, score);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ lead: candidate, members: [candidate], best: 0 });
  }

  return groups.map((g) => ({
    lead: g.lead,
    members: g.members,
    sourceCount: new Set(g.members.map((m) => m.sourceId)).size,
    otherSources: g.members
      .filter((m) => m.sourceId !== g.lead.sourceId)
      .map((m) => m.sourceName)
      .filter((name, i, all) => all.indexOf(name) === i),
    via: g.members.length > 1 ? 'text' : 'single',
    similarity: g.members.length > 1 ? Math.round(g.best * 1000) / 1000 : undefined,
  }));
}
