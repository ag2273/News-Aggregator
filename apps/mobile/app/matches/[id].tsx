import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, router } from 'expo-router';
import { palette } from '../../constants/colors';
import type { Theme } from '../../constants/colors';
import { useAuth } from '../../lib/auth';
import { useArticleSheet } from '../../components/ArticleSheet';
import { TeamCrest } from '../../components/TeamCrest';
import { MatchNewsCard } from '../../components/MatchNewsCard';
import {
  fetchMatch,
  fetchTeamFollows,
  followFootballTeam,
  unfollowFootballTeam,
  isNetworkFailure,
  type FootballMatch,
  type MatchDetail,
  type MatchNews,
} from '../../lib/api';

type NewsItem = MatchNews;

const TABS = [
  // Short labels because four tabs share a 360dp width (~78dp each), where
  // «الأخبار والكواليس» was cut to «الأخبار والك...».
  { id: 'news', label: 'الأخبار' },
  { id: 'events', label: 'الأحداث' },
  { id: 'lineups', label: 'التشكيل' },
  { id: 'standings', label: 'الترتيب' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/**
 * مركز المباراة.
 *
 * The news tab is the differentiator: it pulls articles about these two teams out
 * of our own 29-source corpus. The events tab states plainly when the source
 * gives no timeline, rather than showing an empty column that looks broken.
 */
export default function MatchCenterScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const { token } = useAuth();
  const sheet = useArticleSheet();

  const [tab, setTab] = useState<TabId>('news');
  const [match, setMatch] = useState<FootballMatch | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    // The match itself is fetched first, and a failure there is the only thing
    // that makes this screen an error. The follow-star lookup is a nicety: it used
    // to sit in the same try, so one failed follows request replaced a perfectly
    // good match with «تعذّر تحميل المباراة» — the screen the user photographed.
    let loaded: FootballMatch | null = null;
    try {
      const data = await fetchMatch(id, date ?? '');
      loaded = data.match;
      setMatch(data.match);
      setDetail(data.detail ?? null);
      setNews(data.news);
    } catch (err) {
      setError(isNetworkFailure(err) ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'تعذّر تحميل المباراة.');
    } finally {
      setLoading(false);
    }
    if (!token || !loaded) return;
    try {
      const follows = await fetchTeamFollows(token);
      setFollowing(follows.some((f) => f.name === loaded!.home || f.name === loaded!.away));
    } catch {
      /* the star stays unfilled; the match is already on screen */
    }
  }, [id, date, token]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFollow = async () => {
    if (!token || !match) return;
    try {
      if (following) await unfollowFootballTeam(token, match.home);
      else await followFootballTeam(token, match.home, match.competitionId);
      setFollowing(!following);
    } catch {
      /* the star is not worth an error banner */
    }
  };

  return (
    <LinearGradient colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="رجوع">
            <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={1}>
            مركز المباراة
          </Text>
          <TouchableOpacity onPress={toggleFollow} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="متابعة المباراة">
            <Ionicons name={following ? 'star' : 'star-outline'} size={20} color={following ? t.accent : t.textPrimary} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={t.accent} /></View>
        ) : error || !match ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={28} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>{error ?? 'المباراة غير متاحة'}</Text>
            <TouchableOpacity style={[styles.retry, { borderColor: t.accent }]} onPress={load} accessibilityRole="button">
              <Text style={{ color: t.accent }}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {/* Match centre hero, to the approved design: one dark plate holding
                the competition line, the two crests with the score, and the facts
                the source published about the fixture. */}
            <View
              style={[
                styles.hero,
                { backgroundColor: t.cardGradientStart, borderColor: t.accentBorder },
              ]}
            >
              {/* Competition, round and stadium in one line — the design's strip.
                  Each part is dropped when the source did not send it. */}
              <TouchableOpacity
                style={styles.compStrip}
                onPress={() =>
                  router.push({ pathname: '/competition/[id]', params: { id: match.competitionId } })
                }
                accessibilityRole="button"
                accessibilityLabel={`${match.competitionName} — فتح صفحة البطولة`}
              >
                <Ionicons name="trophy-outline" size={13} color={t.accent} />
                <Text style={[styles.compStripText, { color: t.textSecondary }]} numberOfLines={1}>
                  {[match.competitionName, match.round, match.stadium].filter(Boolean).join(' • ')}
                </Text>
                <Ionicons name="chevron-back" size={13} color={t.textMuted} />
              </TouchableOpacity>

              <View style={styles.heroRow}>
                <TouchableOpacity
                  style={styles.heroSide}
                  onPress={() => router.push({ pathname: '/team/[name]', params: { name: match.home } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${match.home} — صفحة الفريق`}
                >
                  <TeamCrest logo={match.homeLogo} name={match.home} size={52} t={t} />
                  <Text style={[styles.heroTeam, { color: t.textPrimary }]} numberOfLines={2}>
                    {match.home}
                  </Text>
                </TouchableOpacity>
                <View style={styles.heroCenter}>
                  <Text style={[styles.heroScore, { color: t.textPrimary }]}>
                    {match.homeScore === null || match.awayScore === null
                      ? match.kickoff ?? '—'
                      : `${match.homeScore} - ${match.awayScore}`}
                  </Text>
                  {match.status === 'live' ? (
                    <View
                      style={[
                        styles.livePill,
                        { backgroundColor: t.liveRedBg, borderColor: t.liveRedBorder },
                      ]}
                    >
                      <View style={[styles.liveDot, { backgroundColor: t.liveRed }]} />
                      <Text style={[styles.liveText, { color: t.liveRed }]} numberOfLines={1}>
                        {/* Score + half. A minute only when the source published
                            one; the Egyptian ceiling is «بدون دقيقة». */}
                        {match.minute
                          ? `${match.minute}' • ${match.statusText || 'مباشر'}`
                          : match.statusText || 'مباشر'}
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.heroStatus, { color: t.textMuted }]} numberOfLines={1}>
                      {match.statusText}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.heroSide}
                  onPress={() => router.push({ pathname: '/team/[name]', params: { name: match.away } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${match.away} — صفحة الفريق`}
                >
                  <TeamCrest logo={match.awayLogo} name={match.away} size={52} t={t} />
                  <Text style={[styles.heroTeam, { color: t.textPrimary }]} numberOfLines={2}>
                    {match.away}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* The channel and the commentator, when the provider published
                  them. Omitted, never blank. */}
              {match.channel || detail?.commentator ? (
                <View style={styles.heroFacts}>
                  {detail?.commentator ? (
                    <Text style={[styles.heroFact, { color: t.textSecondary }]} numberOfLines={1}>
                      {`🎙 ${detail.commentator}`}
                    </Text>
                  ) : null}
                  {match.channel ? (
                    <Text style={[styles.heroFact, { color: t.textSecondary }]} numberOfLines={1}>
                      {`📺 ${match.channel}`}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>

            {/* Four tabs share the width instead of scrolling: in RTL a horizontal
                strip starts at the right edge, so the last tab sat permanently
                half-cut on a 360dp phone. */}
            <View style={styles.tabs}>
              {TABS.map((x) => (
                <TouchableOpacity
                  key={x.id}
                  onPress={() => setTab(x.id)}
                  style={[
                    styles.tab,
                    x.id === tab
                      ? { backgroundColor: t.accentSoft, borderColor: t.accent }
                      : { backgroundColor: 'transparent', borderColor: t.borderLight },
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: x.id === tab }}
                >
                  <Text
                    style={[styles.tabText, { color: x.id === tab ? t.accent : t.textSecondary }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {x.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {tab === 'news' ? (
              news.length ? (
                <>
                  <View style={styles.sectionHeadline}>
                    <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>
                      📰 أحدث الأخبار المتعلقة بالمباراة
                    </Text>
                    <Text style={[styles.counter, { color: t.accent, backgroundColor: t.accentSoft }]}>
                      من مصادرك المعتمدة
                    </Text>
                  </View>
                  {news.map((n) => (
                    <MatchNewsCard
                      key={n.id}
                      t={t}
                      title={n.title}
                      sourceName={n.sourceName}
                      publishedAt={n.publishedAt}
                      imageUrl={n.imageUrl ?? null}
                      both={n.team === 'both'}
                      onPress={() =>
                        // Hand the existing reader a card-shaped article, so the
                        // news tab opens the same reader as the feed.
                        sheet.open({
                          id: n.id,
                          title: n.title,
                          summary: null,
                          imageUrl: n.imageUrl ?? null,
                          url: n.url,
                          sourceId: '',
                          sourceName: n.sourceName,
                          category: 'sports',
                          country: 'EG',
                          publishedAt: n.publishedAt,
                          isBreaking: false,
                        })
                      }
                    />
                  ))}
                </>
              ) : (
                <View style={styles.centerInline}>
                  <Ionicons name="newspaper-outline" size={26} color={t.textMuted} />
                  <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                    لا توجد تغطية صحفية لهذه المباراة في مصادرنا حتى الآن.
                  </Text>
                </View>
              )
            ) : null}

            {tab === 'events' ? (
              <View style={styles.centerInline}>
                {/* Measured: neither source publishes a goal timeline — no
                    MatchEvents, no scorer names, no minutes, and Yallakora's
                    minute endpoint returns 500. So this never promises an
                    event feed that cannot arrive; it states the score and that
                    the timeline is not published. */}
                <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                  {match.status === 'upcoming'
                    ? 'لم تبدأ المباراة بعد. النتيجة ستظهر هنا، أما شريط الأهداف فالمصدر لا يوفّره.'
                    : 'المصدر يوفّر النتيجة فقط، ولا يوفّر شريط أحداث (هدافين أو دقائق) لهذه المباراة.'}
                </Text>
              </View>
            ) : null}

            {tab === 'lineups' ? (
              <View style={styles.centerInline}>
                {detail?.homeCoach || detail?.awayCoach ? (
                  <View style={[styles.coachBox, { backgroundColor: t.surface }]}>
                    {detail?.homeCoach ? (
                      <Text style={[styles.coachLine, { color: t.textSecondary }]}>
                        {`مدرب ${match.home}: ${detail.homeCoach}`}
                      </Text>
                    ) : null}
                    {detail?.awayCoach ? (
                      <Text style={[styles.coachLine, { color: t.textSecondary }]}>
                        {`مدرب ${match.away}: ${detail.awayCoach}`}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {/* The source publishes line-ups for European fixtures (40-45
                    players with name, position and shirt number) and none at all
                    for Egyptian ones — so this renders real players when they
                    exist and says so plainly when they do not. Never a guessed XI. */}
                {detail?.lineups ? (
                  <View style={styles.lineupWrap}>
                    {([
                      [match.home, detail.lineups.home.filter((p) => p.isStarter)],
                      [match.away, detail.lineups.away.filter((p) => p.isStarter)],
                    ] as const).map(([teamName, players]) => (
                      <View key={teamName} style={[styles.lineupCard, { backgroundColor: t.surface }]}>
                        <Text style={[styles.lineupTeam, { color: t.textPrimary }]}>{teamName}</Text>
                        {players.length === 0 ? (
                          <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                            لا توجد تشكيلة معلنة لهذا الفريق.
                          </Text>
                        ) : (
                          players.map((p) => (
                            <View key={p.personId} style={styles.lineupRow}>
                              <Text style={[styles.lineupShirt, { color: t.accent }]}>
                                {p.shirtNumber ?? '—'}
                              </Text>
                              <Text style={[styles.lineupName, { color: t.textPrimary }]} numberOfLines={1}>
                                {p.name}
                              </Text>
                              <Text style={[styles.lineupPos, { color: t.textMuted }]} numberOfLines={1}>
                                {p.position ?? ''}
                              </Text>
                            </View>
                          ))
                        )}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                    التشكيل غير متاح من المصدر لهذه المباراة.
                  </Text>
                )}
              </View>
            ) : null}

            {tab === 'standings' ? (
              <TouchableOpacity
                style={[styles.newsCard, { backgroundColor: t.surface }]}
                onPress={() => router.push('/matches/standings')}
                accessibilityRole="button"
              >
                <Text style={[styles.newsTitle, { color: t.textPrimary }]}>عرض جدول الترتيب</Text>
                <Text style={[styles.emptyBody, { color: t.textMuted }]}>ترتيب البطولة كاملًا في شاشة الترتيب.</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 4 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' },
  list: { padding: 14, gap: 10, paddingBottom: 40 },
  hero: { borderRadius: 24, borderWidth: 1, padding: 16, gap: 14 },
  compStrip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  compStripText: { flex: 1, fontFamily: 'Cairo_600SemiBold', fontSize: 11 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroSide: { flex: 1, alignItems: 'center', gap: 6 },
  heroTeam: { fontFamily: 'Cairo_700Bold', fontSize: 14, textAlign: 'center', lineHeight: 19 },
  heroCenter: { alignItems: 'center', minWidth: 92, gap: 4 },
  heroScore: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 30,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  heroStatus: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontFamily: 'Cairo_700Bold', fontSize: 10 },
  heroFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  heroFact: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  sectionHeadline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { fontFamily: 'Cairo_700Bold', fontSize: 13, flexShrink: 1 },
  counter: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  detailText: { fontSize: 11 },
  coachBox: { borderRadius: 14, padding: 12, gap: 4, marginBottom: 10, alignSelf: 'stretch' },
  coachLine: { fontSize: 12 },
  lineupWrap: { alignSelf: 'stretch', gap: 10 },
  lineupCard: { borderRadius: 16, padding: 12, gap: 6 },
  lineupTeam: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  lineupRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineupShirt: { width: 22, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lineupName: { flex: 1, fontSize: 13 },
  lineupPos: { fontSize: 11 },
  // A horizontal strip inside a column flex needs its own height (the same trap
  // that stretched the day ribbon), and trailing padding so the last tab can
  // scroll clear of the edge instead of sitting half-cut.
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 2 },
  compName: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  tabs: { flexDirection: 'row', gap: 6, paddingVertical: 6 },
  tab: { flex: 1, paddingHorizontal: 6, paddingVertical: 8, borderRadius: 16, alignItems: 'center', borderWidth: 1 },
  tabText: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, textAlign: 'center' },
  newsCard: { borderRadius: 16, padding: 12, gap: 4 },
  newsSource: { fontSize: 11, fontWeight: '700' },
  newsTitle: { fontSize: 14, fontWeight: '600', lineHeight: 22, flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  centerInline: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 12, lineHeight: 20, textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
