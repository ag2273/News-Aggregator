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
import {
  fetchMatch,
  fetchTeamFollows,
  followFootballTeam,
  unfollowFootballTeam,
  isNetworkFailure,
  type FootballMatch,
  type MatchNews,
} from '../../lib/api';

type NewsItem = MatchNews;

const TABS = [
  { id: 'news', label: 'الأخبار والكواليس' },
  { id: 'events', label: 'أحداث المباراة' },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMatch(id, date ?? '');
      setMatch(data.match);
      setNews(data.news);
      if (token) {
        const follows = await fetchTeamFollows(token);
        setFollowing(follows.some((f) => f.name === data.match.home || f.name === data.match.away));
      }
    } catch (err) {
      setError(isNetworkFailure(err) ? 'تعذّر الاتصال. حاول مرة أخرى.' : 'تعذّر تحميل المباراة.');
    } finally {
      setLoading(false);
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
            {/* Hero scoreboard, as the spec asks: wide, dark, 28dp corners. */}
            <View style={[styles.hero, { backgroundColor: t.surface }]}>
              <View style={styles.heroSide}>
                <View style={[styles.crest, { backgroundColor: t.pillInactiveBg }]}>
                  <Ionicons name="shield-outline" size={22} color={t.textMuted} />
                </View>
                <Text style={[styles.heroTeam, { color: t.textPrimary }]} numberOfLines={1}>{match.home}</Text>
              </View>
              <View style={styles.heroCenter}>
                <Text style={[styles.heroScore, { color: match.status === 'live' ? t.accent : t.textPrimary }]}>
                  {match.homeScore === null || match.awayScore === null
                    ? match.kickoff ?? '—'
                    : `${match.homeScore} - ${match.awayScore}`}
                </Text>
                <Text style={[styles.heroStatus, { color: match.status === 'live' ? t.accent : t.textMuted }]}>
                  {match.status === 'live' && match.minute ? `${match.minute}'` : match.statusText}
                </Text>
                {match.round ? <Text style={[styles.heroRound, { color: t.textMuted }]}>{match.round}</Text> : null}
              </View>
              <View style={styles.heroSide}>
                <View style={[styles.crest, { backgroundColor: t.pillInactiveBg }]}>
                  <Ionicons name="shield-outline" size={22} color={t.textMuted} />
                </View>
                <Text style={[styles.heroTeam, { color: t.textPrimary }]} numberOfLines={1}>{match.away}</Text>
              </View>
            </View>

            {/* What the source knows about the fixture itself: stadium and the
                channel showing it. Both are omitted when absent rather than
                shown blank. */}
            {match.stadium || match.channel ? (
              <View style={[styles.detailRow, { backgroundColor: t.surface }]}>
                {match.stadium ? (
                  <View style={styles.detailItem}>
                    <Ionicons name="location-outline" size={13} color={t.textMuted} />
                    <Text style={[styles.detailText, { color: t.textSecondary }]} numberOfLines={1}>
                      {match.stadium}
                    </Text>
                  </View>
                ) : null}
                {match.channel ? (
                  <View style={styles.detailItem}>
                    <Ionicons name="tv-outline" size={13} color={t.textMuted} />
                    <Text style={[styles.detailText, { color: t.textSecondary }]} numberOfLines={1}>
                      {match.channel}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
              {TABS.map((x) => (
                <TouchableOpacity
                  key={x.id}
                  onPress={() => setTab(x.id)}
                  style={[styles.tab, { backgroundColor: x.id === tab ? t.accent : t.pillInactiveBg }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: x.id === tab }}
                >
                  <Text style={[styles.tabText, { color: x.id === tab ? '#FFFFFF' : t.textSecondary }]}>{x.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {tab === 'news' ? (
              news.length ? (
                news.map((n) => (
                  <TouchableOpacity
                    key={n.id}
                    style={[styles.newsCard, { backgroundColor: t.surface }]}
                    onPress={() =>
                      // Hand the existing reader a card-shaped article so the news
                      // tab opens the same reader as the feed.
                      sheet.open({
                        id: n.id,
                        title: n.title,
                        summary: null,
                        imageUrl: null,
                        url: n.url,
                        sourceId: '',
                        sourceName: n.sourceName,
                        category: 'sports',
                        country: 'EG',
                        publishedAt: n.publishedAt,
                        isBreaking: false,
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={n.title}
                  >
                    <Text style={[styles.newsSource, { color: t.accent }]}>
                      {n.sourceName}
                      {n.team === 'both' ? ' · الفريقان' : ''}
                    </Text>
                    <Text style={[styles.newsTitle, { color: t.textPrimary }]} numberOfLines={2}>{n.title}</Text>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.centerInline}>
                  <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                    لا توجد تغطية صحفية لهذه المباراة في مصادرنا حتى الآن.
                  </Text>
                </View>
              )
            ) : null}

            {tab === 'events' ? (
              <View style={styles.centerInline}>
                <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                  {match.status === 'upcoming'
                    ? 'لم تبدأ المباراة بعد — ستظهر الأهداف والكروت هنا فور انطلاقها.'
                    : 'المصدر لا يوفّر شريط أحداث لهذه المباراة.'}
                </Text>
              </View>
            ) : null}

            {tab === 'lineups' ? (
              <View style={styles.centerInline}>
                <Text style={[styles.emptyBody, { color: t.textMuted }]}>
                  التشكيل غير متاح من المصدر لهذه المباراة.
                </Text>
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
  hero: { flexDirection: 'row', alignItems: 'center', borderRadius: 28, padding: 18, gap: 10 },
  heroSide: { flex: 1, alignItems: 'center', gap: 6 },
  crest: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  heroTeam: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  heroCenter: { alignItems: 'center', minWidth: 96 },
  heroScore: { fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroStatus: { fontSize: 11, fontWeight: '700' },
  heroRound: { fontSize: 10 },
  detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  detailText: { fontSize: 11 },
  tabs: { gap: 8, paddingVertical: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  tabText: { fontSize: 12, fontWeight: '600' },
  newsCard: { borderRadius: 16, padding: 12, gap: 4 },
  newsSource: { fontSize: 11, fontWeight: '700' },
  newsTitle: { fontSize: 14, fontWeight: '600', lineHeight: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  centerInline: { padding: 20, alignItems: 'center' },
  emptyTitle: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 12, lineHeight: 20, textAlign: 'center' },
  retry: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 14, borderWidth: 1 },
});
