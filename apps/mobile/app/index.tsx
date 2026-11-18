import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { fetchFeed, fetchGroupedFeed, isNetworkFailure } from '../lib/api';
import { ClusterSheetHost } from '../components/ClusterCard';
import { useAuth } from '../lib/auth';
import type { Article } from '../lib/api';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import { HeroDeck } from '../components/HeroDeck';
import { CategoryPills } from '../components/Pills';
import { FloatingDock } from '../components/FloatingDock';
import { VerifyBanner } from '../components/VerifyBanner';
import { useArticleSheet } from '../components/ArticleSheet';

const PAGE_SIZE = 30;
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

function todayLabel(): string {
  const d = new Date();
  return `${AR_DAYS[d.getDay()]}، ${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function FeedScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { open: openSheet } = useArticleSheet();
  const { token } = useAuth();

  const [articles, setArticles] = useState<Article[]>([]);
  /** articleId -> distinct outlet count, and the members, for the deck CTA. */
  const [clusterArticle, setClusterArticle] = useState<Article | null>(null);
  const [clusters, setClusters] = useState<
    Record<string, { sourceCount: number; members: Article[] }>
  >({});
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [deckIndex, setDeckIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);

  const load = useCallback(async (replace: boolean) => {
    try {
      const offset = replace ? 0 : offsetRef.current;
      const data = await fetchFeed(PAGE_SIZE, offset);
      // Cluster membership is a second, additive request: the deck renders the
      // same articles, and anything that fails here simply means "no badges".
      fetchGroupedFeed(PAGE_SIZE, offset, token)
        .then((grouped) => {
          const next: Record<string, { sourceCount: number; members: Article[] }> = {};
          for (const row of grouped.rows) {
            if (row.kind !== 'cluster') continue;
            next[row.lead.id] = { sourceCount: row.sourceCount, members: row.members };
            // Members share the badge, so whichever one is front still shows it.
            for (const m of row.members) {
              next[m.id] = { sourceCount: row.sourceCount, members: row.members };
            }
          }
          setClusters((prev) => ({ ...prev, ...next }));
        })
        .catch(() => {});
      if (replace) {
        setArticles(data);
        offsetRef.current = data.length;
        setDeckIndex(0);
      } else {
        setArticles((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...data.filter((a) => !seen.has(a.id))];
        });
        offsetRef.current += data.length;
      }
      hasMoreRef.current = data.length === PAGE_SIZE;
      setError(null);
    } catch (err) {
      setError(
        isNetworkFailure(err)
          ? 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت.'
          : 'تعذّر تحميل الأخبار. حاول مرة أخرى.',
      );
    }
  }, []);

  useEffect(() => {
    load(true).finally(() => setLoading(false));
  }, [load]);

  // A new category starts the deck over.
  useEffect(() => {
    setDeckIndex(0);
  }, [activeCategory]);

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || loadingMore) return;
    setLoadingMore(true);
    await load(false);
    setLoadingMore(false);
  }, [load, loadingMore]);

  const openArticle = useCallback(
    (a: Article) => {
      openSheet(a);
    },
    [openSheet],
  );

  const openSource = useCallback((a: Article) => {
    router.push({ pathname: '/source/[id]', params: { id: a.sourceId } });
  }, []);

  const shown =
    activeCategory === null ? articles : articles.filter((a) => a.category === activeCategory);

  if (loading) {
    return (
      <LinearGradient
        colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
        style={styles.root}
      >
        <SafeAreaView style={styles.center} edges={['top']}>
          <ActivityIndicator size="large" color={t.accent} />
        </SafeAreaView>
      </LinearGradient>
    );
  }

  if (error && articles.length === 0) {
    return (
      <LinearGradient
        colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
        style={styles.root}
      >
        <SafeAreaView style={styles.center} edges={['top']}>
          <Text style={[styles.errorText, { color: t.breaking }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: t.pillActiveBg }]}
            onPress={() => load(true)}
          >
            <Text style={[styles.retryText, { color: t.pillActiveText }]}>إعادة المحاولة</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.headerDate, { color: t.textMuted }]}>{todayLabel()}</Text>
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>مركز الأخبار</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.circleBtn, { backgroundColor: t.surface }]}
              onPress={() => router.push('/search')}
              accessibilityRole="button"
              accessibilityLabel="بحث"
            >
              <Ionicons name="search" size={18} color={t.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.circleBtn, { backgroundColor: t.surface }]}
              onPress={() => router.push('/account')}
              accessibilityRole="button"
              accessibilityLabel="حسابي"
            >
              <Ionicons name="person-outline" size={18} color={t.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <VerifyBanner t={t} />

        <CategoryPills t={t} active={activeCategory} onChange={setActiveCategory} />

        <View style={styles.deckArea}>
          {shown.length === 0 ? (
            <Text style={[styles.empty, { color: t.textMuted }]}>
              لا توجد أخبار في هذا التصنيف
            </Text>
          ) : (
            <>
              <HeroDeck
                articles={shown}
                index={Math.min(deckIndex, shown.length - 1)}
                onIndexChange={setDeckIndex}
                onNearEnd={loadMore}
                t={t}
                onPress={openArticle}
                onPressSource={openSource}
                clusterSources={Object.fromEntries(
                  Object.entries(clusters).map(([id, c]) => [id, c.sourceCount]),
                )}
                onPressCluster={(a) => setClusterArticle(a)}
              />
              <ClusterSheetHost
                t={t}
                article={clusterArticle}
                members={clusterArticle ? clusters[clusterArticle.id]?.members : undefined}
                onClose={() => setClusterArticle(null)}
              />
            </>
          )}
        </View>

        <FloatingDock t={t} active="home" />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerDate: { fontFamily: 'Cairo_400Regular', fontSize: 13, marginBottom: 2 },
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 26 },
  headerActions: { flexDirection: 'row', gap: 10 },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  deckArea: {
    flex: 1,
    marginTop: 14,
    // Clear the floating dock.
    paddingBottom: 100,
  },
  empty: { textAlign: 'center', marginTop: 40, fontFamily: 'Cairo_400Regular', fontSize: 14 },
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  retryText: { fontFamily: 'Cairo_600SemiBold' },
});
