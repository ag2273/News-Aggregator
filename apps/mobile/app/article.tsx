import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { fetchArticle } from '../lib/api';
import type { Article } from '../lib/api';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import { ArticleReader } from '../components/ArticleReader';

/** Deep-linkable article route (kept for direct links; card taps use the in-place sheet). */
export default function ArticleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setArticle(await fetchArticle(id));
      setError(null);
    } catch {
      setError('تعذّر تحميل الخبر. تحقق من الاتصال بالسيرفر.');
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: t.bgGradientMid }]}>
        <ActivityIndicator size="large" color={t.accent} />
      </View>
    );
  }

  if (error || !article) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: t.bgGradientMid }]}>
        <Text style={[styles.errorText, { color: t.breaking }]}>{error ?? 'الخبر غير موجود'}</Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: t.pillActiveBg }]}
          onPress={() => router.back()}
        >
          <Text style={[styles.retryText, { color: t.pillActiveText }]}>رجوع</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <ArticleReader
      article={article}
      t={t}
      onClose={() => router.back()}
      onReadFull={() =>
        router.push({ pathname: '/webview', params: { url: article.url, title: article.sourceName } })
      }
      onOpenSource={() =>
        router.push({ pathname: '/source/[id]', params: { id: article.sourceId } })
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999 },
  retryText: { fontFamily: 'Cairo_600SemiBold' },
});
