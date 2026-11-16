import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { fetchFeed, relativeTime } from '../lib/api';
import type { Article } from '../lib/api';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';

const PAGE_SIZE = 30;
const CATEGORY_PILLS: Array<{ id: string | null; label: string }> = [
  { id: null, label: 'كل الأخبار' },
  { id: 'egypt', label: 'مصر' },
  { id: 'economy', label: 'اقتصاد' },
  { id: 'sports', label: 'رياضة' },
  { id: 'tech', label: 'تكنولوجيا' },
];

export default function FeedScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const [articles, setArticles] = useState<Article[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);

  const load = useCallback(async (replace: boolean) => {
    try {
      const offset = replace ? 0 : offsetRef.current;
      const data = await fetchFeed(PAGE_SIZE, offset);
      if (replace) {
        setArticles(data);
        offsetRef.current = data.length;
      } else {
        setArticles((prev) => [...prev, ...data]);
        offsetRef.current += data.length;
      }
      hasMoreRef.current = data.length === PAGE_SIZE;
      setError(null);
    } catch {
      setError('تعذّر تحميل الأخبار. تحقق من الاتصال بالسيرفر.');
    }
  }, []);

  React.useEffect(() => {
    load(true).finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const openArticle = useCallback((a: Article) => {
    router.push({ pathname: '/article', params: { url: a.url, title: a.title } });
  }, []);

  const renderItem = ({ item }: { item: Article }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => openArticle(item)}
      style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View style={styles.cardBody}>
        <View style={styles.cardMeta}>
          <Text style={[styles.sourceName, { color: t.accent }]} numberOfLines={1}>
            {item.sourceName}
          </Text>
          <Text style={[styles.time, { color: t.textMuted }]}>{relativeTime(item.publishedAt)}</Text>
        </View>
        <Text style={[styles.headline, { color: t.textPrimary }]} numberOfLines={3}>
          {item.title}
        </Text>
      </View>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: t.surfaceSubtle }]}>
          <Text style={styles.thumbPlaceholderText}>📰</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: t.background }]}>
        <ActivityIndicator size="large" color={t.dockActiveGlow} />
      </SafeAreaView>
    );
  }

  if (error && articles.length === 0) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: t.background }]}>
        <Text style={[styles.errorText, { color: t.breaking }]}>{error}</Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: t.pillActiveBg }]}
          onPress={() => load(true)}
        >
          <Text style={[styles.retryText, { color: t.pillActiveText }]}>إعادة المحاولة</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerDate, { color: t.textMuted }]}>رئيس التحرير</Text>
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>مركز الأخبار</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={[styles.circleBtn, { backgroundColor: t.surface }]}>
            <Ionicons name="search" size={18} color={t.textSecondary} />
          </View>
          <View style={[styles.circleBtn, { backgroundColor: t.surface }]}>
            <Ionicons name="notifications-outline" size={18} color={t.textSecondary} />
          </View>
        </View>
      </View>

      {/* Category pills */}
      <View style={styles.pills}>
        {CATEGORY_PILLS.map((c) => {
          const active = c.id === activeCategory;
          return (
            <TouchableOpacity
              key={c.id ?? 'all'}
              onPress={() => setActiveCategory(c.id)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.pill,
                active
                  ? { backgroundColor: t.pillActiveBg }
                  : { backgroundColor: t.surfaceSubtle, borderColor: t.border, borderWidth: 1 },
              ]}
            >
              <Text style={[styles.pillText, { color: active ? t.pillActiveText : t.textSecondary }]}>
                {c.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>الأكثر قراءة الآن</Text>

      {/* Feed */}
      <FlatList
        data={activeCategory === null ? articles : articles.filter((a) => a.category === activeCategory)}
        keyExtractor={(a) => a.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: t.textMuted }]}>لا توجد أخبار في هذا التصنيف</Text>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.dockActiveGlow} />
        }
        onEndReached={() => {
          if (hasMoreRef.current) load(false);
        }}
        onEndReachedThreshold={0.5}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />

      {/* Floating capsule dock */}
      <View style={[styles.dock, { backgroundColor: t.dockBg, borderColor: t.border }]}>
        <View style={[styles.dockItem, styles.dockActive, { backgroundColor: t.dockActiveGlow }]}>
          <Ionicons name="home" size={20} color="#064E3B" />
        </View>
        <TouchableOpacity
          style={styles.dockItem}
          onPress={() => router.push('/trending')}
          accessibilityRole="button"
          accessibilityLabel="الأكثر تداولاً"
        >
          <Ionicons name="flame-outline" size={20} color={t.textMuted} />
        </TouchableOpacity>
        <View style={styles.dockItem}>
          <Ionicons name="bookmark-outline" size={20} color={t.textMuted} />
        </View>
        <View style={styles.dockItem}>
          <Ionicons name="person-outline" size={20} color={t.textMuted} />
        </View>
      </View>
    </SafeAreaView>
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
    paddingBottom: 12,
  },
  headerDate: { fontFamily: 'Cairo_400Regular', fontSize: 12, marginBottom: 2 },
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 24 },
  headerActions: { flexDirection: 'row', gap: 10 },
  circleBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pills: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  pill: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
  pillText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  sectionTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 17,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  list: { paddingHorizontal: 12, paddingBottom: 110 },
  card: {
    flexDirection: 'row',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardBody: { flex: 1, padding: 14, justifyContent: 'space-between' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sourceName: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  time: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  headline: { fontFamily: 'Cairo_600SemiBold', fontSize: 15, lineHeight: 23 },
  thumb: { width: 110, height: 110 },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  thumbPlaceholderText: { fontSize: 30 },
  dock: {
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: 300,
    height: 62,
    borderRadius: 31,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  dockItem: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dockActive: {},
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  empty: { textAlign: 'center', marginTop: 32, fontFamily: 'Cairo_400Regular', fontSize: 14 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  retryText: { fontFamily: 'Cairo_600SemiBold' },
});
