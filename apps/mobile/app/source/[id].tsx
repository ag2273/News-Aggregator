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
import { router, useLocalSearchParams } from 'expo-router';
import { fetchFollows, fetchSourceArticles, followSource, unfollowSource } from '../../lib/api';
import type { Article, SourceMeta } from '../../lib/api';
import { palette } from '../../constants/colors';
import type { Theme } from '../../constants/colors';
import { FeedCard } from '../../components/FeedCard';
import { PublisherAvatar } from '../../components/Publisher';
import { FloatingDock } from '../../components/FloatingDock';
import { useArticleSheet } from '../../components/ArticleSheet';
import { useAuth } from '../../lib/auth';

export default function SourceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { user, token } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [source, setSource] = useState<SourceMeta | null>(null);
  const [followed, setFollowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
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

  // Sync follow state if user is logged in
  useEffect(() => {
    if (!token || !id) {
      setFollowed(false);
      return;
    }
    let cancelled = false;
    fetchFollows(token)
      .then((ids) => {
        if (!cancelled) setFollowed(ids.includes(id));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, id]);

  const handleToggleFollow = async () => {
    if (!user || !token) {
      router.push('/login');
      return;
    }
    if (!id || toggling) return;
    setToggling(true);
    try {
      if (followed) {
        await unfollowSource(id, token);
        setFollowed(false);
      } else {
        await followSource(id, token);
        setFollowed(true);
      }
    } catch {
      // Keep optimistic or current state
    } finally {
      setToggling(false);
    }
  };

  const { open: openSheet } = useArticleSheet();

  const openArticle = useCallback(
    (a: Article) => {
      openSheet(a);
    },
    [openSheet],
  );

  const sourceName = source?.name ?? id ?? 'المصدر';

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.circleBtn, { backgroundColor: t.surface }]}
            accessibilityLabel="رجوع"
          >
            <Ionicons name="arrow-forward" size={18} color={t.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: t.textPrimary }]} numberOfLines={1}>
            {sourceName}
          </Text>
          <View style={[styles.circleBtn, { backgroundColor: t.surface }]}>
            <Ionicons name="ellipsis-vertical" size={18} color={t.textPrimary} />
          </View>
        </View>

        <FlatList
          data={articles}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <FeedCard article={item} t={t} onPress={() => openArticle(item)} />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
          ListHeaderComponent={
            <View style={[styles.hero, { backgroundColor: t.surface }]}>
              <PublisherAvatar name={sourceName} size={72} t={t} />
              <View style={styles.heroNameRow}>
                <Text style={[styles.sourceNameBig, { color: t.textPrimary }]} numberOfLines={1}>
                  {sourceName}
                </Text>
                <Ionicons name="checkmark-circle" size={16} color={t.verified} />
              </View>
              <Text style={[styles.heroCount, { color: t.textMuted }]}>
                {loading ? 'جارٍ التحميل…' : `${articles.length} خبرًا من هذا المصدر`}
              </Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleToggleFollow}
                disabled={toggling}
                accessibilityRole="button"
                accessibilityState={{ selected: followed }}
                style={[
                  styles.followBtn,
                  followed
                    ? { backgroundColor: t.followedBg, borderWidth: 1, borderColor: t.borderLight }
                    : { backgroundColor: t.accent },
                  toggling && { opacity: 0.7 },
                ]}
              >
                <Text
                  style={[styles.followText, { color: followed ? t.followedText : '#FFFFFF' }]}
                >
                  {followed ? 'إلغاء المتابعة' : 'متابعة'}
                </Text>
              </TouchableOpacity>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator size="large" color={t.accent} style={{ marginTop: 32 }} />
            ) : (
              <Text style={[styles.empty, { color: error ? t.breaking : t.textMuted }]}>
                {error ?? 'لا توجد أخبار لهذا المصدر'}
              </Text>
            )
          }
        />

        <FloatingDock t={t} active="profile" />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerTitle: { fontFamily: 'Cairo_700Bold', fontSize: 18, flex: 1, textAlign: 'center', paddingHorizontal: 8 },
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
  hero: {
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingHorizontal: 8 },
  sourceNameBig: { fontFamily: 'Cairo_700Bold', fontSize: 19, flexShrink: 1 },
  heroCount: { fontFamily: 'Cairo_400Regular', fontSize: 12, marginTop: 4 },
  followBtn: { marginTop: 16, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 999 },
  followText: { fontFamily: 'Cairo_700Bold', fontSize: 13 },
  empty: { textAlign: 'center', marginTop: 32, fontFamily: 'Cairo_400Regular', fontSize: 14 },
});
