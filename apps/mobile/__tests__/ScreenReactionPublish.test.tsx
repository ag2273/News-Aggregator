/**
 * A screen that loads a card list must feed the reaction store.
 *
 * This is the wiring check: the store itself has its own suite, and the capsule
 * has its own. What could still regress silently is a screen that fetches and
 * forgets to publish — then its cards would never pick up a count from the
 * reader. So the real lib/api runs here against a stubbed global fetch.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'youm7' }),
}));

jest.mock('../components/ArticleSheet', () => ({
  useArticleSheet: () => ({ open: jest.fn(), close: jest.fn(), isOpen: false }),
}));

jest.mock('../lib/auth', () => ({
  useAuth: () => ({
    token: 'session',
    user: { id: 'u1', email: 'r@example.com', emailVerified: true },
    emailVerified: true,
    loading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

import { getPublishedReactions, _resetReactionStore } from '../lib/reactionStore';
import { publishPage } from '../lib/reactionPublish';
import { palette } from '../constants/colors';

const LAVROV = 'b155d2c4ffae3c65';
const apiArticle = {
  id: LAVROV,
  title: 'لافروف: حملة الغرب لإلغاء الثقافة الروسية محكوم عليها بالفشل',
  summary: null,
  imageUrl: null,
  url: 'https://example.com/a',
  sourceId: 'rt-arabic',
  sourceName: 'آر تي عربي',
  category: 'misc',
  country: 'RU',
  publishedAt: Date.now() - 3600_000,
  isBreaking: false,
  reactions: { like: 3, love: 0, wow: 0, sad: 0, angry: 0, total: 3 },
  myReaction: 'like',
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetReactionStore();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: [apiArticle], total: 1 }),
  }) as unknown as typeof fetch;
});

describe('trending publishes the counts it fetched', () => {
  it('the capsule shows 👍 3 and the store holds it', async () => {
    const TrendingScreen = require('../app/trending').default;
    render(<TrendingScreen />);

    // The card renders the count that came off the wire…
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy());
    expect(screen.getByLabelText('تفاعلات القراء، 3')).toBeTruthy();

    // …and the store now knows it, so any other screen shows the same number.
    expect(getPublishedReactions(LAVROV)?.counts.total).toBe(3);
    expect(getPublishedReactions(LAVROV)?.myReaction).toBe('like');

    // The caller's token went with the request, which is what makes myReaction
    // non-null: the endpoint is public, but the selected ring needs the session.
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(call?.[1]?.headers?.Authorization).toBe('Bearer session');
  });
});

describe('a page published after a write does not wipe it', () => {
  it('keeps the newer count', async () => {
    // The screen's page was requested first (floor captured), the reaction lands
    // while it is in flight, then the old page arrives.
    const floor = require('../lib/reactionStore').currentRevision();
    const { publishReactions } = require('../lib/reactionStore');
    publishReactions(LAVROV, {
      counts: { like: 4, love: 0, wow: 0, sad: 0, angry: 0, total: 4 },
      myReaction: 'like',
    });
    publishPage([apiArticle as never], floor);

    expect(getPublishedReactions(LAVROV)?.counts.total).toBe(4);
  });
});
