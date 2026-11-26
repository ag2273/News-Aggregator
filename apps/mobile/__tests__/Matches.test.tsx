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

  it('mounts a busy league lazily instead of every card at once (#perf)', async () => {
    // 60 fixtures in ONE competition: before, the whole league was one list row,
    // so all 60 cards mounted when the screen opened.
    const many = Array.from({ length: 60 }, (_, i) =>
      match({ id: `yk-${i}`, home: `فريق ${i}`, away: `ضيف ${i}` }),
    );
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: many });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('فريق 0')).toBeTruthy());
    const mounted = screen.queryAllByText(/^فريق \d+$/).length;
    expect(mounted).toBeLessThan(60);
    expect(screen.queryByText('فريق 59')).toBeNull();
  });

  it('still collapses and reopens a league', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('الدوري المصري — طي'));
    await waitFor(() => expect(screen.queryByText('الأهلي')).toBeNull());
    fireEvent.press(screen.getByLabelText('الدوري المصري — توسيع'));
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
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
    fireEvent.press(screen.getByLabelText('مباشر فقط'));
    await waitFor(() => expect(screen.queryByText('سموحة')).toBeNull());
    // A minute is shown only when the source published one — this row carries
    // one, so the live pill names it.
    expect(screen.getByText(/67'/)).toBeTruthy();
  });

  it('renders every user-visible string as Arabic', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
    render(<MatchesScreen />);
    // The competition is the group header; the card under it does not repeat it.
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

  it('renders the real timeline when the source published one', async () => {
    // The box DOES publish minute, event and scorer — measured on finished
    // Egyptian league fixtures. The old «impossible» copy was wrong.
    mockMatch.mockResolvedValue({
      match: match({ status: 'finished', statusText: 'انتهت', homeScore: 2, awayScore: 1 }),
      detail: {
        commentator: null, channel: null, homeCoach: null, awayCoach: null, lineups: null,
        events: [
          { minute: 88, type: 'هدف', player: 'شيكو بانزا', side: 'r' },
          { minute: 57, type: 'هدف', player: 'محمد عبد الناصر', side: 'l' },
        ],
      },
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأحداث')).toBeTruthy());
    fireEvent.press(screen.getByText('الأحداث'));
    await waitFor(() => expect(screen.getByText('شيكو بانزا')).toBeTruthy());
    expect(screen.getByText("88'")).toBeTruthy();
    expect(screen.getByText('محمد عبد الناصر')).toBeTruthy();
  });

  it('attributes each event to the right team, home on the right column (#33)', async () => {
    // The user's screenshot: الجونة 0-2 الزمالك, every الزمالك goal drawn under
    // الجونة. The header printed home first (right in RTL) but the body put away
    // first, so the two disagreed. This asserts the ORDER of the two cells, which
    // is what the eye reads as the column.
    mockMatch.mockResolvedValue({
      match: match({ home: 'الجونة', away: 'الزمالك', status: 'live', statusText: 'الشوط الأول', homeScore: 0, awayScore: 2 }),
      detail: {
        commentator: null, channel: null, homeCoach: null, awayCoach: null, lineups: null,
        events: [
          // الزمالك scored: side `l` is the page's left column = away here.
          { minute: 33, type: 'هدف', player: 'أحمد حمدي', side: 'l' },
          { minute: 40, type: 'بطاقة صفراء', player: 'أحمد جمال', side: 'r' },
        ],
      } as never,
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأحداث')).toBeTruthy());
    fireEvent.press(screen.getByText('الأحداث'));
    await waitFor(() => expect(screen.getByText('أحمد حمدي')).toBeTruthy());

    // The reader sees the two team names once each in the header, in this order:
    // home (الجونة) first — which in an RTL row is the right-hand column.
    const headers = screen.getAllByText(/^(الجونة|الزمالك)$/);
    expect(headers[0]!.props.children).toBe('الجونة');
    expect(headers[1]!.props.children).toBe('الزمالك');

    // The cell that holds the away goal must be the AWAY cell, whose alignment is
    // flex-end. Before the fix it carried the home cell's flex-start, which is
    // what drew every الزمالك goal under الجونة.
    const cellStyleFor = (label: string): unknown => {
      let node: any = screen.getByText(label);
      for (let depth = 0; node && depth < 6; depth += 1) {
        const style = node.props?.style;
        if (style && JSON.stringify(style).includes('alignItems')) return style;
        node = node.parent;
      }
      return null;
    };
    const awayGoalCell = JSON.stringify(cellStyleFor('أحمد حمدي') ?? {});
    const homeCardCell = JSON.stringify(cellStyleFor('أحمد جمال') ?? {});
    // They must NOT share a column.
    expect(awayGoalCell).not.toBe(homeCardCell);
    expect(awayGoalCell).toContain('flex-end');
    expect(homeCardCell).toContain('flex-start');
  });

  it('does not invent a side for an event the page did not attribute (#33)', async () => {
    mockMatch.mockResolvedValue({
      match: match({ home: 'الجونة', away: 'الزمالك' }),
      detail: {
        commentator: null, channel: null, homeCoach: null, awayCoach: null, lineups: null,
        events: [{ minute: 55, type: 'تبديل', player: 'لاعب غير منسوب', side: null }],
      } as never,
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأحداث')).toBeTruthy());
    fireEvent.press(screen.getByText('الأحداث'));
    await waitFor(() => expect(screen.getByText('لاعب غير منسوب')).toBeTruthy());
    // It has a minute, so it is a real event and is shown — in a neutral row.
    // The test names appear in the hero AND the timeline header, so the check is
    // that the event is present exactly once and sits in the neutral row.
    expect(screen.getByText("55'")).toBeTruthy();
    expect(screen.getAllByText('لاعب غير منسوب').length).toBe(1);
  });

  it("never prints a literal null when the source sends status rows (#30)", async () => {
    // The user's screenshot: grey badges reading «null'» beside «لم تبدأ» /
    // «بعد قليل» / «الشوط الأول». Two faults met: the server shipped the page's
    // status markers as events, and the card interpolated a null minute.
    mockMatch.mockResolvedValue({
      match: match({ status: 'live', statusText: 'الشوط الأول', homeScore: 1, awayScore: 0 }),
      detail: {
        commentator: null, channel: null, homeCoach: null, awayCoach: null, lineups: null,
        events: [
          // Status markers, as the parser returns them before the server filter.
          { minute: null, type: 'لم تبدأ', player: null, side: null, isStatus: true },
          { minute: null, type: 'بعد قليل', player: null, side: null, isStatus: true },
          { minute: null, type: 'الشوط الأول', player: null, side: null, isStatus: true },
          // One real event, to prove the tab still works.
          { minute: 33, type: 'هدف', player: 'أحمد حمدي', side: 'r' },
        ],
      } as never,
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأحداث')).toBeTruthy());
    fireEvent.press(screen.getByText('الأحداث'));
    await waitFor(() => expect(screen.getByText('أحمد حمدي')).toBeTruthy());

    // The real event is shown with its minute…
    expect(screen.getByText("33'")).toBeTruthy();
    // …and no text node anywhere says null, and no badge shows a bare minute mark.
    for (const node of screen.queryAllByText(/./)) {
      const kids = node.props.children;
      const text = typeof kids === 'string' ? kids : Array.isArray(kids) ? kids.join('') : '';
      expect(text).not.toContain('null');
    }
    expect(screen.queryByText(/^null/)).toBeNull();
    // Status markers are not events, so they are not in the timeline body.
    expect(screen.queryByText('لم تبدأ')).toBeNull();
    expect(screen.queryByText('بعد قليل')).toBeNull();
  });

  it('says honestly when the source has no timeline for a match', async () => {
    mockMatch.mockResolvedValue({ match: match(), news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأحداث')).toBeTruthy());
    fireEvent.press(screen.getByText('الأحداث'));
    // Unplayed: the honest line is that it has not started, not that events are
    // impossible.
    await waitFor(() => expect(screen.getByText(/لم تبدأ المباراة بعد/)).toBeTruthy());
    expect(screen.queryByText(/شريط أحداث.*لا يوفّره/)).toBeNull();
  });

  it('never shows a minute it was not given', async () => {
    mockMatch.mockResolvedValue({
      match: match({ status: 'finished', statusText: 'انتهت' }),
      detail: {
        commentator: null, channel: null, homeCoach: null, awayCoach: null, lineups: null,
        events: [],
      },
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('الأحداث')).toBeTruthy());
    fireEvent.press(screen.getByText('الأحداث'));
    await waitFor(() => expect(screen.getByText(/مش بنضيف دقائق من عندنا/)).toBeTruthy());
    expect(screen.queryByText(/^\d+'$/)).toBeNull();
  });

  it('shows no coverage message instead of a blank tab', async () => {
    mockMatch.mockResolvedValue({ match: match(), news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/لا توجد تغطية صحفية/)).toBeTruthy());
  });
});

  it('opens the competition page from the match screen', async () => {
    mockMatch.mockResolvedValue({
      match: match({ competitionId: 'egyptian-premier', competitionName: 'الدوري المصري' }),
      detail: null, news: [], unavailable: false,
    });
    render(<MatchCenterScreen />);
    // The competition sits in the hero's strip, joined with the round and venue.
    await waitFor(() => expect(screen.getByText(/الدوري المصري/)).toBeTruthy());
    fireEvent.press(screen.getByLabelText(/فتح صفحة البطولة/));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/competition/[id]' }),
    );
  });

  it('opens the team page when a team name is tapped', async () => {
    mockMatch.mockResolvedValue({ match: match(), detail: null, news: [], unavailable: false });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByLabelText('الأهلي — صفحة الفريق')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('الأهلي — صفحة الفريق'));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/team/[name]' }),
    );
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
    // A guest has no account to verify; the first version told them to. They can
    // now browse the catalogue too — the gate is on the follow action, not on
    // seeing which clubs exist.
    render(<FollowTeamsScreen />);
    await waitFor(() => expect(screen.getByText(/عشان تتابع فريق/)).toBeTruthy());
    expect(screen.getByText('تسجيل الدخول')).toBeTruthy();
    expect(screen.queryByText('وثّق بريدك أولاً')).toBeNull();
    // Their own follow list is still not requested without a session.
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
    // The team NAME now opens the team page, so the card is pressed by its own
    // accessibility label («X ضد Y») to reach the match centre.
    fireEvent.press(screen.getByLabelText('الأهلي ضد بيراميدز'));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/matches/[id]' }),
    );
  });

  it('opens the upcoming list at a route that exists', async () => {
    mockMatches.mockResolvedValue({ date: '2026-11-23', unavailable: false, fetchedAt: 1, followedTeams: [], followedLeagues: [], matches: [match()] });
    render(<MatchesScreen />);
    await waitFor(() => expect(screen.getByText('الأهلي')).toBeTruthy());
    // The upcoming agenda lives at the calendar entry in the header.
    fireEvent.press(screen.getByLabelText('جداول الترتيب'));
    expect(router.push).toHaveBeenCalledWith('/matches/standings');
  });

  it('shows the stadium and channel when the source gives them', async () => {
    mockMatch.mockResolvedValue({
      match: match({ stadium: 'استاد خــالد بشارة (مصر)', channel: 'أون سبورت ماكس' }),
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/بشارة/)).toBeTruthy());
    expect(screen.getByText(/أون سبورت ماكس/)).toBeTruthy();
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
    fireEvent.press(screen.getByText('فرقي'));
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
      detail: { commentator: 'بلال علام', channel: 'أون سبورت ماكس', homeCoach: 'علاء عبد العال', awayCoach: 'معتمد جمال', lineups: null },
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText(/بلال علام/)).toBeTruthy());
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
    // Round and channel are separate facts, each labelled: the round sits in the
    // card's meta bar, the broadcaster under the kickoff.
    await waitFor(() => expect(screen.getAllByText('الجولة الثانية').length).toBeGreaterThan(0));
    expect(screen.getByText('الكأس 9')).toBeTruthy();
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
    // The approved #41 empty state: a richer card, but the claim is still exactly
    // true — no coverage *published yet*, never a promise that it is coming.
    await waitFor(() =>
      expect(screen.getAllByText(/لا توجد تغطية صحفية منشورة لهذه المباراة/).length).toBeGreaterThan(0),
    );
    // No invented outlet count: the sentence names no number at all.
    expect(screen.queryByText(/29 مصدر|٢٩ مصدر/)).toBeNull();
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
    await waitFor(() => expect(screen.getByText('فرقي (2)')).toBeTruthy());
    fireEvent.press(screen.getByText('فرقي (2)'));
    await waitFor(() => expect(screen.getByText(/مباريات فرقك المتابعة/)).toBeTruthy());
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

  it('shows the real line-up when the source publishes one', async () => {
    mockMatch.mockResolvedValue({
      match: match(),
      detail: {
        commentator: null, channel: null, homeCoach: null, awayCoach: null,
        lineups: {
          homeTeamId: '1', awayTeamId: '2',
          home: [
            { personId: 'a', name: 'أليسون بيكر', position: 'حارس مرمى', shirtNumber: 1, isStarter: true, minutesPlayed: 90, teamId: '1' },
            { personId: 'b', name: 'محمد صلاح', position: 'مهاجم', shirtNumber: 11, isStarter: true, minutesPlayed: 90, teamId: '1' },
            { personId: 'c', name: 'بديل', position: 'وسط', shirtNumber: 20, isStarter: false, minutesPlayed: 0, teamId: '1' },
          ],
          away: [
            { personId: 'd', name: 'أونانا', position: 'حارس مرمى', shirtNumber: 24, isStarter: true, minutesPlayed: 90, teamId: '2' },
          ],
        },
      },
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('التشكيل')).toBeTruthy());
    fireEvent.press(screen.getByText('التشكيل'));
    // The name appears twice now: on the tactical pitch (#28) and in the list
    // below it. Both are the same player, so either rendering proves it.
    await waitFor(() => expect(screen.getAllByText('أليسون بيكر').length).toBeGreaterThan(0));
    expect(screen.getAllByText('محمد صلاح').length).toBeGreaterThan(0);
    // A substitute is not in the starting XI.
    expect(screen.queryByText('بديل')).toBeNull();
  });

  it('shows the side that IS published, and names the side that is not', async () => {
    // Measured on الجونة × الزمالك at T-54: the source had 19 Zamalek players and
    // none for الجونة, because an XI is announced club by club. Returning null for
    // that state made the whole tab say «غير متاح» while real players existed.
    mockMatch.mockResolvedValue({
      match: match(),
      detail: {
        commentator: null, channel: null, homeCoach: null, awayCoach: null,
        lineups: {
          homeTeamId: '1', awayTeamId: '2',
          home: [
            { personId: 'a', name: 'مهدي سليمان', position: 'حارس مرمى', shirtNumber: 37, isStarter: true, minutesPlayed: 0, teamId: '1' },
            { personId: 'b', name: 'عبد الله السعيد', position: 'وسط', shirtNumber: 19, isStarter: true, minutesPlayed: 0, teamId: '1' },
          ],
          away: [],
        },
      },
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('التشكيل')).toBeTruthy());
    fireEvent.press(screen.getByText('التشكيل'));
    await waitFor(() => expect(screen.getAllByText('مهدي سليمان').length).toBeGreaterThan(0));
    expect(screen.getAllByText('عبد الله السعيد').length).toBeGreaterThan(0);
    // The unpublished side says so, per club, instead of blanking the whole tab.
    expect(screen.getByText(/لسه معلنش/)).toBeTruthy();
  });

  it('says the line-up is unavailable rather than inventing one', async () => {
    mockMatch.mockResolvedValue({
      match: match(),
      detail: { commentator: null, channel: null, homeCoach: null, awayCoach: null, lineups: null },
      news: [],
      unavailable: false,
    });
    render(<MatchCenterScreen />);
    await waitFor(() => expect(screen.getByText('التشكيل')).toBeTruthy());
    fireEvent.press(screen.getByText('التشكيل'));
    // The fixture is upcoming, so the honest sentence is "not announced yet" —
    // not "unavailable", which read as if the source never publishes one.
    // The honest line lives in the pitch's state card now (#28), and the list below
    // no longer repeats it — the pitch is the place a reader looks.
    await waitFor(() =>
      expect(screen.getAllByText(/مش ناشر التشكيل لسه/).length).toBeGreaterThan(0),
    );
  });
});
