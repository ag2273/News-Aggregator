import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { relativeTime } from '../lib/api';
import { deckStep, swipeOutcome } from '../lib/swipe';
import { PRELOAD_RADIUS, prefetchWindowCovers } from '../lib/preload';
import type { Article } from '../lib/api';
import { shareArticle } from '../lib/share';
import type { Theme } from '../constants/colors';
import { PublisherAvatar, PublisherMeta } from './Publisher';
import { ReactionsCapsule, ReactionPicker } from './Reactions';
import { useAccountGate, AccountGateSheet } from './AccountGate';

const FLY_OUT_MS = 260;
const SPRING = { damping: 20, stiffness: 200 };
/** Vertical lift of each card behind the front one. */
const PEEK = 12;
/** How many cards sit behind the front card. */
const DEPTH = 3;

/**
 * Full-screen swipe deck (Tinder-style). The front card fills the space it is
 * given; three card edges peek above it so the pile is obvious. Horizontal pan
 * advances; taps open the article sheet.
 *
 * Every card in the window is a real card (same `HeroCard` body, keyed by
 * article id) and is mounted at all times, including the three behind the front
 * one and the previous one. When the index advances the neighbour that was
 * already rendered simply becomes the front card through React reconciliation,
 * so its text and decoded cover are on screen the moment the flying card leaves
 * — no empty coloured rectangle, no reload, no blank image frame.
 */

/**
 * One deck card: publisher row → headline → cover → footer. Shared by the front
 * card and the neighbours so both carry identical content and the same React
 * instance survives an index change (a different element type would remount and
 * drop the decoded image).
 */
