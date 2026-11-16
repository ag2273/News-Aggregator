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
import { router, useLocalSearchParams } from 'expo-router';
import { fetchSourceArticles, relativeTime } from '../../lib/api';
import type { Article, SourceMeta } from '../../lib/api';
import { palette } from '../../constants/colors';
import type { Theme } from '../../constants/colors';

export default function SourceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const [articles, setArticles] = useState<Article[]>([]);
  const [source, setSource] = useState<SourceMeta | null>(null);
  const [followed, setFollowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetchSourceArticles(id, 50, 0);
      setSource(res.source);
      setArticles(res.articles);
      setError(null);
    } catch {
      setError('تعذّر تحميل أخبار المصدر. تحقق من الاتصال بالسيرفر.');
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
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

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityLabel="رجوع">
          <Text style={[styles.backIcon, { color: t.textPrimary }]}>→</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]} numberOfLines={1}>
          {source?.name ?? id ?? 'المصدر'}
        </Text>
        <View style={styles.back} />
      </View>

      {/* Source hero + follow */}
      <View style={[styles.hero, { backgroundColor: t.surface, borderColor: t.border }]}>
        <View style={[styles.avatar, { backgroundColor: t.surfaceSubtle }]}>
          <Ionicons name="newspaper-outline" size={34} color={t.accent} />
        </View>
        <Text style={[styles.sourceNameBig, { color: t.textPrimary }]}>{source?.name ?? id ?? 'المصدر'}</Text>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setFollowed((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ selected: followed }}
          style={[
            styles.followBtn,
            followed ? { backgroundColor: t.followedBg } : { backgroundColor: t.pillActiveBg },
          ]}
        >
          <Text style={[styles.followText, { color: followed ? t.followedText : t.pillActiveText }]}>
            {followed ? 'مُتابَع ✓' : '+ متابعة المصدر'}
          </Text>
        </TouchableOpacity>
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
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 20, flex: 1, textAlign: 'center', paddingHorizontal: 8 },
  hero: {
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  sourceNameBig: { fontFamily: 'Cairo_700Bold', fontSize: 18, marginBottom: 14, textAlign: 'center' },
  followBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 999 },
  followText: { fontFamily: 'Cairo_700Bold', fontSize: 13 },
  list: { paddingHorizontal: 12, paddingBottom: 32 },
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
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  retryText: { fontFamily: 'Cairo_600SemiBold' },
});
