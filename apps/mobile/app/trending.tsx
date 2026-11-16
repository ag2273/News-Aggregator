import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { fetchTrending, relativeTime } from '../lib/api';
import type { Article } from '../lib/api';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';

export default function TrendingScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setArticles(await fetchTrending(20));
      setError(null);
    } catch {
      setError('تعذّر تحميل الترند. تحقق من الاتصال بالسيرفر.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const openArticle = useCallback((a: Article) => {
    router.push({ pathname: '/article', params: { url: a.url, title: a.title } });
  }, []);

  const renderItem = ({ item, index }: { item: Article; index: number }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => openArticle(item)}
      style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <Text style={[styles.rank, { color: t.textMuted }]}>{String(index + 1).padStart(2, '0')}</Text>
      <View style={styles.body}>
        <View style={styles.meta}>
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

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityLabel="رجوع">
          <Text style={[styles.backIcon, { color: t.textPrimary }]}>→</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]}>الأكثر تداولاً</Text>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.dockActiveGlow} />
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
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}
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
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 22, fontWeight: '700' },
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 20, flex: 1, textAlign: 'center' },
  list: { paddingHorizontal: 12, paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  rank: { fontFamily: 'Cairo_700Bold', fontSize: 24, width: 40, textAlign: 'center' },
  body: { flex: 1, paddingHorizontal: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sourceName: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  time: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  headline: { fontFamily: 'Cairo_600SemiBold', fontSize: 15, lineHeight: 23 },
  thumb: { width: 72, height: 72, borderRadius: 14 },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  thumbPlaceholderText: { fontSize: 26 },
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  retryText: { fontFamily: 'Cairo_600SemiBold' },
});
