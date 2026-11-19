// One source of truth for reaction counts across screens.
//
// Why this exists: a card and the reader are different components showing the
// same article. Reacting in the reader updated only the reader's local state, so
// the card behind it kept the count it was rendered with, and two screens showing
// the same article could disagree.
//
// Invariant: this map holds the most recent SERVER answer for each article this
// session — from a feed page, the reader's fresh fetch, or a write. Nothing here
// is ever an optimistic guess.
//
// Staleness: a feed request can be in flight when a reaction is written, and its
// (older) page must not overwrite the newer write. Every publish bumps a global
// revision; a fetcher captures the revision before it starts and passes it as
// `ifNewerThan`, so a response older than a write is dropped.

import { useSyncExternalStore } from 'react';
import type { ReactionCounts, ReactionType } from './api';

export interface ReactionSnapshot {
  counts: ReactionCounts;
  myReaction: ReactionType | null;
}

type Listener = () => void;

const snapshots = new Map<string, { snapshot: ReactionSnapshot; rev: number }>();
const listeners = new Map<string, Set<Listener>>();
let revision = 0;

/** Current revision: capture before a request, pass to publish as a floor. */
export function currentRevision(): number {
  return revision;
}

/**
 * Publish the server's numbers for one article. The object is stored by
 * reference: useSyncExternalStore compares snapshots by identity, so rebuilding
 * the object on every read would loop forever.
 *
 * @param floor when given, drop this publish for an article that was already
 *              written after the request started — how an in-flight page cannot
 *              undo a reaction. It is per article, so one article's write never
 *              discards another article's fresh page data.
 */
export function publishReactions(
  articleId: string,
  snapshot: ReactionSnapshot,
  floor?: number,
): void {
  if (!articleId) return;
  const existing = snapshots.get(articleId);
  if (floor !== undefined && existing && existing.rev > floor) return;
  revision += 1;
  snapshots.set(articleId, { snapshot, rev: revision });
  const set = listeners.get(articleId);
  if (!set) return;
  for (const listener of set) listener();
}

/** Publish every article in a list response, so a refresh is seen everywhere. */
export function publishArticleList(
  articles: Array<{
    id: string;
    reactions?: ReactionCounts;
    myReaction?: ReactionType | null;
  }>,
  floor?: number,
): void {
  for (const a of articles) {
    if (!a.reactions) continue;
    publishReactions(a.id, { counts: a.reactions, myReaction: a.myReaction ?? null }, floor);
  }
}

/** Last published numbers for an article, or null when none were seen yet. */
export function getPublishedReactions(articleId: string): ReactionSnapshot | null {
  return snapshots.get(articleId)?.snapshot ?? null;
}

function subscribe(articleId: string, listener: Listener): () => void {
  let set = listeners.get(articleId);
  if (!set) {
    set = new Set();
    listeners.set(articleId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(articleId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(articleId);
  };
}

/**
 * Reactions for one article: the last published server numbers when this session
 * has seen any, otherwise the payload the caller already holds.
 */
export function useLiveReactions(
  articleId: string,
  fallbackCounts?: ReactionCounts,
  fallbackMine?: ReactionType | null,
): ReactionSnapshot {
  const live = useSyncExternalStore(
    (listener) => subscribe(articleId, listener),
    () => getPublishedReactions(articleId),
    () => null,
  );

  if (live) return live;
  return {
    counts:
      fallbackCounts ?? { like: 0, love: 0, wow: 0, sad: 0, angry: 0, total: 0 },
    myReaction: fallbackMine ?? null,
  };
}

/** Test helper: forget everything (a real session never needs this). */
export function _resetReactionStore(): void {
  snapshots.clear();
  listeners.clear();
  revision = 0;
}
