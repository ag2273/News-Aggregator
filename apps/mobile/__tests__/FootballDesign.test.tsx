/**
 * The screens rebuilt to the approved design file (#24).
 *
 * These pin the contract the design makes with the reader, not the CSS: one
 * merged filter row, colours that mark only real places, a news card that can
 * finish a headline, and the honest gaps staying honest. Each one fails if the
 * behaviour is reverted to the pre-design screen.
 */

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
const mockLeagueFollows = jest.fn();
const mockFollows = jest.fn();
const mockCatalog = jest.fn();
jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return {
    ...actual,
    fetchMatches: (...a: unknown[]) => mockMatches(...a),
    fetchMatch: (...a: unknown[]) => mockMatch(...a),
    fetchStandings: (...a: unknown[]) => mockStandings(...a),
    fetchCompetitions: (...a: unknown[]) => mockCompetitions(...a),
    fetchLeagueFollows: (...a: unknown[]) => mockLeagueFollows(...a),
    fetchTeamFollows: (...a: unknown[]) => mockFollows(...a),
    fetchFollowCatalog: (...a: unknown[]) => mockCatalog(...a),
  };
});
jest.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: null,
    token: null,
    loading: false,
    emailVerified: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    deleteAccount: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));
jest.mock('../components/ArticleSheet', () => ({
  useArticleSheet: () => ({ open: jest.fn(), close: jest.fn(), isOpen: false }),
}));
jest.mock('../components/AccountGate', () => ({
  useAccountGate: () => ({
    openWith: jest.fn(),
    open: jest.fn(),
    allowed: false,
    mode: 'signin',
    visible: false,
    dismiss: jest.fn(),
    currentMode: 'signin',
  }),
  AccountGateSheet: () => null,
}));

import MatchesScreen from '../app/matches/index';
import MatchCenterScreen from '../app/matches/[id]';
import StandingsScreen from '../app/matches/standings';
import FollowTeamsScreen from '../app/matches/follow-teams';
import { MatchCard, matchCountLabel } from '../components/FootballCard';
import { palette } from '../constants/colors';

const match = (over: Record<string, unknown> = {}) => ({
  id: 'yk-1',
  competitionId: 'egyptian-premier',
  competitionName: 'الدوري المصري',
  home: 'الأهلي',
  away: 'بيراميدز',
  homeScore: null,
  awayScore: null,
  status: 'upcoming',
  statusText: 'لم تبدأ',
  kickoff: '20:00',
  round: null,
  minute: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFollows.mockResolvedValue([]);
  mockLeagueFollows.mockResolvedValue([]);
  mockCompetitions.mockResolvedValue([]);
  mockCatalog.mockResolvedValue({
    sections: [
      {
        id: 'egypt',
        title: 'أندية الدوري المصري',
        teams: [
          {
            name: 'بيراميدز',
            competitionId: 'egyptian-premier',
            competitionName: 'الدوري المصري',
            section: 'egypt',
            logo: '/api/football/logo/yallakora:2728',
            position: 1,
            flag: null,
            nextMatch: { opponent: 'سموحة', kickoff: '17:00', isHome: true },
          },
        ],
      },
      {
        id: 'national',
        title: 'المنتخبات الوطنية',
        teams: [
          {
            name: 'منتخب مصر',
            competitionId: 'national',
            competitionName: 'المنتخبات الوطنية',
            section: 'national',
            logo: null,
            position: null,
            flag: '🇪🇬',
            nextMatch: null,
          },
        ],
      },
    ],
  });
});

