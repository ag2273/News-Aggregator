import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
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
import { router } from 'expo-router';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import {
  fetchFollowingFeed,
  fetchFollows,
  fetchSources,
  unfollowSource,
  type Article,
  type Source,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import { FeedCard } from '../components/FeedCard';
import { PublisherAvatar } from '../components/Publisher';
import { FloatingDock } from '../components/FloatingDock';
import { useArticleSheet } from '../components/ArticleSheet';

export default function SourcesScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { user, token, loading: authLoading } = useAuth();
  const { open: openSheet } = useArticleSheet();

  const [followedIds, setFollowedIds] = useState<string[]>([]);
  const [allSources, setAllSources] = useState<Source[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      const [sourcesList, ids, feedArticles] = await Promise.all([
        fetchSources().catch(() => []),
        fetchFollows(token),
        fetchFollowingFeed(token, 50, 0),
      ]);
      setAllSources(sourcesList);
      setFollowedIds(ids);
      setArticles(feedArticles);
    } catch {
      setError('تعذّر تحميل الأخبار المتابعة. تحقق من الاتصال.');
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setLoading(false);
      return;
    }
    loadData().finally(() => setLoading(false));
  }, [authLoading, token, loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleUnfollow = async (sourceId: string) => {
    if (!token) return;
    try {
      const updated = await unfollowSource(sourceId, token);
      setFollowedIds(updated);
      setArticles((prev) => prev.filter((a) => a.sourceId !== sourceId));
    } catch {
      // Ignore failure
    }
  };

  const followedSources = allSources.filter((s) => followedIds.includes(s.id));

  // --- Logged-out state ---
  if (!authLoading && !user) {
    return (
      <LinearGradient
        colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
        style={styles.root}
      >
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={[styles.circleBtn, { backgroundColor: t.surface }]}
              accessibilityRole="button"
              accessibilityLabel="رجوع"
            >
              <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>مصادري</Text>
            <View style={styles.circleSpacer} />
          </View>

          <View style={styles.loggedOutCenter}>
            <View style={[styles.card, { backgroundColor: t.surface }]}>
              <View style={[styles.avatarIconWrap, { backgroundColor: t.pillInactiveBg }]}>
                <Ionicons name="newspaper-outline" size={40} color={t.accent} />
              </View>

              <Text style={[styles.cardTitle, { color: t.textPrimary }]}>
                سجّل الدخول لمتابعة مصادرك
              </Text>
              <Text style={[styles.cardSub, { color: t.textMuted }]}>
                تابع مصادرك الإخبارية المفضلة لتظهر مقالاتها في هذه التغذية المخصصة
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: t.accent }]}
                onPress={() => router.push('/login')}
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnText}>تسجيل الدخول</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FloatingDock t={t} active="profile" />
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.circleBtn, { backgroundColor: t.surface }]}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.headerTitle, { color: t.textPrimary }]}>مصادري</Text>
            <Text style={[styles.headerSub, { color: t.accent }]}>المتابعة</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/account')}
            style={[styles.circleBtn, { backgroundColor: t.surface }]}
            accessibilityRole="button"
            accessibilityLabel="حسابي"
          >
            <Ionicons name="person-outline" size={18} color={t.textPrimary} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : (
          <FlatList
            data={articles}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <FeedCard article={item} t={t} onPress={() => openSheet(item)} />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={t.accent} />
            }
            ListHeaderComponent={
              <View style={styles.listHeader}>
                {/* Followed sources chips row */}
                <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>المصادر المتابعة</Text>
                {followedSources.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.sourcesScroll}
                  >
                    {followedSources.map((s) => (
                      <View
                        key={s.id}
                        style={[
                          styles.sourceChip,
                          { backgroundColor: t.surface, borderColor: t.borderLight },
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.chipInfo}
                          onPress={() =>
                            router.push({ pathname: '/source/[id]', params: { id: s.id } })
                          }
                          accessibilityRole="button"
                        >
                          <PublisherAvatar name={s.name} size={28} t={t} />
                          <Text style={[styles.chipName, { color: t.textPrimary }]}>{s.name}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleUnfollow(s.id)}
                          style={styles.unfollowIconBtn}
                          accessibilityRole="button"
                          accessibilityLabel="إلغاء المتابعة"
                        >
                          <Ionicons name="close-circle" size={18} color={t.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={[styles.emptySourcesCard, { backgroundColor: t.surface }]}>
                    <Text style={[styles.emptySourcesText, { color: t.textMuted }]}>
                      لم تتابع أي مصادر بعد. افتح أي صفحة مصدر واضغط "متابعة".
                    </Text>
                  </View>
                )}

                <Text style={[styles.sectionTitle, { color: t.textPrimary, marginTop: 22 }]}>
                  المتابعة ({articles.length})
                </Text>
              </View>
            }
            ListEmptyComponent={
              <View style={[styles.emptyFeedWrap, { backgroundColor: t.surface }]}>
                <Ionicons name="newspaper-outline" size={40} color={t.textMuted} />
                <Text style={[styles.emptyFeedTitle, { color: t.textPrimary }]}>
                  {error ?? (followedIds.length === 0 ? 'لا توجد مصادر متابعة' : 'لا توجد أخبار جديدة')}
                </Text>
                <Text style={[styles.emptyFeedSub, { color: t.textMuted }]}>
                  {followedIds.length === 0
                    ? 'تابع مصادرك المفضلة لتظهر أحدث أخبارها هنا في الوقت الفعلي'
                    : 'سيتم تحديث الأخبار فور صدورها من المصادر التي تتابعها'}
                </Text>
              </View>
            }
          />
        )}

        <FloatingDock t={t} active="profile" />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitleWrap: { alignItems: 'center' },
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 18 },
  headerSub: { fontFamily: 'Cairo_600SemiBold', fontSize: 12, marginTop: -2 },
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
  circleSpacer: { width: 44 },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  listHeader: { marginBottom: 12 },
  sectionTitle: { fontFamily: 'Cairo_700Bold', fontSize: 16, marginBottom: 10 },
  sourcesScroll: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  chipInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipName: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  unfollowIconBtn: { padding: 2 },
  emptySourcesCard: {
    padding: 16,
    borderRadius: 18,
    alignItems: 'center',
  },
  emptySourcesText: { fontFamily: 'Cairo_400Regular', fontSize: 13, textAlign: 'center' },
  emptyFeedWrap: {
    marginTop: 20,
    padding: 28,
    borderRadius: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  emptyFeedTitle: { fontFamily: 'Cairo_700Bold', fontSize: 16, marginTop: 12, marginBottom: 6 },
  emptyFeedSub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
  },
  loggedOutCenter: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  card: {
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  avatarIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cardTitle: { fontFamily: 'Cairo_700Bold', fontSize: 20, marginBottom: 8, textAlign: 'center' },
  cardSub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  primaryBtn: {
    width: '100%',
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  primaryBtnText: { color: '#FFFFFF', fontFamily: 'Cairo_700Bold', fontSize: 15 },
});
