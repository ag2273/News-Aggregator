import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { useAuth } from '../lib/auth';
import { useArticleSheet } from '../components/ArticleSheet';
import { FloatingDock } from '../components/FloatingDock';
import {
  fetchDigest,
  fetchDigestPrefs,
  saveDigestTopics,
  DIGEST_TOPIC_LABEL,
  type DigestItem,
  type DigestResponse,
  type DigestTopic,
} from '../lib/api';

/** "09:00" → "٩:٠٠ ص" is overkill; show the Cairo slot as the app writes times. */
function slotLabel(slot: string | null): string {
  if (!slot) return '';
  const time = slot.split('T')[1] ?? '';
  return time === '18:00' ? '٦ مساءً' : '٩ صباحًا';
}

/**
 * الخلاصة: the twice-daily digest.
 *
 * The server builds the digest; this screen only filters nothing and renders
 * nothing it was not given. If the last build failed the server still serves the
 * previous digest with its own slot, and `stale` is true only when no digest has
 * ever been built — in which case the screen says so instead of showing an empty
 * page that looks broken.
 */
export default function DigestScreen() {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { token, user } = useAuth();
  const sheet = useArticleSheet();

  const [data, setData] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await fetchDigest(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل الخلاصة');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const openItem = (item: DigestItem) => {
    // The digest item is a real article, so it opens in the same reader as a card.
    sheet.open({
      id: item.articleId,
      title: item.title,
      summary: item.summary,
      imageUrl: null,
      url: item.url,
      sourceId: item.sourceId,
      sourceName: item.sourceName,
      category: item.category,
      country: 'EG',
      publishedAt: item.publishedAt,
      isBreaking: item.isBreaking,
    });
  };

  const header = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
          style={styles.back}
        >
          <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: t.textPrimary }]}>الخلاصة</Text>
        <TouchableOpacity
          onPress={() => router.push('/digest-topics')}
          accessibilityRole="button"
          accessibilityLabel="اختيار المواضيع"
          style={styles.back}
        >
          <Ionicons name="options-outline" size={22} color={t.textPrimary} />
        </TouchableOpacity>
      </View>
      {data && !data.stale ? (
        <Text style={[styles.sub, { color: t.textMuted }]}>
          خلاصة {slotLabel(data.slot)} — {data.items.length} أخبار مختارة
        </Text>
      ) : null}
    </View>
  );

  return (
    <LinearGradient
      colors={[t.bgGradientTop, t.bgGradientMid, t.bgGradientBottom]}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        {header}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={28} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textSecondary }]}>{error}</Text>
            <TouchableOpacity onPress={load} style={[styles.retry, { borderColor: t.borderLight }]}>
              <Text style={{ color: t.accent }}>حاول مرة أخرى</Text>
            </TouchableOpacity>
          </View>
        ) : data?.stale ? (
          <View style={styles.center}>
            <Ionicons name="newspaper-outline" size={30} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>الخلاصة لسه مجهزة</Text>
            <Text style={[styles.emptyBody, { color: t.textMuted }]}>
              بنجهز خلاصة جديدة كل يوم الساعة ٩ صباحًا و٦ مساءً. ارجع بعد شوية.
            </Text>
          </View>
        ) : data && data.items.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="funnel-outline" size={28} color={t.textMuted} />
            <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>
              مفيش أخبار في مواضيعك
            </Text>
            <Text style={[styles.emptyBody, { color: t.textMuted }]}>
              جرّب تفعيل مواضيع أكتر من إعدادات الخلاصة.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/digest-topics')}
              style={[styles.retry, { borderColor: t.accent }]}
            >
              <Text style={{ color: t.accent }}>اختيار المواضيع</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />
            }
          >
            {!user ? (
              <View style={[styles.note, { backgroundColor: t.surfaceSubtle }]}>
                <Ionicons name="information-circle-outline" size={16} color={t.textMuted} />
                <Text style={[styles.noteText, { color: t.textMuted }]}>
                  دي مواضيع عامة. سجّل الدخول عشان تختار مواضيعك.
                </Text>
              </View>
            ) : null}
            {data?.items.map((item) => (
              <TouchableOpacity
                key={item.articleId}
                style={[styles.card, { backgroundColor: t.surface }]}
                onPress={() => openItem(item)}
                accessibilityRole="button"
                accessibilityLabel={item.title}
              >
                <View style={styles.cardTop}>
                  {item.isBreaking ? (
                    <Text style={[styles.chip, { color: t.breaking, backgroundColor: t.breakingBg }]}>
                      عاجل
                    </Text>
                  ) : null}
                  <Text style={[styles.source, { color: t.textMuted }]}>
                    {item.sourceCount && item.sourceCount > 1
                      ? `${item.sourceName} · ${item.sourceCount} مصادر`
                      : item.sourceName}
                  </Text>
                  <Text style={[styles.topic, { color: t.accent }]}>
                    {DIGEST_TOPIC_LABEL[item.category]}
                  </Text>
                </View>
                <Text style={[styles.itemTitle, { color: t.textPrimary }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={[styles.summary, { color: t.textSecondary }]}>{item.summary}</Text>
                {item.why ? (
                  <View style={styles.whyRow}>
                    <Ionicons name="bulb-outline" size={13} color={t.accent} />
                    <Text style={[styles.why, { color: t.textMuted }]}>{item.why}</Text>
                  </View>
                ) : null}
                {item.textSource === 'snippet' ? (
                  // Honest provenance: this summary was written from the feed excerpt.
                  <Text style={[styles.provenance, { color: t.textMuted }]}>
                    ملخص من المقتطف — المصدر لم يسمح بقراءة المقال كاملًا
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        <FloatingDock t={t} active="digest" />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 13, lineHeight: 22, textAlign: 'center' },
  retry: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 14, borderWidth: 1 },
  list: { padding: 16, gap: 12, paddingBottom: 110 },
  card: { borderRadius: 18, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  chip: { fontSize: 10, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  source: { fontSize: 11 },
  topic: { fontSize: 11, marginInlineStart: 'auto' },
  itemTitle: { fontSize: 15, fontWeight: '700', lineHeight: 23 },
  summary: { fontSize: 13, lineHeight: 22, marginTop: 6 },
  whyRow: { flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'flex-start' },
  why: { fontSize: 11, lineHeight: 18, flex: 1 },
  provenance: { fontSize: 10, marginTop: 8 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 14 },
  noteText: { fontSize: 12, flex: 1, lineHeight: 18 },
});
