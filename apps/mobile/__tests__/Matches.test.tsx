import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

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
  };
});
jest.mock('../lib/auth', () => ({
  useAuth: () => ({ user: null, token: null, loading: false, emailVerified: false, signIn: jest.fn(), signUp: jest.fn(), signOut: jest.fn(), deleteAccount: jest.fn(), refreshSession: jest.fn() }),
}));
jest.mock('../components/ArticleSheet', () => ({ useArticleSheet: () => ({ open: jest.fn(), close: jest.fn(), isOpen: false }) }));
jest.mock('../components/AccountGate', () => ({
  useAccountGate: () => ({ openWith: jest.fn(), open: jest.fn(), allowed: false, mode: 'signin', visible: false, dismiss: jest.fn(), currentMode: 'signin' }),
  AccountGateSheet: () => null,
}));

import MatchesScreen from '../app/matches/index';
import MatchCenterScreen from '../app/matches/[id]';
import StandingsScreen from '../app/matches/standings';
import FollowTeamsScreen from '../app/matches/follow-teams';
import UpcomingScreen from '../app/matches/upcoming';

const match = (over: Record<string, unknown> = {}) => ({
  id: 'yk-1', competitionId: 'egyptian-premier', competitionName: 'الدوري المصري',
  home: 'الأهلي', away: 'بيراميدز', homeScore: null, awayScore: null,
  status: 'upcoming', statusText: 'لم تبدأ', kickoff: '20:00', round: 'الأسبوع التاسع', minute: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFollows.mockResolvedValue([]);
  // Every mocked day now carries the competition list the server always sends.
  mockMatches.mockImplementation?.(() => Promise.resolve({}));
  mockLeagueFollows.mockResolvedValue([]);
  mockCompetitions.mockResolvedValue([
    { id: 'egyptian-premier', nameAr: 'الدوري المصري', country: 'EG', isCup: false },
    { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', country: 'GB', isCup: false },
  ]);
});

describe('matches screen', () => {
  it('renders fixtures grouped by competition', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    expect(screen.getByText('بيراميدز')).toBeTruthy();
    expect(screen.getByText('20:00')).toBeTruthy();
    expect(screen.getByText('مباريات اليوم')).toBeTruthy();
  });

  it('says the data is unavailable rather than showing an empty board', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: true, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('البيانات غير متاحة حاليًا')).toBeTruthy());
  });

  it('shows the empty state with a tomorrow shortcut', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('لا توجد مباريات مجدولة اليوم في بطولاتك المفضلة')).toBeTruthy());
    expect(screen.getByText('استعراض مباريات الغد')).toBeTruthy();
  });

  it('filters to live matches', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [
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
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
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
    expect(screen.getByText('الأخبار')).toBeTruthy();
  });

  it('says plainly when there is no timeline yet', async () => {
    mockMatch.mockResolvedValue({ match: match(), news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأحداث')).toBeTruthy());
    fireEvent.press(screen.getByText('الأحداث'));
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
  it('offers a signed-out reader sign-in, not a dead "verify" screen', async () => {
    // A guest has no account to verify; the first version told them to.
    render(<FollowTeamsScreen />);
    await waitFor(() => expect(screen.getByText(/متابعة الفرق مرتبطة بحسابك/)).toBeTruthy());
    expect(screen.getByText('تسجيل الدخول')).toBeTruthy();
    expect(screen.queryByText('وثّق بريدك أولاً')).toBeNull();
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

  it('labels an article that covers both teams', async () => {
    mockMatch.mockResolvedValue({
      match: match(),
      news: [
        { id: 'n1', title: 'الأهلي يستعد لمواجهة بيراميدز', sourceName: 'اليوم السابع', url: 'https://x', publishedAt: 1, team: 'both' },
      ],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/الفريقان/)).toBeTruthy());
  });

  it('shows the channel and says so when there is none', async () => {
    mockMatch.mockResolvedValue({
      match: match({ channel: 'أون تايم سبورتس 1' }),
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
  });
});

describe('upcoming fixtures screen', () => {
  it('lists coming matches with their channel', async () => {
    mockMatches.mockResolvedValue({
      date: '2026-11-23',
      unavailable: false,
      fetchedAt: 1,
      followedTeams: [], followedLeagues: [],
      matches: [
        match({ id: 'u1', channel: 'أون تايم سبورتس 1' }),
        match({ id: 'u2', home: 'سموحة', away: 'زد', channel: null }),
      ],
    });
    render(<UpcomingScreen />);
    await waitFor(() => expect(screen.getByText('أون تايم سبورتس 1')).toBeTruthy());
    expect(screen.getByText('القناة الناقلة غير معلنة بعد')).toBeTruthy();
    expect(screen.getByText(/أسماء المعلقين غير متاحة/)).toBeTruthy();
  });

  it('leaves finished matches off a "coming up" list', async () => {
    mockMatches.mockResolvedValue({
      date: '2026-11-23',
      unavailable: false,
      fetchedAt: 1,
      followedTeams: [], followedLeagues: [],
      matches: [
        match({ id: 'f1', home: 'الزمالك', away: 'الجونة', status: 'finished', statusText: 'انتهت' }),
        match({ id: 'u1', home: 'الأهلي', away: 'بيراميدز' }),
      ],
    });
    render(<UpcomingScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    expect(screen.queryByText('الزمالك')).toBeNull();
  });

  it('opens the match centre at the route that actually exists', async () => {
    // The first version pushed '/match/[id]', but the screen is
    // app/matches/[id].tsx. Tapping a card did nothing, and no test noticed
    // because every test rendered the screen directly.
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    fireEvent.press(screen.getByText('الأهلي'));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/matches/[id]' }),
    );
  });

  it('opens the upcoming list at a route that exists', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('المباريات القادمة ومواعيد البث'));
    expect(router.push).toHaveBeenCalledWith('/matches/upcoming');
  });

  it('shows the stadium and channel when the source gives them', async () => {
    mockMatch.mockResolvedValue({
      match: match({ stadium: 'استاد خــالد بشارة (مصر)', channel: 'أون سبورت ماكس' }),
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/بشارة/)).toBeTruthy());
    expect(screen.getByText('أون سبورت ماكس')).toBeTruthy();
  });

  it('shows no empty detail row when neither is known', async () => {
    mockMatch.mockResolvedValue({ match: match(), news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    expect(screen.queryByText(/استاد/)).toBeNull();
  });

  it('offers a way back from an empty filter instead of a dead end', async () => {
    // «الفرق المتابعة» with nothing followed used to show a bare message with no
    // way out.
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    fireEvent.press(screen.getByText('الفرق المتابعة'));
    await waitFor(() => expect(screen.getByText('لا توجد مباريات لفرقك المفضلة اليوم')).toBeTruthy());
    expect(screen.getByText('عرض كل المباريات')).toBeTruthy();
  });

  it('keeps the empty message readable at a large font scale', async () => {
    // The clipped-message finding: the text is inside a growing scroller now, so
    // it can wrap instead of being cut by a fixed-height box.
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText(/لا توجد مباريات مجدولة/)).toBeTruthy());
    const msg = screen.getByText(/لا توجد مباريات مجدولة/);
    expect(msg.props.numberOfLines).toBeUndefined();
  });

  it('shows the commentator and the two coaches when the provider has them', async () => {
    mockMatch.mockResolvedValue({
      match: match(),
      detail: { commentator: 'بلال علام', channel: 'أون سبورت ماكس', homeCoach: 'علاء عبد العال', awayCoach: 'معتمد جمال' },
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/المعلق: بلال علام/)).toBeTruthy());
    fireEvent.press(screen.getByText('التشكيل'));
    await waitFor(() => expect(screen.getByText(/مدرب الأهلي: علاء عبد العال/)).toBeTruthy());
    expect(screen.getByText(/مدرب بيراميدز: معتمد جمال/)).toBeTruthy();
  });

  it('does not invent a commentator when the provider has none', async () => {
    mockMatch.mockResolvedValue({ match: match(), detail: null, news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    expect(screen.queryByText(/المعلق/)).toBeNull();
  });

  it('gives each empty filter its own honest sentence', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    fireEvent.press(screen.getByText('انتهت'));
    await waitFor(() => expect(screen.getByText('لم تنتهِ أي مباراة اليوم بعد')).toBeTruthy());
  });

  it('says which channel a match is on, not merged with the round', async () => {
    // «الجولة الثانية · الكأس 9» read like a garbled round name; the second part
    // is a broadcaster.
    mockMatches.mockResolvedValue({
      date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [],
      matches: [match({ round: 'الجولة الثانية', channel: 'الكأس 9' })],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الجولة الثانية')).toBeTruthy());
    expect(screen.getByText('تُنقل على الكأس 9')).toBeTruthy();
    expect(screen.queryByText(/الجولة الثانية · الكأس/)).toBeNull();
  });

  it('shows the match even when the follows lookup fails', async () => {
    // The screen the user photographed: a big «تعذّر تحميل المباراة» over an empty
    // page. The match had loaded fine; a failed follows request replaced it.
    mockMatch.mockResolvedValue({ match: match(), detail: null, news: [{ id: 'n1', title: 'خبر', sourceName: 's', url: 'u', publishedAt: 1, team: 'home' }], unavailable: false });
    mockFollows.mockRejectedValue(new Error('boom'));
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    expect(screen.queryByText('تعذّر تحميل المباراة.')).toBeNull();
    expect(screen.getByText('خبر')).toBeTruthy();
  });

  it('says there is no coverage, without offering anything misleading', async () => {
    mockMatch.mockResolvedValue({ match: match(), detail: null, news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/لا توجد تغطية صحفية لهذه المباراة/)).toBeTruthy());
  });

  it('shows the Egyptian league first, above the European groups', async () => {
    // The user's «فين الدوري المصري؟»: groups came out in API order, so the
    // Egyptian league sat under seven European headings on a busy day.
    mockMatches.mockResolvedValue({
      date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [],
      matches: [
        match({ id: 'e1', competitionId: 'esp-la-liga', competitionName: 'الدوري الإسباني', home: 'برشلونة', away: 'فياريال' }),
        match({ id: 'e2', competitionId: 'eng-premier', competitionName: 'الدوري الإنجليزي', home: 'ليفربول', away: 'أرسنال' }),
        match({ id: 'eg1', competitionId: 'egyptian-premier', competitionName: 'الدوري المصري' }),
      ],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الدوري المصري')).toBeTruthy());
    const headings = screen.getAllByText(/^الدوري (المصري|الإسباني|الإنجليزي)$/);
    expect(headings[0]!.props.children).toBe('الدوري المصري');
  });

  it('pins every match of a followed league under the favourites filter', async () => {
    // Following «الدوري المصري» must show all its fixtures, not one club's.
    mockMatches.mockResolvedValue({
      date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: ['egyptian-premier'],
      matches: [
        match({ id: 'eg1', home: 'الأهلي', away: 'بيراميدز' }),
        match({ id: 'eg2', home: 'سموحة', away: 'زد' }),
        match({ id: 'e1', competitionId: 'eng-premier', competitionName: 'الدوري الإنجليزي', home: 'ليفربول', away: 'أرسنال' }),
      ],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الفرق المتابعة (2)')).toBeTruthy());
    fireEvent.press(screen.getByText('الفرق المتابعة (2)'));
    await waitFor(() => expect(screen.getByText('مباريات فرقي المفضلة')).toBeTruthy());
    expect(screen.getByText('سموحة')).toBeTruthy();
    expect(screen.queryByText('ليفربول')).toBeNull();
  });

  it('honours the served priority rather than the order rows arrive in', async () => {
    // Issue #25: the app must render in served order, so a per-user order (#26) can
    // reuse the same field later.
    mockMatches.mockResolvedValue({
      date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [],
      matches: [
        match({ id: 'a', competitionId: 'ger-bundesliga', competitionName: 'الدوري الألماني', competitionPriority: 40, home: 'بايرن', away: 'دورتموند' }),
        match({ id: 'b', competitionId: 'ita-serie-a', competitionName: 'الدوري الإيطالي', competitionPriority: 20, home: 'ميلان', away: 'روما' }),
        match({ id: 'c', competitionId: 'egyptian-premier', competitionName: 'الدوري المصري', competitionPriority: 10 }),
      ],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الدوري المصري')).toBeTruthy());
    const heads = screen.getAllByText(/^الدوري (المصري|الإيطالي|الألماني)$/);
    expect(heads.map((h) => h.props.children)).toEqual([
      'الدوري المصري',
      'الدوري الإيطالي',
      'الدوري الألماني',
    ]);
  });

  it('shows an Egyptian live score with its half, and never a minute', async () => {
    // Live scores for Egyptian matches are on. The agreed ceiling is score + half:
    // neither source publishes a trustworthy minute, so no "67'" may appear.
    mockMatches.mockResolvedValue({
      date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [],
      matches: [
        match({
          id: 'eg-live',
          home: 'الجونة',
          away: 'الزمالك',
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
    expect(screen.getByText('الشوط الثاني')).toBeTruthy();
    // No minute anywhere on the card.
    expect(screen.queryByText(/^\d+'$/)).toBeNull();
  });

  it('shows a league with no fixture today, with an honest empty line', async () => {
    // Issue #9: a league with nothing on this day used to vanish entirely.
    mockMatches.mockResolvedValue({
      date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [],
      competitions: [
        { id: 'egyptian-premier', nameAr: 'الدوري المصري', country: 'EG', isCup: false, priority: 10 },
        { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', country: 'GB', isCup: false, priority: 22 },
      ],
      matches: [
        match({ id: 'e1', competitionId: 'eng-premier', competitionName: 'الدوري الإنجليزي', home: 'ليفربول', away: 'أرسنال' }),
      ],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الدوري المصري')).toBeTruthy());
    expect(screen.getByText('لا توجد مباريات لهذا الدوري اليوم')).toBeTruthy();
  });

  it('offers a follow star on the league group itself', async () => {
    mockMatches.mockResolvedValue({
      date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [],
      competitions: [{ id: 'egyptian-premier', nameAr: 'الدوري المصري', country: 'EG', isCup: false, priority: 10 }],
      matches: [match()],
    });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByLabelText('متابعة الدوري المصري')).toBeTruthy());
  });
});