describe('matches screen, per the approved design', () => {
  it('gives the day its own league strip, with the fixture count on it', async () => {
    mockMatches.mockResolvedValue({
      date: '2026-11-23',
      unavailable: false,
      fetchedAt: 1,
      followedTeams: [],
      followedLeagues: [],
      competitions: [],
      matches: [
        match({ id: 'a', home: 'وادي دجلة', away: 'الاتحاد السكندري' }),
        match({ id: 'b', home: 'الجونة', away: 'الزمالك', kickoff: '17:00' }),
      ],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الدوري المصري')).toBeTruthy());
    // The strip says how many fixtures are under it, not a decorative label.
    expect(screen.getAllByText('مباراتان').length).toBeGreaterThan(0);
  });

  it('never prints the same live match twice on one screen', async () => {
    // The user's screenshot: «مباشر» echoed on the card and in a section heading.
    mockMatches.mockResolvedValue({
      date: '2026-11-23',
      unavailable: false,
      fetchedAt: 1,
      followedTeams: ['الأهلي'],
      followedLeagues: [],
      competitions: [],
      matches: [
        match({
          id: 'live-1',
          status: 'live',
          statusText: 'الشوط الثاني',
          homeScore: 2,
          awayScore: 1,
          minute: null,
        }),
      ],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('2 - 1')).toBeTruthy());
    // A followed live match lives in the favourites strip only.
    expect(screen.getAllByText('الأهلي').length).toBe(1);
    expect(screen.queryByText('مباشر الآن')).toBeNull();
  });

  it('still shows no minute for an Egyptian live match', async () => {
    mockMatches.mockResolvedValue({
      date: '2026-11-23',
      unavailable: false,
      fetchedAt: 1,
      followedTeams: [],
      followedLeagues: [],
      competitions: [],
      matches: [
        match({
          id: 'eg',
          status: 'live',
          statusText: 'الشوط الثاني',
          homeScore: 1,
          awayScore: 0,
          minute: null,
        }),
      ],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('1 - 0')).toBeTruthy());
    expect(screen.getByText('الشوط الثاني')).toBeTruthy();
    expect(screen.queryByText(/^\d+'/)).toBeNull();
  });

  it('shows the minute where the provider published one', async () => {
    // European coverage does carry minutes, so hiding them everywhere would
    // throw away real data.
    mockMatches.mockResolvedValue({
      date: '2026-11-23',
      unavailable: false,
      fetchedAt: 1,
      followedTeams: [],
      followedLeagues: [],
      competitions: [],
      matches: [
        match({
          id: 'eu',
          competitionId: 'ita-serie-a',
          competitionName: 'الدوري الإيطالي',
          status: 'live',
          statusText: 'الشوط الثاني',
          homeScore: 1,
          awayScore: 1,
          minute: 74,
        }),
      ],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText(/74'/)).toBeTruthy());
  });

  it('opens the competition page from the league strip', async () => {
    mockMatches.mockResolvedValue({
      date: '2026-11-23',
      unavailable: false,
      fetchedAt: 1,
      followedTeams: [],
      followedLeagues: [],
      competitions: [
        { id: 'egyptian-premier', nameAr: 'الدوري المصري', country: 'EG', isCup: false, priority: 10 },
      ],
      matches: [match()],
    });
    render(<MatchesScreen />);
    await waitFor(() =>
      expect(screen.getByLabelText('الدوري المصري — صفحة البطولة')).toBeTruthy(),
    );
  });
});

describe('match card pieces', () => {
  it('pluralises a count the way Arabic does', () => {
    expect(matchCountLabel(1)).toBe('مباراة');
    expect(matchCountLabel(2)).toBe('مباراتان');
    expect(matchCountLabel(5)).toBe('5 مباريات');
    expect(matchCountLabel(22)).toBe('22 مباراة');
  });

  it('drops a fact the source did not publish instead of blanking it', () => {
    render(
      <MatchCard
        t={palette.light}
        m={match({ stadium: null, channel: null, round: null }) as never}
        onPress={jest.fn()}
        onPressTeam={jest.fn()}
      />,
    );
    // No stadium line, no channel chip, and the kickoff still reads.
    expect(screen.getByText('20:00')).toBeTruthy();
    expect(screen.queryByText(/استاد/)).toBeNull();
  });
});

describe('match centre news, per the approved design', () => {
  it('puts the relative age on each card', async () => {
    const now = Date.now();
    mockMatch.mockResolvedValue({
      match: match(),
      detail: null,
      news: [
        {
          id: 'n1',
          title: 'كولر يتحدث قبل القمة',
          sourceName: 'اليوم السابع',
          url: 'https://x',
          publishedAt: now - 14 * 60 * 1000,
          team: 'home',
          imageUrl: null,
        },
      ],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('كولر يتحدث قبل القمة')).toBeTruthy());
    expect(screen.getByText(/منذ 14 دقيقة/)).toBeTruthy();
  });

  it('still lets a real headline finish instead of clipping it', async () => {
    mockMatch.mockResolvedValue({
      match: match(),
      detail: null,
      news: [
        {
          id: 'n1',
          title: 'الأهلي يختتم استعداداته لمواجهة بيراميدز في قمة الدوري المصري الليلة',
          sourceName: 'يلا كورة',
          url: 'https://x',
          publishedAt: Date.now(),
          team: 'both',
          imageUrl: null,
        },
      ],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/الأهلي يختتم استعداداته/)).toBeTruthy());
    const title = screen.getByText(/الأهلي يختتم استعداداته/);
    // Three lines, not two: two clipped real headlines mid-sentence.
    expect(title.props.numberOfLines).toBe(3);
  });
});

describe('standings legend, per the approved design', () => {
  it('names only the zones the table can actually have', async () => {
    mockStandings.mockResolvedValue({
      unavailable: false,
      tables: [
        {
          competitionId: 'egyptian-premier',
          group: null,
          hasFullRecord: false,
          rows: [
            { position: 1, team: 'بيراميدز', played: 8, won: 0, drawn: 0, lost: 0, goalsFor: 19, goalsAgainst: 4, points: 24 },
            { position: 2, team: 'الأهلي', played: 8, won: 0, drawn: 0, lost: 0, goalsFor: 15, goalsAgainst: 6, points: 20 },
            { position: 3, team: 'الزمالك', played: 8, won: 0, drawn: 0, lost: 0, goalsFor: 12, goalsAgainst: 8, points: 15 },
          ],
        },
      ],
    });
    render(<StandingsScreen />);
    await waitFor(() => expect(screen.getByText('بيراميدز')).toBeTruthy());
    expect(screen.getByText('البطولات القارية')).toBeTruthy();
    // Three rows cannot have a relegation zone, so the legend must not claim one.
    expect(screen.queryByText('الهبوط')).toBeNull();
  });
});

describe('follow screen, per the approved design', () => {
  it('separates the sections and names Egypt properly', async () => {
    render(<FollowTeamsScreen />);
    await waitFor(() => expect(screen.getByText('منتخب مصر')).toBeTruthy());
    expect(screen.getByText(/أندية الدوري المصري/)).toBeTruthy();
    expect(screen.getAllByText(/المنتخبات الوطنية/).length).toBeGreaterThan(0);
    expect(screen.queryByText('منتخب')).toBeNull();
  });

  it('draws the real crest and the league position on a club card', async () => {
    render(<FollowTeamsScreen />);
    await waitFor(() => expect(screen.getByText('بيراميدز')).toBeTruthy());
    expect(screen.getByText('المركز 1')).toBeTruthy();
    // The crest asks OUR server, never a source.
    const crest = screen.getByLabelText('بيراميدز');
    expect(String(crest.props.source.uri)).toContain('/api/football/logo/');
  });

  it('searches the catalogue instead of only scrolling it', async () => {
    render(<FollowTeamsScreen />);
    await waitFor(() => expect(screen.getByText('بيراميدز')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('ابحث عن نادٍ أو منتخب'), 'منتخب مصر');
    await waitFor(() => expect(screen.getByText('منتخب مصر')).toBeTruthy());
    expect(screen.queryByText('بيراميدز')).toBeNull();
  });

  it('says honestly when a search finds nothing', async () => {
    render(<FollowTeamsScreen />);
    await waitFor(() => expect(screen.getByText('بيراميدز')).toBeTruthy());
    fireEvent.changeText(screen.getByLabelText('ابحث عن نادٍ أو منتخب'), 'ريال مدريد');
    await waitFor(() => expect(screen.getByText(/لا يوجد فريق اسمه/)).toBeTruthy());
  });
});
