import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import { fetchTrending, isNetworkFailure } from '../lib/api';
import type { Article } from '../lib/api';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import { FeedCard } from '../components/FeedCard';
import { FloatingDock } from '../components/FloatingDock';
import { useArticleSheet } from '../components/ArticleSheet';

export default function TrendingScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setArticles(await fetchTrending(20));
      setError(null);
    } catch (err) {
      setError(
        isNetworkFailure(err)
          ? 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت.'
          : 'تعذّر تحميل الترند. حاول مرة أخرى.',
      );
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const { open: openSheet } = useArticleSheet();

  const openArticle = useCallback(
    (a: Article) => {
      openSheet(a);
    },
    [openSheet],
  );

  const openSource = useCallback((a: Article) => {
    router.push({ pathname: '/source/[id]', params: { id: a.sourceId } });
  }, []);

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.root} edges={['top']}>
        {/* Screen header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.circleBtn, { backgroundColor: t.surface }]}
            accessibilityLabel="رجوع"
          >
            <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>الأكثر تداولاً</Text>
          <View style={[styles.circleBtn, { backgroundColor: t.surface }]}>
            <Ionicons name="ellipsis-vertical" size={18} color={t.textPrimary} />
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: t.breaking }]}>{error}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: t.pillActiveBg }]}
              onPress={load}
            >
              <Text style={[styles.retryText, { color: t.pillActiveText }]}>إعادة المحاولة</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={articles}
            keyExtractor={(a) => a.id}
            renderItem={({ item, index }) => (
              <FeedCard
                article={item}
                t={t}
                rank={index + 1}
                onPress={() => openArticle(item)}
                onPressSource={() => openSource(item)}
              />
            )}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          />
        )}

        <FloatingDock t={t} active="video" />
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
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 18 },
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
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  retryText: { fontFamily: 'Cairo_600SemiBold' },
});