function HeroCard({
  article,
  t,
  hint,
  onPressSource,
  clusterCount,
  onPressCluster,
  interactive,
}: {
  article: Article;
  t: Theme;
  /** Footer instruction; only the front card shows one. */
  hint?: string;
  /** Only the front card is interactive; neighbours stay inert. */
  onPressSource?: () => void;
  /** Distinct outlets covering this story (>1 means it is a cluster). */
  clusterCount?: number;
  /** Opens the comparison sheet. Only the front card is interactive. */
  onPressCluster?: () => void;
  /** Front card only: the neighbour cards must not open their own sheets. */
  interactive?: boolean;
}) {
  // Stable source object per article: re-renders must not re-key the image.
  const coverSource = useMemo(
    () => (article.imageUrl ? { uri: article.imageUrl } : undefined),
    [article.imageUrl],
  );
  const gate = useAccountGate();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <View style={styles.cardBody}>
      <View style={styles.cardHeader}>
        <Pressable
          onPress={onPressSource}
          disabled={!onPressSource}
          style={styles.publisherRow}
          accessible
          accessibilityRole="button"
          accessibilityLabel={article.sourceName}
        >
          <PublisherAvatar name={article.sourceName} size={40} t={t} />
          <PublisherMeta
            name={article.sourceName}
            relative={relativeTime(article.publishedAt)}
            t={t}
          />
        </Pressable>
        <View style={styles.headerTrailing}>
          {article.isBreaking ? (
            <View style={[styles.breakingBadge, { backgroundColor: t.breaking }]}>
              <Text style={styles.breakingText}>عاجل</Text>
            </View>
          ) : null}
          {clusterCount && clusterCount > 1 ? (
            <Pressable
              onPress={onPressCluster}
              disabled={!onPressCluster}
              style={[
                styles.clusterBadge,
                { backgroundColor: 'rgba(52, 211, 153, 0.15)', borderColor: 'rgba(52, 211, 153, 0.35)' },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`تغطية من ${clusterCount} مصادر`}
            >
              <Ionicons name="layers-outline" size={12} color={t.accent} />
              <Text style={[styles.clusterBadgeText, { color: t.accent }]}>
                {`من ${clusterCount}`}
              </Text>
            </Pressable>
          ) : null}
          <View style={[styles.moreBtn, { backgroundColor: t.surfaceSubtle }]}>
            <Ionicons name="ellipsis-vertical" size={16} color={t.textMuted} />
          </View>
        </View>
      </View>

      <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={4}>
        {article.title} 🔥
      </Text>

      <View style={[styles.imageContainer, { backgroundColor: t.pillInactiveBg }]}>
        {coverSource ? (
          <Image
            source={coverSource}
            style={[StyleSheet.absoluteFill, styles.image]}
            resizeMode="cover"
          />
        ) : null}
      </View>

      <View style={[styles.metricsBar, { borderTopColor: t.borderLight }]}>
        <Text style={[styles.meta, { color: t.textMuted }]}>
          {relativeTime(article.publishedAt)}
        </Text>
        <View style={styles.hintRow}>
          <View
            pointerEvents={interactive ? 'auto' : 'none'}
            // Kept mounted on every card so the footer geometry — and therefore
            // the image height and the headline's wrap — is identical whether a
            // card is front or a neighbour. Only the front card is reachable.
            accessibilityElementsHidden={!interactive}
            importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
          >
            <ReactionsCapsule
              t={t}
              article={article}
              onPress={() => setPickerOpen(true)}
              onNeedVerification={() => gate.openWith('verify')}
              onNeedSignIn={() => gate.openWith('signin')}
            />
          </View>
          {clusterCount && clusterCount > 1 && onPressCluster ? (
            <Pressable
              onPress={onPressCluster}
              style={styles.clusterCta}
              accessibilityRole="button"
              accessibilityLabel={`عرض تغطية ${clusterCount} مصادر مختلفة`}
            >
              <Ionicons name="layers-outline" size={14} color={t.accent} />
              <Text style={[styles.clusterCtaText, { color: t.accent }]}>
                {`عرض تغطية ${clusterCount} مصادر مختلفة`}
              </Text>
            </Pressable>
          ) : null}
          {hint ? <Text style={[styles.hint, { color: t.textMuted }]}>{hint}</Text> : null}
          <TouchableOpacity
            onPress={() => {
              shareArticle(article).catch(() => {});
            }}
            style={styles.shareHit}
            accessibilityRole="button"
            accessibilityLabel="مشاركة الخبر"
          >
            <Ionicons name="share-social-outline" size={18} color={t.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick reaction picker, only on the front card: the neighbours share the
          same body but stay inert, so their sheets can never open. */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}
        >
          <View style={[styles.pickerSheet, { backgroundColor: t.surface }]}>
            <Text style={[styles.pickerTitle, { color: t.textPrimary }]}>تفاعل مع الخبر</Text>
            <ReactionPicker
              t={t}
              article={article}
              onNeedVerification={() => {
                setPickerOpen(false);
                gate.openWith('verify');
              }}
              onNeedSignIn={() => {
                setPickerOpen(false);
                gate.openWith('signin');
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <AccountGateSheet t={t} gate={gate} />
    </View>
  );
}
export function HeroDeck({
  articles,
  index,
  onIndexChange,
  onNearEnd,
  t,
  onPress,
  onPressSource,
  clusterSources,
  onPressCluster,
}: {
  articles: Article[];
  index: number;
  onIndexChange: (next: number) => void;
  /** Called when the deck is close to the end of the loaded articles. */
  onNearEnd?: () => void;
  t: Theme;
  onPress: (a: Article) => void;
  onPressSource?: (a: Article) => void;
  /** articleId -> number of distinct outlets covering the same story. */
  clusterSources?: Record<string, number>;
  /** Opens the source-comparison sheet for a clustered story. */
  onPressCluster?: (a: Article) => void;
}) {
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);
  const indexSV = useSharedValue(index);
  const totalSV = useSharedValue(articles.length);
  const isAnimating = useSharedValue(false);
  // Which neighbour the current drag uncovers. Set ONCE per gesture when the
  // drag passes a small threshold, then used as a static style value so nothing
  // animates underneath the finger.
  const [reveal, setReveal] = useState<'next' | 'prev'>('next');
  const revealArmed = useSharedValue(0);

  const armReveal = useCallback(
    (nextReveal: 'next' | 'prev') => {
      setReveal(nextReveal);
    },
    [],
  );

  const resetReveal = useCallback(() => {
    revealArmed.value = 0;
    setReveal('next');
  }, [revealArmed]);

  const front = articles[index];
  const frontRef = useRef(front);
  frontRef.current = front;

  // Neighbour cards, deepest first so the front card (painted last) stays on top.
  // The next and previous cards share the revealed slot geometry; the live drag
  // direction below decides which of them is actually uncovered.
  const neighbours = useMemo(() => {
    const list: { a: Article; slot: number; role: 'prev' | 'next' | 'deep' }[] = [];
    const deep = articles[index + 2];
    const prev = articles[index - 1];
    const next = articles[index + 1];
    if (deep) list.push({ a: deep, slot: 1, role: 'deep' });
    if (prev) list.push({ a: prev, slot: 0, role: 'prev' });
    if (next) list.push({ a: next, slot: 0, role: 'next' });
    return list;
  }, [articles, index]);
  const canNext = index + 1 < articles.length;
  const canPrev = index > 0;
  const hint = canNext ? 'اسحب للتالي' : canPrev ? 'اسحب للسابق' : undefined;

  // Track timestamp of publisher row tap to prevent triggering card body tap
  const lastSourcePressTimeRef = useRef(0);

  // Safety timeout ref to guarantee isAnimating never remains stuck if animation completion is dropped
  const animTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAnimTimeout = useCallback(() => {
    if (animTimeoutRef.current) {
      clearTimeout(animTimeoutRef.current);
      animTimeoutRef.current = null;
    }
  }, []);

  const startAnimTimeout = useCallback(() => {
    clearAnimTimeout();
    animTimeoutRef.current = setTimeout(() => {
      if (isAnimating.value) {
        cancelAnimation(tx);
        tx.value = 0;
        isAnimating.value = false;
      }
    }, FLY_OUT_MS + 250);
  }, [clearAnimTimeout, isAnimating, tx]);

  useEffect(() => {
    return () => clearAnimTimeout();
  }, [clearAnimTimeout]);

  // Synchronize shared value snapshots for worklets without recreating gesture handlers
  useEffect(() => {
    indexSV.value = index;
    totalSV.value = articles.length;
  }, [index, articles.length, indexSV, totalSV]);

  // Sole entry point for a committed swipe. Reset the shared values HERE, on the
  // JS thread, right before the index changes: the outgoing card stays parked
  // off-screen (tx = ±width * 1.4) until this runs, so it is never shown
  // snapping back to centre, and the incoming card mounts already at rest.
  const advanceTo = useCallback(
    (next: number) => {
      cancelAnimation(tx);
      tx.value = 0;
      isAnimating.value = false;
      onIndexChange(next);
    },
    [isAnimating, onIndexChange, tx],
  );

  // Trigger loading next page when 8 cards or fewer remain, ensuring 3-ahead preload window never starves.
  useEffect(() => {
    if (articles.length - index <= 8) onNearEnd?.();
  }, [articles.length, index, onNearEnd]);

  // Safety fallback: ensure tx is cleanly at 0 when index changes while not animating
  useEffect(() => {
    clearAnimTimeout();
    if (!isAnimating.value && tx.value !== 0) {
      cancelAnimation(tx);
      tx.value = 0;
    }
  }, [index, tx, isAnimating, clearAnimTimeout]);

  // Preload cover images for the active window (current + 3 ahead + 3 behind)
  useEffect(() => {
    prefetchWindowCovers(articles, index, PRELOAD_RADIUS, Image.prefetch);
  }, [articles, index]);

  // Pan gesture is created ONCE with stable deps; worklet reads indexSV and totalSV snapshots
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .shouldCancelWhenOutside(false)
        .onUpdate((e) => {
          'worklet';
          if (isAnimating.value) return;
          tx.value = e.translationX;
          // Arm the reveal once per gesture: finger right -> next, left -> prev.
          if (!revealArmed.value && Math.abs(e.translationX) > 5) {
            revealArmed.value = 1;
            runOnJS(armReveal)(e.translationX > 0 ? 'next' : 'prev');
          }
        })
        .onEnd((e) => {
          'worklet';
          const dir = swipeOutcome(e.translationX, e.velocityX);
          if (isAnimating.value) return;
          // Physical direction: finger right = next article, finger left = previous.
          const next = deckStep(indexSV.value, dir, totalSV.value);
          if (next === null) {
            // Snap back: keep the armed reveal until the spring has returned the
            // card to centre, otherwise the uncovered neighbour swaps mid-animation.
            tx.value = withSpring(0, SPRING, (finished) => {
              'worklet';
              if (finished) runOnJS(resetReveal)();
            });
            return;
          }
          isAnimating.value = true;
          runOnJS(startAnimTimeout)();
          tx.value = withTiming(dir * width * 1.4, { duration: FLY_OUT_MS }, (finished) => {
            'worklet';
            runOnJS(clearAnimTimeout)();
            if (finished) {
              // Do NOT reset tx here: the outgoing card must stay off-screen
              // until advanceTo swaps the index, otherwise it snaps back into
              // view for a few frames and flashes before the new card appears.
              runOnJS(resetReveal)();
              runOnJS(advanceTo)(next);
            } else {
              cancelAnimation(tx);
              tx.value = 0;
              isAnimating.value = false;
              runOnJS(resetReveal)();
            }
          });
        })
        .onFinalize((_e, success) => {
          'worklet';
          if (!success && !isAnimating.value) {
            tx.value = withSpring(0, SPRING, (finished) => {
              'worklet';
              if (finished) runOnJS(resetReveal)();
            });
          }
        }),
    [
      advanceTo,
      armReveal,
      clearAnimTimeout,
      indexSV,
      isAnimating,
      resetReveal,
      revealArmed,
      startAnimTimeout,
      totalSV,
      tx,
      width,
    ],
  );

  const handleTap = useCallback(() => {
    if (Date.now() - lastSourcePressTimeRef.current < 400) return;
    if (!isAnimating.value && frontRef.current) {
      onPress(frontRef.current);
    }
  }, [isAnimating, onPress]);

  const handleSourcePress = useCallback(() => {
    lastSourcePressTimeRef.current = Date.now();
    if (!isAnimating.value && onPressSource && frontRef.current) {
      onPressSource(frontRef.current);
    }
  }, [isAnimating, onPressSource]);

  const tapCard = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .onEnd((_e, success) => {
          'worklet';
          if (success) runOnJS(handleTap)();
        }),
    [handleTap],
  );

  const composed = useMemo(() => Gesture.Race(pan, tapCard), [pan, tapCard]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-8, 0, 8])}deg` },
    ],
  }));

  // Neighbours are fully static: they never translate, scale or fade while the
  // finger moves. Only the front card follows the drag, and the revealed
  // neighbour is simply uncovered as the front slides away. Ordering is a plain
  // static zIndex so it cannot pop the way an animated zIndex does on Android.
  const neighbourZ = (role: 'prev' | 'next' | 'deep') => {
    if (role === 'deep') return 1;
    const revealed = role === reveal;
    return revealed ? 2 : 1;
  };
  const isFrontRole = (role: string) => role === 'front';

  if (!front) return null;

  // One entry per rendered card, front LAST so it paints over the neighbours.
  // Every entry renders the SAME element type with the SAME key (article.id)
  // and the SAME child tree, so the mounted instance — and its already-decoded
  // Image — is reused when a neighbour becomes the front card.
  const visible: { a: Article; slot: number; role: 'prev' | 'next' | 'deep' | 'front' }[] = [
    ...neighbours,
    { a: front, slot: -1, role: 'front' },
  ];

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.deck}>
        {/* Peek bars: purely decorative, no text, so no content geometry rides
            on them. They sit behind every card and give the stack look. */}
        {Array.from({ length: DEPTH }, (_, i) => (
          <View
            key={`peek-${i}`}
            pointerEvents="none"
            style={[
              styles.peek,
              {
                top: i * PEEK,
                width: `${82 + i * 6}%`,
                backgroundColor: i === DEPTH - 1 ? t.surfaceStackMid : t.surfaceStackBack,
                borderColor: t.stackEdge,
                opacity: i === DEPTH - 1 ? 1 : 0.9,
              },
            ]}
          />
        ))}

        {visible.map(({ a, role }) => (
          <Animated.View
            key={a.id}
            pointerEvents={isFrontRole(role) ? 'auto' : 'none'}
            accessible={isFrontRole(role)}
            accessibilityRole={isFrontRole(role) ? 'button' : undefined}
            accessibilityLabel={isFrontRole(role) ? a.title : undefined}
            onAccessibilityTap={isFrontRole(role) ? () => onPress(a) : undefined}
            style={[
              styles.card,
              { backgroundColor: t.surface },
              isFrontRole(role)
                ? [{ zIndex: 10 }, frontStyle]
                : { zIndex: neighbourZ(role as 'prev' | 'next' | 'deep') },
            ]}
          >
            <HeroCard
              article={a}
              t={t}
              interactive={isFrontRole(role)}
              hint={isFrontRole(role) ? hint : undefined}
              onPressSource={isFrontRole(role) ? handleSourcePress : undefined}
              clusterCount={clusterSources?.[a.id]}
              onPressCluster={
                isFrontRole(role) && onPressCluster ? () => onPressCluster(a) : undefined
              }
            />
          </Animated.View>
        ))}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  deck: {
    flex: 1,
    marginHorizontal: 16,
    // Cards are absolutely positioned from an explicit top offset, so no padding
    // is involved in their placement (padding would be ambiguous here).
    paddingTop: 0,
    position: 'relative',
    alignItems: 'center',
  },
  /**
   * Every card — front and neighbours alike — occupies this exact rect, so a
   * card's text never shifts or re-wraps when it becomes the front card.
   */
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: DEPTH * PEEK,
    bottom: 0,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 6,
  },
  /** Decorative stack bar behind the cards. No content, so nothing can re-wrap. */
  peek: {
    position: 'absolute',
    alignSelf: 'center',
    height: 120,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  cardBody: { flex: 1, padding: 16 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTrailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakingText: {
    color: '#FFFFFF',
    fontFamily: 'Cairo_700Bold',
    fontSize: 11,
    lineHeight: 16,
  },
  publisherRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  moreBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 19, lineHeight: 29, marginBottom: 12 },
  imageContainer: {
    width: '100%',
    flex: 1,
    minHeight: 120,
    borderRadius: 20,
    marginBottom: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  image: { width: '100%', height: '100%', borderRadius: 20 },
  shareHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  metricsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  meta: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  clusterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  clusterBadgeText: { fontFamily: 'Cairo_700Bold', fontSize: 11 },
  clusterCta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  clusterCtaText: { fontFamily: 'Cairo_600SemiBold', fontSize: 11 },
  hint: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 20,
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  pickerTitle: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
  },
});
