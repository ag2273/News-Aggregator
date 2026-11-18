import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
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
import { searchArticles, isNetworkFailure, type Article } from '../lib/api';
import { FeedCard } from '../components/FeedCard';
import { useArticleSheet } from '../components/ArticleSheet';

/** Delay between the last keystroke and the request. */
const DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { open: openSheet } = useArticleSheet();

  const [query, setQuery] = useState('');
  const [articles, setArticles] = useState<Article[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against an older response overwriting a newer one.
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    const requestId = ++requestIdRef.current;

    if (!trimmed) {
      setArticles([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { articles: found, total: count } = await searchArticles(trimmed, 50, 0);
      if (requestId !== requestIdRef.current) return;
      setArticles(found);
      setTotal(count);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setArticles([]);
      setTotal(0);
      setError(
        isNetworkFailure(err)
          ? 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت.'
          : 'تعذّر البحث. حاول مرة أخرى.',
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  // Debounced search; cancels the pending call on every keystroke.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const trimmed = query.trim();
  const showEmpty = !loading && !error && trimmed.length > 0 && articles.length === 0;

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
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>بحث</Text>
          <View style={styles.circleSpacer} />
        </View>

        <View style={[styles.searchBar, { backgroundColor: t.surface }]}>
          <Ionicons name="search" size={18} color={t.textMuted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="ابحث في الأخبار والمصادر"
            placeholderTextColor={t.textMuted}
            style={[styles.input, { color: t.textPrimary }]}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="البحث"
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="مسح البحث"
            >
              <Ionicons name="close-circle" size={18} color={t.textMuted} />
            </TouchableOpacity>
          ) : null}
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
              <FeedCard
                article={item}
                t={t}
                onPress={() => openSheet(item)}
                onPressSource={() =>
                  router.push({
                    pathname: '/source/[id]',
                    params: { id: item.sourceId, name: item.sourceName },
                  })
                }
              />
            )}
            ListHeaderComponent={
              articles.length > 0 ? (
                <Text style={[styles.resultCount, { color: t.textMuted }]}>
                  {total > articles.length
                    ? `${articles.length} من ${total} نتيجة`
                    : `${total} نتيجة`}
                </Text>
              ) : undefined
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              showEmpty ? (
                <View style={styles.emptyWrap}>
                  <View style={[styles.emptyIconWrap, { backgroundColor: t.surface }]}>
                    <Ionicons name="search-outline" size={36} color={t.textMuted} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>لا نتائج</Text>
                  <Text style={[styles.emptySub, { color: t.textMuted }]}>
                    جرّب كلمات أقل أو مختلفة
                  </Text>
                </View>
              ) : undefined
            }
          />
        )}

        {error && (
          <View style={[styles.errorToast, { backgroundColor: t.breaking }]}>
            <Text style={styles.errorToastText}>{error}</Text>
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 18,
    textAlign: 'center',
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  circleSpacer: { width: 38 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 23,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  input: {
    flex: 1,
    fontFamily: 'Cairo_400Regular',
    fontSize: 14,
    paddingVertical: 0,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 120,
  },
  resultCount: {
    fontFamily: 'Cairo_600SemiBold',
    fontSize: 12,
    marginBottom: 10,
  },
  separator: { height: 16 },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  emptyTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 17,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorToast: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  errorToastText: {
    fontFamily: 'Cairo_600SemiBold',
    color: '#FFFFFF',
    fontSize: 12,
  },
});
