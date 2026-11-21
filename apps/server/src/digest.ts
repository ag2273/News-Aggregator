// Building one digest.
//
// The pipeline is deliberately boring and cost-bounded:
//   1. pick candidates from what was ingested since the previous digest
//   2. fetch each candidate's full text (articleText.ts)
//   3. one model call per candidate (digestAi.ts)
//   4. keep the important ones, store the slot
//
// Failure policy: if the model is down or nothing usable comes back, the previous
// digest stays and the failure is logged. The app must never show a blank screen.

import type { Article } from './types.js';
import { clusterArticles } from './cluster.js';
import { fetchArticleText, type TextSource } from './articleText.js';
import { analyzeCandidates, MAX_CANDIDATES, type AiCallResult, type StoryVerdict } from './digestAi.js';
import {
  saveDigest,
  slotKeyFor,
  type DigestItem,
  type DigestSlot,
  type StoredDigest,
} from './digestStore.js';

/** Candidates are taken from this window when the previous digest is unknown. */
export const DEFAULT_WINDOW_MS = 12 * 60 * 60 * 1000;

/** How many from one outlet, so one prolific source cannot fill the digest. */
export const MAX_PER_SOURCE = 4;

/**
 * A story and the other outlets covering it.
 *
 * Several outlets publishing the same event is an importance signal — independent
 * desks all judged it worth running — so the count travels with the candidate into
 * the prompt, and the duplicate articles are dropped instead of being summarised
 * three times and shown three times.
 */
export interface StoryGroup {
  /** The article that represents the story: the newest member. */
  lead: Article;
  /** Every article covering it, lead included. */
  members: Article[];
  /** Distinct outlets, which is the signal. */
  sourceCount: number;
  /** Outlets other than the lead's, for the prompt. */
  otherSources: string[];
}

/**
 * Group candidates by story using the same conservative clustering the feed uses
 * for its «من N مصادر» card, so the digest and the feed agree on what "one story"
 * means. Order follows the leads' recency.
 */
export function groupByStory(articles: Article[]): StoryGroup[] {
  if (articles.length < 2) {
    return articles.map((a) => ({ lead: a, members: [a], sourceCount: 1, otherSources: [] }));
  }
  const byId = new Map(articles.map((a) => [a.id, a]));
  const clusters = clusterArticles(articles);
  const groups: StoryGroup[] = [];
  for (const cluster of clusters) {
    const members = cluster.members.map((m) => byId.get(m.id) ?? m);
    const outlets = [...new Set(members.map((m) => m.sourceId))];
    const lead = members.reduce((newest, m) => (m.publishedAt > newest.publishedAt ? m : newest), members[0] as Article);
    groups.push({
      lead,
      members,
      sourceCount: outlets.length,
      otherSources: members
        .filter((m) => m.sourceId !== lead.sourceId)
        .map((m) => m.sourceName)
        .filter((name, i, all) => all.indexOf(name) === i),
    });
  }
  return groups.sort((a, b) => b.lead.publishedAt - a.lead.publishedAt);
}

export interface BuildOptions {
  slot: DigestSlot;
  now?: number;
  articles: Article[];
  /** When the previous digest was built, so candidates are "since then". */
  since?: number;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  /** Text fetcher seam for tests. */
  fetchText?: typeof fetchArticleText;
}

export interface BuildResult {
  /** null when nothing could be built (the caller keeps the previous digest). */
  digest: StoredDigest | null;
  /** Why it failed, for the log line. */
  error?: string;
  considered: number;
  analysed: number;
}

/**
 * Pick candidates: newest first, capped per source and in total.
 *
 * Ranking is recency plus the existing breaking flag — the same signal the app
 * already trusts — because a digest that skips a major incident is a worse bug
 * than one that includes a dull story.
 */
export function selectCandidates(
  articles: Article[],
  options: { since?: number; now?: number; limit?: number; perSource?: number } = {},
): Article[] {
  const now = options.now ?? Date.now();
  const since = options.since ?? now - DEFAULT_WINDOW_MS;
  const limit = options.limit ?? MAX_CANDIDATES;
  const perSource = options.perSource ?? MAX_PER_SOURCE;

  const inWindow = articles
    .filter((a) => a.publishedAt >= since && a.publishedAt <= now)
    // Breaking first, then newest.
    .sort((a, b) => Number(b.isBreaking) - Number(a.isBreaking) || b.publishedAt - a.publishedAt);

  const perSourceCount = new Map<string, number>();
  const chosen: Article[] = [];
  for (const article of inWindow) {
    const used = perSourceCount.get(article.sourceId) ?? 0;
    if (used >= perSource) continue;
    perSourceCount.set(article.sourceId, used + 1);
    chosen.push(article);
    if (chosen.length >= limit) break;
  }
  // Restore pure recency order for the digest itself.
  return chosen.sort((a, b) => b.publishedAt - a.publishedAt);
}

