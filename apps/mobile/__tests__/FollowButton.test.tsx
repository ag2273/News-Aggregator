/**
 * The follow button on the source screen.
 *
 * Behaviour under test (spec: "حالات زر المتابعة"):
 *  - shows متابعة when the source is not followed, إلغاء المتابعة when it is,
 *  - tapping toggles and calls the API with the right method,
 *  - while the account is unverified it opens the verification sheet and makes
 *    NO follow request (the gate added in e5a56bc),
 *  - the public article list renders in both states.
 *
 * Note: the spec text says "+ متابعة" / "مُتابَع ✓"; the shipped UI reads
 * "متابعة" / "إلغاء المتابعة". These tests pin what the app actually renders.
 * Changing the wording would be an app-behaviour change, which this task forbids.
 *
 * Only the network/auth boundary is mocked; the screen and its button are real.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

const mockFetchFollows = jest.fn();
const mockFollowSource = jest.fn();
const mockUnfollowSource = jest.fn();
const mockFetchSourceArticles = jest.fn();

jest.mock('../lib/api', () => ({
  fetchFollows: (...args: unknown[]) => mockFetchFollows(...args),
  followSource: (...args: unknown[]) => mockFollowSource(...args),
  unfollowSource: (...args: unknown[]) => mockUnfollowSource(...args),
  fetchSourceArticles: (...args: unknown[]) => mockFetchSourceArticles(...args),
  isEmailNotVerified: (e: any) => e?.status === 403,
  isNetworkFailure: () => false,
  relativeTime: () => 'قبل ساعتين',
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'youm7' }),
}));

let mockAuthState: { user: any; token: string | null; emailVerified: boolean };
jest.mock('../lib/auth', () => ({
  useAuth: () => ({
    ...mockAuthState,
    loading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

jest.mock('../components/ArticleSheet', () => ({
  useArticleSheet: () => ({ open: jest.fn() }),
}));

import SourceScreen from '../app/source/[id]';

const article = {
  id: 'a1',
  title: 'خبر من اليوم السابع',
  summary: null,
  imageUrl: null,
  url: 'https://example.com/a1',
  sourceId: 'youm7',
  sourceName: 'اليوم السابع',
  category: 'egypt',
  country: 'EG',
  publishedAt: Date.now() - 3600_000,
  isBreaking: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState = {
    user: { id: 'u1', email: 'reader@example.com', emailVerified: true },
    token: 'session-token',
    emailVerified: true,
  };
  mockFetchSourceArticles.mockResolvedValue({
    source: { id: 'youm7', name: 'اليوم السابع' },
    articles: [article],
  });
  mockFetchFollows.mockResolvedValue([]);
  mockFollowSource.mockResolvedValue(['youm7']);
  mockUnfollowSource.mockResolvedValue([]);
});

describe('source screen follow button', () => {
  it('shows متابعة when the source is not followed', async () => {
    render(<SourceScreen />);
    expect(await screen.findByText('متابعة')).toBeTruthy();
    expect(screen.queryByText('إلغاء المتابعة')).toBeNull();
  });

  it('shows إلغاء المتابعة when the source is already followed', async () => {
    mockFetchFollows.mockResolvedValue(['youm7']);
    render(<SourceScreen />);
    expect(await screen.findByText('إلغاء المتابعة')).toBeTruthy();
    expect(screen.queryByText('متابعة')).toBeNull();
  });

  it('toggles from متابعة to إلغاء المتابعة and calls follow', async () => {
    render(<SourceScreen />);
    const button = await screen.findByText('متابعة');

    fireEvent.press(button);

    await waitFor(() => expect(mockFollowSource).toHaveBeenCalledWith('youm7', 'session-token'));
    expect(await screen.findByText('إلغاء المتابعة')).toBeTruthy();
  });

  it('toggles back and calls unfollow', async () => {
    mockFetchFollows.mockResolvedValue(['youm7']);
    render(<SourceScreen />);
    const button = await screen.findByText('إلغاء المتابعة');

    fireEvent.press(button);

    await waitFor(() => expect(mockUnfollowSource).toHaveBeenCalledWith('youm7', 'session-token'));
    expect(await screen.findByText('متابعة')).toBeTruthy();
  });

  it('still renders the public article list', async () => {
    render(<SourceScreen />);
    expect(await screen.findByText('خبر من اليوم السابع')).toBeTruthy();
  });

  it('makes no follow request while unverified and opens the gate instead', async () => {
    mockAuthState = {
      user: { id: 'u1', email: 'reader@example.com', emailVerified: false },
      token: 'session-token',
      emailVerified: false,
    };
    render(<SourceScreen />);

    const button = await screen.findByText('متابعة');
    fireEvent.press(button);

    // The gate appears...
    expect(await screen.findByText('وثّق بريدك أولاً')).toBeTruthy();
    // ...and nothing was requested.
    expect(mockFollowSource).not.toHaveBeenCalled();
    expect(mockUnfollowSource).not.toHaveBeenCalled();
  });

  it('does not even read follow state while unverified', async () => {
    mockAuthState = {
      user: { id: 'u1', email: 'reader@example.com', emailVerified: false },
      token: 'session-token',
      emailVerified: false,
    };
    render(<SourceScreen />);
    await screen.findByText('خبر من اليوم السابع');
    expect(mockFetchFollows).not.toHaveBeenCalled();
  });
});
