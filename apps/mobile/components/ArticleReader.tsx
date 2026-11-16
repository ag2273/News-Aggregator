import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { fullDate, relativeTime } from '../lib/api';
import type { Article } from '../lib/api';
import type { Theme } from '../constants/colors';
import { PublisherAvatar } from './Publisher';

const CATEGORY_AR: Record<string, string> = {
  egypt: 'مصر',
  economy: 'اقتصاد',
  sports: 'رياضة',
  health: 'صحة',
  tech: 'تكنولوجيا',
  misc: 'منوعات',
};

/**
 * Native reader: edge-to-edge cover image + frosted header, then a white sheet
 * with 36px top corners (source, title, exact date, summary, read-more).
 * Shared by the /article route and the in-place sheet.
 */
export function ArticleReader({
  article,
  t,
  onClose,
  onReadFull,
  onOpenSource,
  variant = 'screen',
}: {
  article: Article;
  t: Theme;
  onClose: () => void;
  onReadFull: () => void;
  onOpenSource?: () => void;
  /** 'sheet' = 3/4-height card with a pinned read-more button; 'screen' = full page. */
  variant?: 'screen' | 'sheet';
}) {
  const inSheet = variant === 'sheet';

  const readMore = (
    <TouchableOpacity
      style={[styles.openWebBtn, { borderColor: t.borderLight }]}
      onPress={onReadFull}
      accessibilityRole="button"
    >
      <Text style={[styles.openWebText, { color: t.textPrimary }]}>
        اقرأ الخبر كاملًا من المصدر
      </Text>
      <Ionicons name="open-outline" size={16} color={t.textPrimary} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.articleRoot, inSheet && styles.sheetRoot]}>
      <View style={styles.heroWrap}>
        {article.imageUrl ? (
          <Image source={{ uri: article.imageUrl }} style={styles.heroImage} resizeMode="cover" />
        ) : (
          <LinearGradient colors={[t.bgGradientBottom, t.bgGradientTop]} style={styles.heroImage} />
        )}

        <SafeAreaView style={styles.heroHeader} edges={['top']}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.frostedBtn}
            accessibilityRole="button"
            accessibilityLabel="رجوع"
          >
            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.heroTitleWrap}>
            <Text style={styles.heroCategoryTitle}>
              {CATEGORY_AR[article.category] ?? 'الأخبار'}
            </Text>
            <View style={styles.dotsRow}>
              <View style={[styles.dot, styles.dotActive]} />
              <View style={styles.dot} />
              <View style={styles.dot} />
            </View>
          </View>

          <View style={styles.frostedBtn}>
            <Ionicons name="ellipsis-vertical" size={18} color="#FFFFFF" />
          </View>
        </SafeAreaView>
      </View>

      <View
        style={[
          styles.sheetPane,
          { backgroundColor: t.surface },
        ]}
      >
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={[
            styles.bottomSheetContent,
            inSheet && styles.bottomSheetContentSheet,
          ]}
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.sheetPublisherRow}>
          <TouchableOpacity
            style={styles.publisherInfo}
            activeOpacity={0.7}
            onPress={onOpenSource}
            disabled={!onOpenSource}
          >
            <PublisherAvatar name={article.sourceName} size={42} t={t} />
            <View>
              <View style={styles.nameVerifiedRow}>
                <Text style={[styles.sheetPublisherName, { color: t.textPrimary }]}>
                  {article.sourceName}
                </Text>
                <Ionicons name="checkmark-circle" size={14} color={t.verified} />
              </View>
              <Text style={[styles.timestamp, { color: t.textMuted }]}>
                {relativeTime(article.publishedAt)}
              </Text>
            </View>
          </TouchableOpacity>
          <View style={[styles.sheetIconBtn, { backgroundColor: t.pillInactiveBg }]}>
            <Ionicons name="share-outline" size={18} color={t.textPrimary} />
          </View>
        </View>

        <Text style={[styles.sheetTitle, { color: t.textPrimary }]}>{article.title} 🔥</Text>

        <Text style={[styles.sheetDate, { color: t.textMuted }]}>
          {fullDate(article.publishedAt)}
        </Text>

        {/* Real metadata only: source + category. No invented author or like counts. */}
        <View style={[styles.metaRow, { borderColor: t.borderLight }]}>
          <Text style={[styles.metaText, { color: t.textSecondary }]}>{article.sourceName}</Text>
          <Text style={[styles.metaDot, { color: t.textMuted }]}>•</Text>
          <Text style={[styles.metaText, { color: t.textSecondary }]}>
            {CATEGORY_AR[article.category] ?? 'منوعات'}
          </Text>
        </View>

        {article.summary ? (
          <Text style={[styles.bodyParagraph, { color: t.textSecondary }]}>{article.summary}</Text>
        ) : (
          <Text style={[styles.bodyParagraph, { color: t.textMuted }]}>
            لا يتوفّر مقتطف لهذا الخبر. افتح الخبر من المصدر لقراءته كاملًا.
          </Text>
        )}

        {inSheet ? (
          <SafeAreaView
            edges={['bottom']}
            style={[styles.ctaBar, { backgroundColor: t.surface, borderTopColor: t.borderLight }]}
          >
            {readMore}
          </SafeAreaView>
        ) : (
          readMore
        )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  articleRoot: { flex: 1, backgroundColor: '#000000' },
  sheetRoot: { backgroundColor: 'transparent' },
  heroWrap: { height: '46%', width: '100%', position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  frostedBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitleWrap: { alignItems: 'center' },
  heroCategoryTitle: {
    color: '#FFFFFF',
    fontFamily: 'Cairo_700Bold',
    fontSize: 16,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 6,
  },
  dotsRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { width: 14, backgroundColor: '#FFFFFF' },
  sheetPane: {
    flex: 1,
    marginTop: -30,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: 'hidden',
  },
  sheetScroll: { flex: 1 },
  ctaBar: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomSheetContent: { padding: 22, paddingBottom: 48 },
  bottomSheetContentSheet: { paddingBottom: 12 },
  sheetPublisherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  publisherInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  nameVerifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sheetPublisherName: { fontFamily: 'Cairo_700Bold', fontSize: 15 },
  timestamp: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  sheetIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: { fontFamily: 'Cairo_700Bold', fontSize: 21, lineHeight: 31, marginBottom: 8 },
  sheetDate: { fontFamily: 'Cairo_400Regular', fontSize: 13, marginBottom: 14 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
  },
  metaText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  metaDot: { fontSize: 14 },
  bodyParagraph: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 15,
    lineHeight: 27,
    marginBottom: 20,
  },
  openWebBtn: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  openWebText: { fontFamily: 'Cairo_600SemiBold', fontSize: 14 },
});
