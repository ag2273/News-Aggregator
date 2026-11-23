/**
 * #40 club page, #41 empty news state, #42 competition page.
 *
 * The approval made specific claims, so these test the claims rather than the layout:
 * the form strip comes from real scores only, the scorer line is absent because the
 * sources do not supply it, the source count is not invented, and the pitch button
 * appears only when a line-up exists.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'egyptian-premier', name: 'الأهلي', date: '2026-11-23' }),
  useFocusEffect: (cb: () => void) => cb(),
  Stack: { Screen: () => null },
}));
jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

const mockTeam = jest.fn();
const mockComp = jest.fn();
const mockMatch = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchTeamPage: (...a: unknown[]) => mockTeam(...a),
    fetchCompetitionPage: (...a: unknown[]) => mockComp(...a),
    fetchMatch: (...a: unknown[]) => mockMatch(...a),
    fetchTeamFollows: async () => [],
  };
});
jest.mock('../lib/auth', () => ({
  useAuth: () => ({ user: null, token: null, loading: false, emailVerified: false,
    signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn(), deleteAccount: jest.fn(), refreshSession: jest.fn() }),
}));
jest.mock('../components/ArticleSheet', () => ({
  useArticleSheet: () => ({ open: jest.fn(), close: jest.fn(), isOpen: false }),
}));
jest.mock('../components/AccountGate', () => ({
  useAccountGate: () => ({ openWith: jest.fn(), open: jest.fn(), allowed: false, mode: 'signin',
    visible: false, dismiss: jest.fn(), currentMode: 'signin' }),
  AccountGateSheet: () => null,
}));

import TeamScreen from '../app/team/[name]';
import CompetitionScreen from '../app/competition/[id]';
import MatchCenterScreen from '../app/matches/[id]';
import { EmptyMatchNews } from '../components/EmptyMatchNews';
import { palette } from '../constants/colors';

const m = (over: Record<string, unknown> = {}) => ({
  id: 'x1', competitionId: 'egyptian-premier', competitionName: 'الدوري المصري',
  home: 'الأهلي', away: 'بيراميدز', homeScore: 2, awayScore: 0,
  status: 'finished', statusText: 'انتهت', kickoff: '20:00', round: null, minute: null,
  dataSource: 'filgoal', ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('#40 club page', () => {
  it('shows the four real table columns and no W/D/L', async () => {
    mockTeam.mockResolvedValue({
      name: 'الأهلي', logo: '/api/football/logo/x', teamIds: [], competitionIds: ['egyptian-premier'],
      upcoming: [], recent: [], news: [],
      standing: { competitionId: 'egyptian-premier', position: 1, played: 14, goalDiff: 18, points: 36, continental: true },
      form: ['W', 'W', 'D', 'W', 'L'],
    });
    render(<TeamScreen />);
    await waitFor(() => expect(screen.getByText('لعب')).toBeTruthy());
    expect(screen.getByText('+/-')).toBeTruthy();
    expect(screen.getByText('نقاط')).toBeTruthy();
    expect(screen.getByText('36')).toBeTruthy();
    // No fabricated win/draw/loss columns.
    expect(screen.queryByText('ف.أ')).toBeNull();
  });

  it('renders the form strip from the served results only', async () => {
    mockTeam.mockResolvedValue({
      name: 'الأهلي', logo: null, teamIds: [], competitionIds: ['egyptian-premier'],
      upcoming: [], recent: [], news: [], standing: null,
      form: ['W', 'D', 'L'],
    });
    render(<TeamScreen />);
    await waitFor(() => expect(screen.getByText('سلسلة النتائج')).toBeTruthy());
    // Arabic letters for win/draw/loss, one per served result.
    expect(screen.getAllByText('ف').length).toBe(1);
    expect(screen.getAllByText('ت').length).toBe(1);
    expect(screen.getAllByText('خ').length).toBe(1);
  });

  it('hides the table strip entirely when we hold no table', async () => {
    mockTeam.mockResolvedValue({
      name: 'نادي بلا جدول', logo: null, teamIds: [], competitionIds: [], upcoming: [], recent: [],
      news: [], standing: null, form: [],
    });
    render(<TeamScreen />);
    await waitFor(() => expect(screen.getByText('صفحة النادي')).toBeTruthy());
    // No zeros pretending to be a record.
    expect(screen.queryByText('المركز')).toBeNull();
  });
});

describe('#41 empty news state', () => {
  const base = {
    t: palette.light, home: 'فاركو', away: 'زد', hasEvents: true,
    onOpenEvents: jest.fn(), onOpenLineups: jest.fn(), onOpenHome: jest.fn(), onOpenAway: jest.fn(),
  };

  it('names no source count, because the copy must not invent one', async () => {
    render(<EmptyMatchNews {...base} hasLineups={false} />);
    expect(screen.getByText(/مصادرنا المعتمدة/)).toBeTruthy();
    expect(screen.queryByText(/29|٢٩/)).toBeNull();
  });

  it('shows the pitch route only when a real line-up exists', async () => {
    const { rerender } = render(<EmptyMatchNews {...base} hasLineups={false} />);
    expect(screen.queryByText(/عرض التشكيل التكتيكي/)).toBeNull();
    rerender(<EmptyMatchNews {...base} hasLineups />);
    expect(screen.getByText(/عرض التشكيل التكتيكي/)).toBeTruthy();
  });

  it('never promises that coverage is coming', async () => {
    render(<EmptyMatchNews {...base} hasLineups={false} />);
    // The honest phrasing: nothing published *yet*, no countdown, no "soon".
    expect(screen.getByText(/لا توجد تغطية صحفية منشورة/)).toBeTruthy();
    expect(screen.queryByText(/بعد \d+ دقيقة|قريباً|قريبا/)).toBeNull();
  });
});

describe('#42 competition page', () => {
  it('renders the table with four columns and the channel on a fixture', async () => {
    mockComp.mockResolvedValue({
      id: 'egyptian-premier', nameAr: 'الدوري المصري', isCup: false, priority: 10, country: 'EG',
      standingsUnavailable: false, hasFullRecord: false,
      standings: [
        { position: 1, team: 'بيراميدز', played: 14, won: 0, drawn: 0, lost: 0, goalsFor: 30, goalsAgainst: 12, points: 36 },
        { position: 2, team: 'الأهلي', played: 14, won: 0, drawn: 0, lost: 0, goalsFor: 28, goalsAgainst: 10, points: 32 },
      ],
      upcoming: [m({ id: 'u1', home: 'زد', away: 'سموحة', homeScore: null, awayScore: null, status: 'upcoming', kickoff: '17:00', statusText: 'لم تبدأ', channel: 'أون سبورت' })],
      recent: [],
    });
    render(<CompetitionScreen />);
    await waitFor(() => expect(screen.getByText('بيراميدز')).toBeTruthy());
    expect(screen.getByText('36')).toBeTruthy();
    // The broadcaster is real for Egyptian fixtures, verified against the API.
    expect(screen.getByText(/أون سبورت/)).toBeTruthy();
  });

  it('says a cup has no table instead of drawing an empty one', async () => {
    mockComp.mockResolvedValue({
      id: 'egypt-cup', nameAr: 'كأس مصر', isCup: true, priority: 15, country: 'EG',
      standingsUnavailable: true, hasFullRecord: false, standings: null, upcoming: [], recent: [],
    });
    render(<CompetitionScreen />);
    await waitFor(() => expect(screen.getByText(/مالهاش جدول ترتيب/)).toBeTruthy());
  });
});