/** Build the stored item from a story plus the model's verdict. */
export function toDigestItem(
  article: Article,
  verdict: StoryVerdict,
  textSource: TextSource,
): DigestItem {
  return {
    articleId: article.id,
    title: article.title,
    url: article.url,
    sourceName: article.sourceName,
    sourceId: article.sourceId,
    category: verdict.category as DigestItem['category'],
    summary: verdict.summary,
    why: verdict.why,
    isBreaking: article.isBreaking,
    publishedAt: article.publishedAt,
    textSource,
  };
}

/**
 * Build a digest. Never throws: a failure returns `{digest: null, error}` and the
 * caller keeps serving the previous one.
 */
export async function buildDigest(options: BuildOptions): Promise<BuildResult> {
  const now = options.now ?? Date.now();
  const fetchText = options.fetchText ?? fetchArticleText;
  const candidates = selectCandidates(options.articles, {
    since: options.since,
    now,
  });

  if (!candidates.length) {
    return { digest: null, error: 'no candidates in the window', considered: 0, analysed: 0 };
  }

  // One candidate per STORY, not per article: the same event on three outlets is
  // one item that says so, and one model call instead of three.
  const groups = groupByStory(candidates);
  const stories0 = groups.map((g) => g.lead);

  // Fetch text for every candidate in parallel: each is one page, and the whole
  // run must finish well inside the hour between digests.
  const texts = await Promise.all(
    stories0.map((article) =>
      fetchText({ url: article.url, summary: article.summary }, options.fetchImpl).catch(() => ({
        text: article.summary ?? '',
        source: 'snippet' as TextSource,
        resolvedUrl: null,
        reason: 'fetch threw',
      })),
    ),
  );

  const failedSources: Record<string, number> = {};
  const stories = stories0.map((article, i) => {
    const text = texts[i];
    if (text.source !== 'full') {
      failedSources[article.sourceId] = (failedSources[article.sourceId] ?? 0) + 1;
    }
    const group = groups[i] as StoryGroup;
    return {
      article,
      textSource: text.source,
      title: article.title,
      sourceName: article.sourceName,
      text: text.text || article.summary || article.title,
      sourceCount: group.sourceCount,
      otherSources: group.otherSources,
    };
  });

  const results = await analyzeCandidates(
    stories.map((s) => ({
      title: s.title,
      sourceName: s.sourceName,
      text: s.text,
      // The repetition signal, passed explicitly into the judgement.
      coverage: { sources: s.sourceCount, others: s.otherSources },
    })),
    { apiKey: options.apiKey, fetchImpl: options.fetchImpl },
  );

  const items: DigestItem[] = [];
  let analysed = 0;
  for (let i = 0; i < stories.length; i += 1) {
    const verdict = results[i]?.result.verdict;
    if (!verdict) continue;
    analysed += 1;
    if (!verdict.important) continue;
    const item = toDigestItem(stories[i].article, verdict, stories[i].textSource);
    item.sourceCount = stories[i].sourceCount;
    items.push(item);
  }

  if (!items.length) {
    return {
      digest: null,
      error: analysed === 0 ? 'every model call failed' : 'no story judged important',
      considered: candidates.length,
      analysed,
    };
  }

  const digest: StoredDigest = {
    slot: slotKeyFor(now, options.slot),
    builtAt: now,
    considered: candidates.length,
    analysed,
    failedSources,
    model: process.env['DIGEST_AI_MODEL'] ?? 'z-ai/glm-5.3-flash',
    items: items.sort(
      (a, b) => Number(b.isBreaking) - Number(a.isBreaking) || b.publishedAt - a.publishedAt,
    ),
  };
  saveDigest(digest);
  return { digest, considered: candidates.length, analysed };
}

/** A one-line summary of a build for the server log (no user data). */
export function describeBuild(result: BuildResult, slot: DigestSlot): string {
  if (!result.digest) {
    return `[digest] ${slot} failed: ${result.error} (considered ${result.considered}, analysed ${result.analysed}); keeping the previous digest`;
  }
  const failed = Object.entries(result.digest.failedSources);
  const snippetNote = failed.length
    ? `; snippet-only for ${failed.map(([id, n]) => `${id}:${n}`).join(', ')}`
    : '';
  return `[digest] ${slot} built ${result.digest.items.length} items from ${result.considered} candidates (analysed ${result.analysed})${snippetNote}`;
}
