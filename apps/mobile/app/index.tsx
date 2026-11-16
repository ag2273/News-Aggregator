import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
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
import { fetchFeed } from '../lib/api';
import type { Article } from '../lib/api';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import { FeedCard } from '../components/FeedCard';
import { HeroDeck } from '../components/HeroDeck';
import { CategoryPills, SectionHeader } from '../components/Pills';
import { FloatingDock } from '../components/FloatingDock';

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

  useEffect(() => {
    load(true).finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const openArticle = useCallback((a: Article) => {
    router.push({ pathname: '/article', params: { id: a.id } });
  }, []);

  const openSource = useCallback((a: Article) => {
    router.push({ pathname: '/source/[id]', params: { id: a.sourceId } });
  }, []);

  const shown = activeCategory === null ? articles : articles.filter((a) => a.category === activeCategory);
  const deckArticles = shown.slice(0, 3);
  const listArticles = shown.slice(3);

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
        <FlatList
          data={listArticles}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <FeedCard
              article={item}
              t={t}
              onPress={() => openArticle(item)}
              onPressSource={() => openSource(item)}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />
          }
          onEndReached={() => {
            if (hasMoreRef.current) load(false);
          }}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            <View>
              {/* Header */}
              <View style={styles.header}>
                <View>
                  <Text style={[styles.headerDate, { color: t.textMuted }]}>{todayLabel()}</Text>
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
              <CategoryPills t={t} active={activeCategory} onChange={setActiveCategory} />

              {/* Section header */}
              <SectionHeader
                t={t}
                title="الأكثر قراءة الآن"
                onAction={() => setActiveCategory(null)}
              />

              {/* Hero deck */}
              <HeroDeck
                articles={deckArticles}
                t={t}
                onPress={openArticle}
                onPressSource={openSource}
              />

              <SectionHeader t={t} title="آخر الأخبار" actionLabel="" />

              {listArticles.length === 0 ? (
                <Text style={[styles.empty, { color: t.textMuted }]}>
                  لا توجد أخبار في هذا التصنيف
                </Text>
              ) : null}
            </View>
          }
        />

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
    paddingBottom: 16,
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
  list: { paddingBottom: 120 },
  empty: { textAlign: 'center', marginTop: 12, fontFamily: 'Cairo_400Regular', fontSize: 14 },
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  retryText: { fontFamily: 'Cairo_600SemiBold' },
});
