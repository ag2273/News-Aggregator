/**
 * Regression: an article opened from الأكثر تداولاً with like=3 must render «3»
 * on 👍 inside the real ArticleReader.
 *
 * The reported bug was NOT the threshold per type: the Lavrov article has like=3
 * (confirmed in /data/reactions.json — three distinct reactors, all 👍), and the
 * old ≥3 rule would have shown it. The counts never reached the bar because
 * ReactionsBar seeded useState from its prop and ArticleSheet reuses ONE reader
 * instance (no key), so the bar kept the first article's values.
 *
 * This test drives the real reader across two articles — the exact trending flow
 * — rather than only the bar in isolation.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

const mockFetchReactions = jest.fn();

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchReactions: (...a: unknown[]) => mockFetchReactions(...a),
    fetchIsArticleSaved: jest.fn().mockResolvedValue(false),
    saveArticle: jest.fn(),
    unsaveArticle: jest.fn(),
    putReaction: jest.fn(),
    deleteReaction: jest.fn(),
  };
});

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

// Plain mock: requireActual would pull in the push stack and its native module.
jest.mock('../lib/auth', () => ({
  useAuth: () => ({
    token: 'session',
    user: { id: 'u1', email: 'r@example.com', emailVerified: true },
    emailVerified: true,
    loading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    deleteAccount: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

import { ArticleReader } from '../components/ArticleReader';
import { palette } from '../constants/colors';

const t = palette.dark;

const LAVROV_ID = 'b155d2c4ffae3c65';

function article(id: string, title: string, reactions?: any) {
  return {
    id,
    title,
    summary: 'ملخص الخبر',
    imageUrl: null,
    url: `https://example.com/${id}`,
    sourceId: 'rt-arabic',
    sourceName: 'آر تي عربي',
    category: 'misc',
    country: 'RU',
    publishedAt: Date.now() - 3600_000,
    isBreaking: false,
    reactions,
    myReaction: null,
  } as any;
}

const zeros = { like: 0, love: 0, wow: 0, sad: 0, angry: 0, total: 0 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reader opened from trending with like=3', () => {
  it('renders «3» on 👍 after a different article was open first', async () => {
    // The trending list hands the reader an article whose snapshot has no counts
    // (it was fetched before anyone reacted).
    const first = article('some-other-article', 'خبر آخر بدون تفاعلات', zeros);
    const lavrov = article(LAVROV_ID, 'لافروف: حملة الغرب لإلغاء الثقافة الروسية محكوم عليها بالفشل', zeros);

    // The fresh fetch is what supplies the truth: 3 likes.
    mockFetchReactions.mockImplementation(async (id: string) =>
      id === LAVROV_ID
        ? { counts: { like: 3, love: 0, wow: 0, sad: 0, angry: 0, total: 3 }, myReaction: null }
        : { counts: zeros, myReaction: null },
    );

    const { rerender } = render(
      <ArticleReader article={first} t={t} onClose={jest.fn()} onReadFull={jest.fn()} variant="sheet" />,
    );

    // Open the Lavrov article in the SAME reader instance, as ArticleSheet does.
    rerender(
      <ArticleReader article={lavrov} t={t} onClose={jest.fn()} onReadFull={jest.fn()} variant="sheet" />,
    );

    // The count appears on 👍 and the Arabic total line is correct.
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText('٣ تفاعلات')).toBeTruthy();
  });

  it('shows the count even when the fresh fetch is the only source of it', async () => {
    const lavrov = article(LAVROV_ID, 'لافروف: حملة الغرب', zeros);
    mockFetchReactions.mockResolvedValue({
      counts: { like: 3, love: 0, wow: 0, sad: 0, angry: 0, total: 3 },
      myReaction: 'like',
    });

    render(<ArticleReader article={lavrov} t={t} onClose={jest.fn()} onReadFull={jest.fn()} variant="sheet" />);

    await waitFor(() => expect(mockFetchReactions).toHaveBeenCalledWith(LAVROV_ID, 'session'));
    expect(await screen.findByText('3')).toBeTruthy();
    // And the caller's own reaction is ringed.
    expect(screen.getByLabelText(/إعجاب/).props.accessibilityState.selected).toBe(true);
  });

  it('keeps showing zero-free emoji when the article truly has no reactions', async () => {
    mockFetchReactions.mockResolvedValue({ counts: zeros, myReaction: null });
    render(
      <ArticleReader
        article={article('quiet', 'خبر بدون تفاعلات', zeros)}
        t={t}
        onClose={jest.fn()}
        onReadFull={jest.fn()}
        variant="sheet"
      />,
    );
    await waitFor(() => expect(mockFetchReactions).toHaveBeenCalled());
    expect(screen.queryByText('0')).toBeNull();
  });
});
