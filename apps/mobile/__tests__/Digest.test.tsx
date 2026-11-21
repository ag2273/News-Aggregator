/**
 * The digest screen, its topic picker, and the independent notification toggle.
 *
 * The screen must never render a blank page: before the first build it says so,
 * with a failure it shows an error with a retry, and a snippet-built summary is
 * labelled rather than presented as full text.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

const mockFetchDigest = jest.fn();
const mockFetchPrefs = jest.fn();
const mockSaveTopics = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchDigest: (...args: unknown[]) => mockFetchDigest(...args),
    fetchDigestPrefs: (...args: unknown[]) => mockFetchPrefs(...args),
    saveDigestTopics: (...args: unknown[]) => mockSaveTopics(...args),
  };
});

type TestUser = { id: string; email: string; emailVerified: boolean };
const signedIn: TestUser = { id: 'u1', email: 'a@b.co', emailVerified: true };
// jest.mock factories cannot close over local variables, so the mutable current
// user lives on `global`.
(globalThis as unknown as { __digestUser: TestUser | null }).__digestUser = null;
jest.mock('../lib/auth', () => ({
  useAuth: () => {
    const u = (globalThis as unknown as { __digestUser: { id: string; email: string; emailVerified: boolean } | null }).__digestUser;
    return {
    user: u,
    token: u ? 'tok' : null,
    loading: false,
    emailVerified: u?.emailVerified ?? false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    deleteAccount: jest.fn(),
    refreshSession: jest.fn(),
    };
  },
}));

jest.mock('../components/ArticleSheet', () => ({
  useArticleSheet: () => ({ open: jest.fn(), close: jest.fn(), isOpen: false }),
}));

jest.mock('../components/AccountGate', () => ({
  useAccountGate: () => ({
    allowed: true,
    mode: null,
    open: jest.fn(),
    openWith: jest.fn(),
    visible: false,
    dismiss: jest.fn(),
    currentMode: 'signin',
  }),
}));

import DigestScreen from '../app/digest';
import DigestTopicsScreen from '../app/digest-topics';

const ITEM = {
  articleId: 'a1',
  title: 'مقتل 4 فلسطينيين وإصابة 17 في قصف إسرائيلي بقطاع غزة',
  url: 'https://example.com/a1',
  sourceName: 'سكاي نيوز عربية',
  sourceId: 'skynews-arabia',
  category: 'misc' as const,
  summary: 'مقتل 4 فلسطينيين وإصابة 17 آخرين في قصف واستهدافات بقطاع غزة.',
  why: 'خبر ميداني مستمر تتابعه المنطقة.',
  isBreaking: true,
  publishedAt: Date.now(),
  textSource: 'full' as const,
};

function setUser(u: TestUser | null): void {
  (globalThis as unknown as { __digestUser: TestUser | null }).__digestUser = u;
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser(null);
});

describe('digest screen', () => {
  it('renders the items it was given', async () => {
    mockFetchDigest.mockResolvedValue({
      slot: '2026-11-21T09:00',
      builtAt: Date.now(),
      stale: false,
      topics: ['egypt'],
      items: [ITEM],
    });
    render(<DigestScreen />);
    // Title and summary both mention the story, so match the title exactly.
    await waitFor(() =>
      expect(screen.getByText('مقتل 4 فلسطينيين وإصابة 17 في قصف إسرائيلي بقطاع غزة')).toBeTruthy(),
    );
    expect(screen.getByText('عاجل')).toBeTruthy();
    expect(screen.getByText('الخلاصة')).toBeTruthy();
  });

  it('says the digest is not ready yet instead of showing a blank page', async () => {
    mockFetchDigest.mockResolvedValue({
      slot: null,
      builtAt: null,
      stale: true,
      topics: ['egypt'],
      items: [],
    });
    render(<DigestScreen />);
    await waitFor(() => expect(screen.getByText('الخلاصة لسه مجهزة')).toBeTruthy());
  });

  it('shows an error with a retry, not an empty list, when the request fails', async () => {
    mockFetchDigest.mockRejectedValue(new Error('تعذّر الاتصال'));
    render(<DigestScreen />);
    await waitFor(() => expect(screen.getByText('تعذّر الاتصال')).toBeTruthy());
    expect(screen.getByText('حاول مرة أخرى')).toBeTruthy();
  });

  it('labels a summary built from the RSS excerpt', async () => {
    mockFetchDigest.mockResolvedValue({
      slot: '2026-11-21T09:00',
      builtAt: Date.now(),
      stale: false,
      topics: ['egypt'],
      items: [{ ...ITEM, textSource: 'snippet' }],
    });
    render(<DigestScreen />);
    // The reader must be able to tell this was not built from the full article.
    await waitFor(() => expect(screen.getByText(/ملخص من المقتطف/)).toBeTruthy());
  });

  it('offers the topic picker when the chosen topics produced nothing', async () => {
    mockFetchDigest.mockResolvedValue({
      slot: '2026-11-21T09:00',
      builtAt: Date.now(),
      stale: false,
      topics: ['sports'],
      items: [],
    });
    render(<DigestScreen />);
    await waitFor(() => expect(screen.getByText('مفيش أخبار في مواضيعك')).toBeTruthy());
    expect(screen.getByText('اختيار المواضيع')).toBeTruthy();
  });
});

describe('digest topic picker', () => {
  it('starts with the reader current choice and saves a change', async () => {
    setUser(signedIn);
    mockFetchPrefs.mockResolvedValue({
      topics: ['egypt', 'economy'],
      available: ['egypt', 'economy', 'sports', 'health', 'tech', 'misc'],
      defaults: ['egypt', 'economy', 'health', 'tech', 'misc'],
    });
    mockSaveTopics.mockResolvedValue(['egypt', 'economy', 'sports']);

    render(<DigestTopicsScreen />);
    await waitFor(() => expect(screen.getByText('مصر')).toBeTruthy());

    // Sport starts off (the default), so turning it on is a real change.
    fireEvent.press(screen.getByLabelText('رياضة'));
    fireEvent.press(screen.getByLabelText('حفظ المواضيع'));

    await waitFor(() => expect(mockSaveTopics).toHaveBeenCalled());
    expect(mockSaveTopics).toHaveBeenCalledWith('tok', ['egypt', 'economy', 'sports']);
  });

  it('shows the verification gate rather than a toggle that would fail', async () => {
    setUser({ ...signedIn, emailVerified: false });
    render(<DigestTopicsScreen />);
    // The gate is rendered on the first pass, with no request behind it.
    expect(screen.getByText('وثّق بريدك أولاً')).toBeTruthy();
    expect(mockFetchPrefs).not.toHaveBeenCalled();
  });

  it('shows all six topics', async () => {
    setUser(signedIn);
    mockFetchPrefs.mockResolvedValue({
      topics: [],
      available: ['egypt', 'economy', 'sports', 'health', 'tech', 'misc'],
      defaults: [],
    });
    render(<DigestTopicsScreen />);
    for (const label of ['مصر', 'اقتصاد', 'رياضة', 'صحة', 'تكنولوجيا', 'منوعات']) {
      await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
    }
    // An empty selection is allowed and warned about.
    expect(screen.getByText(/الخلاصة هتكون فاضية/)).toBeTruthy();
  });
});
