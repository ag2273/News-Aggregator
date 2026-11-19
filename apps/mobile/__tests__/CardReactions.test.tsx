/**
 * Card reactions, end to end in the app.
 *
 * Three reported failures, one cause each:
 *  1. the ＋ on a zero-reaction card opened the SIGN-IN sheet for a signed-in,
 *     verified user — the capsule decided "guest" from "has no counts" instead
 *     of from the live session;
 *  2. the swipe deck (home) rendered no capsule at all, so home showed nothing
 *     while the reader showed counts;
 *  3. a reaction made in the reader never reached the card behind it.
 *
 * The screens render the real components; only the network and auth boundary are
 * mocked, so a screen wired to the wrong gate cannot pass.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockFetchTrending = jest.fn();
const mockFetchSaved = jest.fn();
const mockFetchFollowing = jest.fn();
const mockFetchReactions = jest.fn();

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    putReaction: (...a: unknown[]) => mockPut(...a),
    deleteReaction: (...a: unknown[]) => mockDelete(...a),
    fetchTrending: (...a: unknown[]) => mockFetchTrending(...a),
    fetchSavedArticles: (...a: unknown[]) => mockFetchSaved(...a),
    fetchFollowingFeed: (...a: unknown[]) => mockFetchFollowing(...a),
    fetchReactions: (...a: unknown[]) => mockFetchReactions(...a),
    fetchIsArticleSaved: jest.fn().mockResolvedValue(false),
    saveArticle: jest.fn().mockResolvedValue(undefined),
    unsaveArticle: jest.fn().mockResolvedValue(undefined),
    isNetworkFailure: () => false,
  };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'youm7' }),
}));

jest.mock('../components/ArticleSheet', () => ({
  useArticleSheet: () => ({ open: jest.fn(), close: jest.fn(), isOpen: false }),
}));

let mockAuth: { token: string | null; user: any; emailVerified: boolean };
jest.mock('../lib/auth', () => ({
  useAuth: () => ({ ...mockAuth, loading: false }),
}));

// The deck needs a worklet runtime that jest does not have. A minimal stub is
// enough: the deck's behaviour (which cards exist, what they render) is plain
// React; only the animation values are native.
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const Animated = { View, createAnimatedComponent: (c: unknown) => c };
  return {
    __esModule: true,
    default: Animated,
    ...Animated,
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withSpring: (v: unknown) => v,
    withTiming: (v: unknown) => v,
    cancelAnimation: () => {},
    interpolate: () => 0,
    runOnJS: (fn: unknown) => fn,
    Extrapolation: { CLAMP: 'clamp' },
  };
});

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  const chain = () => {
    const g: any = {};
    for (const m of [
      'activeOffsetX',
      'shouldCancelWhenOutside',
      'onUpdate',
      'onEnd',
      'onStart',
      'onFinalize',
      'enabled',
      'activeOffsetY',
      'failOffsetY',
      'maxDuration',
    ]) {
      g[m] = () => g;
    }
    return g;
  };
  return {
    Gesture: { Pan: chain, Tap: chain, Race: chain },
    GestureDetector: ({ children }: any) => children,
    GestureHandlerRootView: View,
  };
});

import { FeedCard } from '../components/FeedCard';
import { HeroDeck } from '../components/HeroDeck';
import { ArticleReader } from '../components/ArticleReader';
import { palette } from '../constants/colors';
import { _resetReactionStore } from '../lib/reactionStore';
import type { Article } from '../lib/api';

const t = palette.dark;

const zeros = { like: 0, love: 0, wow: 0, sad: 0, angry: 0, total: 0 };
const lavrovCounts = { like: 3, love: 0, wow: 0, sad: 0, angry: 0, total: 3 };

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: 'b155d2c4ffae3c65',
    title: 'لافروف: حملة الغرب لإلغاء الثقافة الروسية محكوم عليها بالفشل',
    summary: 'ملخص',
    imageUrl: null,
    url: 'https://example.com/a',
    sourceId: 'rt-arabic',
    sourceName: 'آر تي عربي',
    category: 'misc',
    country: 'RU',
    publishedAt: Date.now() - 3600_000,
    isBreaking: false,
    ...overrides,
  } as Article;
}

const signedInVerified = {
  token: 'session',
  user: { id: 'u1', email: 'r@example.com', emailVerified: true },
  emailVerified: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetReactionStore();
  mockAuth = signedInVerified;
  mockPut.mockResolvedValue({ counts: { ...lavrovCounts }, myReaction: 'like' });
  mockDelete.mockResolvedValue({ counts: { ...zeros }, myReaction: null });
  mockFetchTrending.mockResolvedValue([]);
  mockFetchSaved.mockResolvedValue([]);
  mockFetchFollowing.mockResolvedValue([]);
  mockFetchReactions.mockResolvedValue({ counts: zeros, myReaction: null });
});

describe('the ＋ affordance on a card with no reactions', () => {
  it('opens the picker for a signed-in verified user, never the sign-in sheet', () => {
    render(
      <FeedCard
        article={article({ reactions: zeros })}
        t={t}
        onPress={jest.fn()}
      />,
    );

    // The capsule is the bare ＋ because there are no counts yet.
    fireEvent.press(screen.getByLabelText('أضف تفاعلًا'));

    // The picker is open: its five buttons are on screen.
    expect(screen.getByText('تفاعل مع الخبر')).toBeTruthy();
    expect(screen.getByLabelText('إعجاب')).toBeTruthy();
    // And the gate sheet is NOT.
    expect(screen.queryByText('سجّل دخولك عشان تتفاعل')).toBeNull();
  });

  it('sends the reaction from the picker', async () => {
    render(
      <FeedCard article={article({ reactions: zeros })} t={t} onPress={jest.fn()} />,
    );

    fireEvent.press(screen.getByLabelText('أضف تفاعلًا'));
    fireEvent.press(screen.getByLabelText('إعجاب'));

    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('b155d2c4ffae3c65', 'like', 'session'),
    );
  });

  it('still shows the sign-in sheet to a real guest', () => {
    mockAuth = { token: null, user: null, emailVerified: false };
    render(
      <FeedCard article={article({ reactions: zeros })} t={t} onPress={jest.fn()} />,
    );

    fireEvent.press(screen.getByLabelText('أضف تفاعلًا'));

    expect(screen.getByText('سجّل دخولك عشان تتفاعل')).toBeTruthy();
    expect(screen.queryByText('تفاعل مع الخبر')).toBeNull();
  });

  it('shows the verification sheet to a signed-in unverified account', () => {
    mockAuth = {
      token: 'session',
      user: { id: 'u1', email: 'r@example.com', emailVerified: false },
      emailVerified: false,
    };
    render(
      <FeedCard article={article({ reactions: zeros })} t={t} onPress={jest.fn()} />,
    );

    fireEvent.press(screen.getByLabelText('أضف تفاعلًا'));

    expect(screen.getByText('وثّق بريدك أولاً')).toBeTruthy();
    expect(screen.queryByText('تفاعل مع الخبر')).toBeNull();
  });
});

describe('the same gate on every screen that renders the card', () => {
  it('trending: a verified user opens the picker', async () => {
    mockFetchTrending.mockResolvedValue([article({ reactions: zeros })]);
    // Imported here so each screen's module-level mocks are already in place.
    const TrendingScreen = require('../app/trending').default;
    render(<TrendingScreen />);

    await waitFor(() => expect(screen.getByLabelText('أضف تفاعلًا')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('أضف تفاعلًا'));

    expect(screen.getByText('تفاعل مع الخبر')).toBeTruthy();
    expect(screen.queryByText('سجّل دخولك عشان تتفاعل')).toBeNull();
  });

  it('saved: a verified user opens the picker', async () => {
    mockFetchSaved.mockResolvedValue([article({ reactions: zeros })]);
    const SavedScreen = require('../app/saved').default;
    render(<SavedScreen />);

    await waitFor(() => expect(screen.getByLabelText('أضف تفاعلًا')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('أضف تفاعلًا'));

    expect(screen.getByText('تفاعل مع الخبر')).toBeTruthy();
    expect(screen.queryByText('سجّل دخولك عشان تتفاعل')).toBeNull();
  });

  it('following: a verified user opens the picker', async () => {
    mockFetchFollowing.mockResolvedValue([article({ reactions: zeros })]);
    const FollowingScreen = require('../app/following').default;
    render(<FollowingScreen />);

    await waitFor(() => expect(screen.getByLabelText('أضف تفاعلًا')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('أضف تفاعلًا'));

    expect(screen.getByText('تفاعل مع الخبر')).toBeTruthy();
    expect(screen.queryByText('سجّل دخولك عشان تتفاعل')).toBeNull();
  });
});

describe('the home deck renders counts', () => {
  it('shows the capsule with the live count on the front card', () => {
    const articles = [
      article({ id: 'a1', reactions: lavrovCounts }),
      article({ id: 'a2', reactions: zeros, title: 'خبر تانٍ' }),
    ];
    render(
      <HeroDeck
        articles={articles}
        index={0}
        onIndexChange={jest.fn()}
        t={t}
        onPress={jest.fn()}
      />,
    );

    // The deck used to render no capsule at all: this is the home-screen half of
    // the report. 3 likes must be visible on the card.
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByLabelText('تفاعلات القراء، 3')).toBeTruthy();
  });

  it('keeps the ≥3 rule: two reactions show emoji but no number', () => {
    const articles = [
      article({ id: 'a1', reactions: { ...zeros, like: 2, total: 2 } }),
      article({ id: 'a2', title: 'خبر تانٍ' }),
    ];
    render(
      <HeroDeck articles={articles} index={0} onIndexChange={jest.fn()} t={t} onPress={jest.fn()} />,
    );
    expect(screen.queryByText('2')).toBeNull();
  });

  it('opens the picker from the deck for a verified user', () => {
    const articles = [article({ id: 'a1', reactions: zeros }), article({ id: 'a2', title: 'تانٍ' })];
    render(
      <HeroDeck articles={articles} index={0} onIndexChange={jest.fn()} t={t} onPress={jest.fn()} />,
    );

    // Only the front card is reachable: neighbours render the same footer (so the
    // layout never shifts) but are hidden from accessibility and inert.
    const addButtons = screen.getAllByLabelText('أضف تفاعلًا', { includeHiddenElements: false });
    expect(addButtons).toHaveLength(1);

    fireEvent.press(addButtons[0]!);
    expect(screen.getByText('تفاعل مع الخبر')).toBeTruthy();
  });
});

describe('a reader reaction updates the card behind it', () => {
  it('the card shows the server count after reacting in the reader', async () => {
    const same = article({ id: 'b155d2c4ffae3c65', reactions: zeros });

    // The card and the reader are one tree, as they are on the device: the sheet
    // renders over the screen that still holds the card.
    mockPut.mockResolvedValue({ counts: lavrovCounts, myReaction: 'like' });
    render(
      <>
        <FeedCard article={same} t={t} onPress={jest.fn()} />
        <ArticleReader article={same} t={t} onClose={jest.fn()} onReadFull={jest.fn()} variant="sheet" />
      </>,
    );
    expect(screen.queryByLabelText('تفاعلات القراء، 3')).toBeNull();

    fireEvent.press(screen.getByLabelText('إعجاب'));
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('b155d2c4ffae3c65', 'like', 'session'));

    // Both surfaces now agree: the card picked up the published count.
    await waitFor(() => expect(screen.getByLabelText('تفاعلات القراء، 3')).toBeTruthy());
  });

  it('the reader publishes what its fresh fetch returned, so the card matches', async () => {
    const same = article({ id: 'b155d2c4ffae3c65', reactions: zeros });
    mockFetchReactions.mockResolvedValue({ counts: lavrovCounts, myReaction: null });

    render(
      <>
        <FeedCard article={same} t={t} onPress={jest.fn()} />
        <ArticleReader article={same} t={t} onClose={jest.fn()} onReadFull={jest.fn()} variant="sheet" />
      </>,
    );

    await waitFor(() => expect(screen.getByLabelText('تفاعلات القراء، 3')).toBeTruthy());
  });
});
