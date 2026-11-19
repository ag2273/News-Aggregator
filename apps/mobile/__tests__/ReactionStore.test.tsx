/**
 * The cross-screen reaction store.
 *
 * Real behaviour under test, not a mock:
 *  - a write is visible to every card showing that article;
 *  - a feed page that was in flight when the write happened cannot undo it;
 *  - a page that arrives AFTER the write wins, because it is newer truth;
 *  - one article's write never discards another article's page data.
 */

import { renderHook, act } from '@testing-library/react-native';
import {
  publishReactions,
  publishArticleList,
  useLiveReactions,
  currentRevision,
  getPublishedReactions,
  _resetReactionStore,
} from '../lib/reactionStore';
import type { ReactionCounts } from '../lib/api';

const zeros: ReactionCounts = { like: 0, love: 0, wow: 0, sad: 0, angry: 0, total: 0 };
const three: ReactionCounts = { like: 3, love: 0, wow: 0, sad: 0, angry: 0, total: 3 };
const four: ReactionCounts = { like: 4, love: 0, wow: 0, sad: 0, angry: 0, total: 4 };

beforeEach(() => _resetReactionStore());

describe('reaction store', () => {
  it('falls back to the caller payload when nothing was published', () => {
    const { result } = renderHook(() => useLiveReactions('a1', three, 'like'));
    expect(result.current.counts.total).toBe(3);
    expect(result.current.myReaction).toBe('like');
  });

  it('publishes a write to every surface showing that article', () => {
    const first = renderHook(() => useLiveReactions('a1', zeros, null));
    const second = renderHook(() => useLiveReactions('a1', zeros, null));
    expect(first.result.current.counts.total).toBe(0);

    act(() => publishReactions('a1', { counts: three, myReaction: 'like' }));

    expect(first.result.current.counts.total).toBe(3);
    expect(second.result.current.counts.total).toBe(3);
    expect(second.result.current.myReaction).toBe('like');
  });

  it('does not leak between articles', () => {
    const a1 = renderHook(() => useLiveReactions('a1', zeros, null));
    const a2 = renderHook(() => useLiveReactions('a2', zeros, null));
    act(() => publishReactions('a1', { counts: three, myReaction: 'like' }));
    expect(a1.result.current.counts.total).toBe(3);
    expect(a2.result.current.counts.total).toBe(0);
  });

  it('a list response published with a floor drops an entry written after it started', () => {
    // The page request starts…
    const floor = currentRevision();
    // …the user reacts while it is in flight…
    publishReactions('a1', { counts: four, myReaction: 'like' });
    // …and the older page lands afterwards. It must not undo the write.
    publishArticleList([{ id: 'a1', reactions: three, myReaction: null }], floor);

    expect(getPublishedReactions('a1')?.counts.total).toBe(4);
    expect(getPublishedReactions('a1')?.myReaction).toBe('like');
  });

  it('a page that arrives after the write wins, because it is newer truth', () => {
    const floor = currentRevision();
    publishReactions('a1', { counts: four, myReaction: 'like' });
    // A refresh started after the write reports five.
    const laterFloor = currentRevision();
    publishArticleList([{ id: 'a1', reactions: { ...four, like: 5, total: 5 }, myReaction: 'like' }], laterFloor);
    expect(getPublishedReactions('a1')?.counts.total).toBe(5);
    expect(floor).toBeLessThan(laterFloor);
  });

  it("one article's write does not discard another article's page data", () => {
    const floor = currentRevision();
    publishReactions('a1', { counts: four, myReaction: 'like' });
    // The page carries a2 too; a2 has no newer write, so it must land.
    publishArticleList(
      [
        { id: 'a1', reactions: three, myReaction: null },
        { id: 'a2', reactions: three, myReaction: null },
      ],
      floor,
    );
    expect(getPublishedReactions('a1')?.counts.total).toBe(4);
    expect(getPublishedReactions('a2')?.counts.total).toBe(3);
  });

  it('ignores entries without counts', () => {
    publishArticleList([{ id: 'a1' }]);
    expect(getPublishedReactions('a1')).toBeNull();
  });
});
