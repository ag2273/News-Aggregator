/**
 * Club-page news opens like every other article (issue #50).
 *
 * The user's report was that club-page news was display-only: a tap did nothing.
 * The decision was to use the match centre's card and open flow rather than invent a
 * new design, so this asserts exactly that: the same card is rendered, and a tap
 * hands the article to the same reader.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ name: 'الأهلي', id: 'egyptian-premier' }),
  useFocusEffect: (cb: () => void) => cb(),
  Stack: { Screen: () => null },
}));
jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

const mockOpen = jest.fn();
jest.mock('../components/ArticleSheet', () => ({
  useArticleSheet: () => ({ open: mockOpen, close: jest.fn(), isOpen: false }),
}));
jest.mock('../components/AccountGate', () => ({
  useAccountGate: () => ({
    openWith: jest.fn(), open: jest.fn(), allowed: false, mode: 'signin',
    visible: false, dismiss: jest.fn(), currentMode: 'signin',
  }),
  AccountGateSheet: () => null,
}));
jest.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: null, token: null, loading: false, emailVerified: false,
    signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn(),
    deleteAccount: jest.fn(), refreshSession: jest.fn(),
  }),
}));

const mockTeam = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchTeamPage: (...a: unknown[]) => (globalThis as any).__mockTeam(...a),
    fetchTeamFollows: async () => [],
  };
});
(globalThis as any).__mockTeam = mockTeam;

import TeamScreen from '../app/team/[name]';

const newsItem = {
  id: 'n1',
  title: 'الأهلي يحسم القمة بهدف قاتل في الوقت بدل الضائع',
  sourceName: 'اليوم السابع',
  url: 'https://www.youm7.com/story/1',
  publishedAt: Date.now() - 60_000,
  imageUrl: 'https://cdn.example.com/lead.jpg',
  team: 'both' as const,
};

beforeEach(() => {
  mockOpen.mockReset();
  mockTeam.mockResolvedValue({
    name: 'الأهلي',
    logo: null,
    teamIds: [],
    competitionIds: ['egyptian-premier'],
    upcoming: [],
    recent: [],
    news: [newsItem],
    standing: null,
    form: [],
    competitions: [],
  });
});

describe('club-page news', () => {
  it('opens the article when the reader taps it', async () => {
    render(<TeamScreen />);
    await waitFor(() => expect(screen.getByText(newsItem.title)).toBeTruthy());
    fireEvent.press(screen.getByText(newsItem.title));
    // The same reader every other list opens, carrying the article's own fields.
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'n1',
        title: newsItem.title,
        url: newsItem.url,
        sourceName: 'اليوم السابع',
      }),
    );
  });

  it('renders the match centre’s card, not a display-only box', async () => {
    render(<TeamScreen />);
    await waitFor(() => expect(screen.getByText(newsItem.title)).toBeTruthy());
    // MatchNewsCard is a button with the headline as its accessibility label; the
    // old wire card was a plain View with no press handler at all.
    const card = screen.getByLabelText(newsItem.title);
    expect(card).toBeTruthy();
    expect(card.props.accessibilityRole ?? card.props.role).toBe('button');
  });

  it('still says honestly when the club has no coverage', async () => {
    mockTeam.mockResolvedValue({
      name: 'الأهلي', logo: null, teamIds: [], competitionIds: ['egyptian-premier'],
      upcoming: [], recent: [], news: [], standing: null, form: [], competitions: [],
    });
    render(<TeamScreen />);
    await waitFor(() =>
      expect(screen.getByText(/لا توجد تغطية صحفية لهذا الفريق/)).toBeTruthy(),
    );
  });
});
