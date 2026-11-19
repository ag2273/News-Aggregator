import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ReactionsBar } from './Reactions';
import { useAccountGate, AccountGateSheet } from './AccountGate';
import { shareArticle } from '../lib/share';
import { fetchReactions, isEmailNotVerified } from '../lib/api';
import { publishReactions, currentRevision } from '../lib/reactionStore';
import { VerificationGate } from './VerificationGate';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  fetchIsArticleSaved,
  fullDate,
  relativeTime,
  saveArticle,
  unsaveArticle,
} from '../lib/api';
import type { Article } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  onScrollTopChange,
  scrollEnabled = true,
}: {
  article: Article;
  t: Theme;
  onClose: () => void;
  onReadFull: () => void;
  onOpenSource?: () => void;
  /** 'sheet' = 3/4-height card with a pinned read-more button; 'screen' = full page. */
  variant?: 'screen' | 'sheet';
  /** Notifies parent when the scroll view is at the top edge (contentOffset.y <= 2). */
  onScrollTopChange?: (isAtTop: boolean) => void;
  /** Allows parent gesture handler to lock scrolling during an active sheet drag. */
  scrollEnabled?: boolean;
}) {
  const inSheet = variant === 'sheet';
  const isAtTopRef = useRef(true);
  const { user, token, emailVerified } = useAuth();
  const gate = useAccountGate();
  const [saved, setSaved] = useState(false);
  const [togglingSaved, setTogglingSaved] = useState(false);

  useEffect(() => {
    if (!token || !article.id) {
      setSaved(false);
      return;
    }
    let cancelled = false;
    fetchIsArticleSaved(article.id, token)
      .then((isSaved) => {
        if (!cancelled) setSaved(isSaved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, article.id]);

  const handleToggleBookmark = useCallback(async () => {
    // Guest → sign-in sheet (not the verification one); unverified → verify.
    if (!user || !token) {
      gate.openWith('signin');
      return;
    }
    if (!emailVerified) {
      gate.openWith('verify');
      return;
    }
    if (!article.id || togglingSaved) return;
    setTogglingSaved(true);
    try {
      if (saved) {
        await unsaveArticle(article.id, token);
        setSaved(false);
      } else {
        await saveArticle(article.id, token);
        setSaved(true);
      }
    } catch (err) {
      if (isEmailNotVerified(err)) {
        setSaved(false);
        gate.openWith('verify');
      }
      // Otherwise keep the current state.
    } finally {
      setTogglingSaved(false);
    }
  }, [user, token, emailVerified, gate, article.id, togglingSaved, saved]);

  // Counts shown in the reader come from a fresh fetch, never from the feed
  // payload the card was rendered with: that payload is a snapshot from when the
  // feed loaded, possibly fetched as a different account.
  const [liveArticle, setLiveArticle] = useState(article);
  const fetchFloor = useRef(0);
  useEffect(() => {
    setLiveArticle(article);
    if (!article.id) return;
    let cancelled = false;
    // Capture the revision BEFORE the request: anything published while it is in
    // flight (e.g. the user's own reaction) wins over this response.
    fetchFloor.current = currentRevision();
    fetchReactions(article.id, token)
      .then((r) => {
        if (cancelled) return;
        setLiveArticle((current) => ({
          ...current,
          reactions: r.counts,
          myReaction: r.myReaction,
        }));
        // Share the truth with every card showing this article. The floor stops
        // a slow fetch from undoing a reaction written while it was in flight.
        publishReactions(article.id, { counts: r.counts, myReaction: r.myReaction }, fetchFloor.current);
      })
      .catch(() => {
        /* keep the snapshot; the bar still works with the server response */
      });
    return () => {
      cancelled = true;
    };
  }, [article, token]);

  const handleScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      const atTop = e.nativeEvent.contentOffset.y <= 2;
      if (atTop !== isAtTopRef.current) {
        isAtTopRef.current = atTop;
        onScrollTopChange?.(atTop);
      }
    },
    [onScrollTopChange],
  );

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
      <View style={[styles.heroWrap, inSheet && styles.heroWrapSheet]}>
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

          <TouchableOpacity
            onPress={handleToggleBookmark}
            disabled={togglingSaved}
            style={[styles.frostedBtn, saved && { backgroundColor: t.accent }]}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'إزالة من المحفوظات' : 'حفظ المقال'}
          >
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={18} color="#FFFFFF" />
          </TouchableOpacity>
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
          scrollEnabled={scrollEnabled}
          bounces={!inSheet}
          scrollEventThrottle={16}
          onScroll={handleScroll}
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
          <View style={styles.sheetActionsRow}>
            <TouchableOpacity
              onPress={handleToggleBookmark}
              disabled={togglingSaved}
              style={[
                styles.sheetIconBtn,
                { backgroundColor: saved ? t.accent : t.pillInactiveBg },
                togglingSaved && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'إزالة من المحفوظات' : 'حفظ المقال'}
            >
              <Ionicons
                name={saved ? 'bookmark' : 'bookmark-outline'}
                size={18}
                color={saved ? '#FFFFFF' : t.textPrimary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetIconBtn, { backgroundColor: t.pillInactiveBg }]}
              onPress={() => {
                shareArticle(article).catch(() => {});
              }}
              accessibilityRole="button"
              accessibilityLabel="مشاركة الخبر"
            >
              <Ionicons name="share-social-outline" size={18} color={t.textPrimary} />
            </TouchableOpacity>
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

        {/* تفاعلات القراء — تحت النص وقبل زر القراءة الكاملة */}
        <ReactionsBar
          t={t}
          article={liveArticle}
          onNeedVerification={() => gate.openWith('verify')}
          onNeedSignIn={() => gate.openWith('signin')}
        />

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

      <AccountGateSheet t={t} gate={gate} />
    </View>
  );
}

const styles = StyleSheet.create({
  gateBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  gateSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    minHeight: 340,
    paddingTop: 8,
    paddingBottom: 28,
  },
  gateClose: { alignSelf: 'flex-start', padding: 12 },
  articleRoot: { flex: 1, backgroundColor: '#000000' },
  sheetRoot: { backgroundColor: 'transparent' },
  heroWrap: { height: '46%', width: '100%', position: 'relative' },
  // Inside the 3/4 sheet the cover is half as tall, leaving more room for text.
  heroWrapSheet: { height: '23%' },
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
  sheetActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
