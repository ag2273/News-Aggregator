import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'yk-1', date: '2026-11-23' }),
  Stack: { Screen: () => null },
}));
jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

const mockMatches = jest.fn();
const mockMatch = jest.fn();
const mockStandings = jest.fn();
const mockCompetitions = jest.fn();
const mockFollows = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchMatches: (...a: unknown[]) => mockMatches(...a),
    fetchMatch: (...a: unknown[]) => mockMatch(...a),
    fetchStandings: (...a: unknown[]) => mockStandings(...a),
    fetchCompetitions: (...a: unknown[]) => mockCompetitions(...a),
    fetchTeamFollows: (...a: unknown[]) => mockFollows(...a),
  };
});
jest.mock('../lib/auth', () => ({
  useAuth: () => ({ user: null, token: null, loading: false, emailVerified: false, signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn(), deleteAccount: jest.fn(), refreshSession: jest.fn() }),
}));
jest.mock('../components/ArticleSheet', () => ({ useArticleSheet: () => ({ open: jest.fn(), close: jest.fn(), isOpen: false }) }));
jest.mock('../components/AccountGate', () => ({ useAccountGate: () => ({ openWith: jest.fn(), open: jest.fn(), allowed: false, mode: 'verify', visible: false, dismiss: jest.fn(), currentMode: 'verify' }) }));

import MatchesScreen from '../app/matches/index';
import MatchCenterScreen from '../app/matches/[id]';
import StandingsScreen from '../app/matches/standings';
import FollowTeamsScreen from '../app/matches/follow-teams';

const match = (over: Record<string, unknown> = {}) => ({
  id: 'yk-1', competitionId: 'egyptian-premier', competitionName: 'الدوري المصري',
  home: 'الأهلي', away: 'بيراميدز', homeScore: null, awayScore: null,
  status: 'upcoming', statusText: 'لم تبدأ', kickoff: '20:00', round: 'الأسبوع التاسع', minute: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCompetitions.mockResolvedValue([
    { id: 'egyptian-premier', nameAr: 'الدوري المصري', country: 'EG', isCup: false },
    { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', country: 'GB', isCup: false },
  ]);
});

describe('matches screen', () => {
  it('renders fixtures grouped by competition', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    expect(screen.getByText('بيراميدز')).toBeTruthy();
    expect(screen.getByText('20:00')).toBeTruthy();
    expect(screen.getByText('مباريات اليوم')).toBeTruthy();
  });

  it('says the data is unavailable rather than showing an empty board', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: true, fetchedAt: 1, followedTeams: [], matches: [] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('البيانات غير متاحة حاليًا')).toBeTruthy());
  });

  it('shows the empty state with a tomorrow shortcut', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], matches: [] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('لا توجد مباريات مجدولة اليوم في بطولاتك المفضلة')).toBeTruthy());
    expect(screen.getByText('استعراض مباريات الغد')).toBeTruthy();
  });

  it('filters to live matches', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], matches: [
      match({ id: 'l1', status: 'live', statusText: 'مباشر', minute: 67, homeScore: 1, awayScore: 0 }),
      match({ id: 'u1', home: 'سموحة', away: 'زد' }),
    ] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('مباشر (1)')).toBeTruthy());
    fireEvent.press(screen.getByText('مباشر (1)'));
    await waitFor(() => expect(screen.queryByText('سموحة')).toBeNull());
    expect(screen.getByText("67'")).toBeTruthy();
  });

  it('renders every user-visible string as Arabic', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الدوري المصري')).toBeTruthy());
    // No Latin words leaking into the UI copy.
    for (const node of screen.getAllByText(/./)) {
      const label = typeof node.props.children === 'string' ? node.props.children : '';
      expect(label).not.toMatch(/[A-Za-z]{3,}/);
    }
  });
});

describe('match center', () => {
  it('opens on the news tab and shows corpus coverage', async () => {
    mockMatch.mockResolvedValue({ match: match(), news: [{ id: 'n1', title: 'كولر يتحدث قبل القمة', sourceName: 'اليوم السابع', url: 'https://x', publishedAt: 1, team: 'home' }], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('كولر يتحدث قبل القمة')).toBeTruthy());
    expect(screen.getByText('الأخبار والكواليس')).toBeTruthy();
  });

  it('says plainly when there is no timeline yet', async () => {
    mockMatch.mockResolvedValue({ match: match(), news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('أحداث المباراة')).toBeTruthy());
    fireEvent.press(screen.getByText('أحداث المباراة'));
    await waitFor(() => expect(screen.getByText(/لم تبدأ المباراة بعد/)).toBeTruthy());
  });

  it('shows no coverage message instead of a blank tab', async () => {
    mockMatch.mockResolvedValue({ match: match(), news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/لا توجد تغطية صحفية/)).toBeTruthy());
  });
});

describe('standings screen', () => {
  it('renders the table with the followed team highlighted', async () => {
    mockStandings.mockResolvedValue({ unavailable: false, tables: [{ competitionId: 'egyptian-premier', group: null, hasFullRecord: true, rows: [
      { position: 1, team: 'بيراميدز', played: 8, won: 8, drawn: 0, lost: 0, goalsFor: 19, goalsAgainst: 4, points: 24 },
      { position: 2, team: 'الأهلي', played: 8, won: 6, drawn: 2, lost: 0, goalsFor: 15, goalsAgainst: 6, points: 20 },
    ] }] });
    render(<StandingsScreen />);
    await waitFor(() => expect(screen.getByText('بيراميدز')).toBeTruthy());
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('#')).toBeTruthy();
  });

  it('says the table is unavailable rather than empty', async () => {
    mockStandings.mockResolvedValue({ unavailable: true, tables: [] });
    render(<StandingsScreen />);
    await waitFor(() => expect(screen.getByText('الترتيب غير متاح حاليًا')).toBeTruthy());
  });
});

describe('follow teams screen', () => {
  it('gates an unverified reader', async () => {
    render(<FollowTeamsScreen />);
    await waitFor(() => expect(screen.getByText('وثّق بريدك أولاً')).toBeTruthy());
    expect(mockFollows).not.toHaveBeenCalled();
  });

  it('hides the win/draw/loss columns when the source does not send them', async () => {
    // The Egyptian table is 4 columns (played, for, against, points). Printing
    // zeros for W/D/L would look like every club drew every match.
    mockStandings.mockResolvedValue({
      unavailable: false,
      tables: [
        {
          competitionId: 'egyptian-premier',
          group: null,
          hasFullRecord: false,
          rows: [
            { position: 1, team: 'بيراميدز', played: 8, won: 0, drawn: 0, lost: 0, goalsFor: 19, goalsAgainst: 4, points: 24 },
          ],
        },
      ],
    });
    render(<StandingsScreen />);
    await waitFor(() => expect(screen.getByText('بيراميدز')).toBeTruthy());
    expect(screen.queryByText('ف.أ')).toBeTruthy();
    expect(screen.queryByText('خ')).toBeNull();
    expect(screen.getByText('+15')).toBeTruthy();
    expect(screen.getByText(/بدون تفصيل الفوز والتعادل والخسارة/)).toBeTruthy();
  });
});
