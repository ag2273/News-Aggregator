import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import type { Theme } from '../constants/colors';
import { PublisherAvatar, PublisherMeta } from './Publisher';

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
}: {
  article: Article;
  t: Theme;
  /** Footer instruction; only the front card shows one. */
  hint?: string;
  /** Only the front card is interactive; neighbours stay inert. */
  onPressSource?: () => void;
}) {
  // Stable source object per article: re-renders must not re-key the image.
  const coverSource = useMemo(
    () => (article.imageUrl ? { uri: article.imageUrl } : undefined),
    [article.imageUrl],
  );

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
          {hint ? <Text style={[styles.hint, { color: t.textMuted }]}>{hint}</Text> : null}
          <Ionicons name="share-outline" size={17} color={t.textMuted} />
        </View>
      </View>
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
}: {
  articles: Article[];
  index: number;
  onIndexChange: (next: number) => void;
  /** Called when the deck is close to the end of the loaded articles. */
  onNearEnd?: () => void;
  t: Theme;
  onPress: (a: Article) => void;
  onPressSource?: (a: Article) => void;
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

  const advanceTo = useCallback(
    (next: number) => {
      onIndexChange(next);
    },
    [onIndexChange],
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
              tx.value = 0;
              isAnimating.value = false;
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

  if (!front) return null;

  // One entry per rendered card, front LAST so it paints over the peeking
  // neighbours. Every entry renders the SAME element type with the SAME key
  // (article.id) and the SAME child tree, so the mounted instance — and its
  // already-decoded Image — is reused when a neighbour becomes the front card.
  // Changing the element type or wrapping the body differently per role would
  // remount and flash an empty card.
  const visible: { a: Article; slot: number; role: 'prev' | 'next' | 'deep' | 'front' }[] = [
    ...neighbours,
    { a: front, slot: -1, role: 'front' },
  ];

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.deck}>
        {visible.map(({ a, slot, role }) => {
          const isFront = role === 'front';
          return (
            <Animated.View
              key={a.id}
              pointerEvents={isFront ? 'auto' : 'none'}
              accessible={isFront}
              accessibilityRole={isFront ? 'button' : undefined}
              accessibilityLabel={isFront ? a.title : undefined}
              onAccessibilityTap={isFront ? () => onPress(a) : undefined}
              style={
                isFront
                  ? [styles.frontCard, { backgroundColor: t.surface }, frontStyle]
                  : [
                      styles.layer,
                      {
                        top: (DEPTH - 1 - slot) * PEEK,
                        width: `${94 - slot * 6}%`,
                        backgroundColor: slot === 0 ? t.surfaceStackMid : t.surfaceStackBack,
                        borderColor: t.stackEdge,
                        opacity: slot === 0 ? 1 : 0.95 - slot * 0.1,
                        zIndex: neighbourZ(role),
                      },
                    ]
              }
            >
              <HeroCard
                article={a}
                t={t}
                hint={isFront ? hint : undefined}
                onPressSource={isFront ? handleSourcePress : undefined}
              />
            </Animated.View>
          );
        })}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  deck: {
    flex: 1,
    marginHorizontal: 16,
    // Room for the three peeking card edges above the front card.
    paddingTop: DEPTH * PEEK,
    position: 'relative',
    alignItems: 'center',
  },
  layer: {
    position: 'absolute',
    // Span from its peek offset down to the card's own bottom edge, so only the
    // top strip is visible behind the (wider) front card.
    bottom: 0,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  frontCard: {
    flex: 1,
    width: '100%',
    borderRadius: 28,
    // Above every neighbour so the front always covers them until it flies out.
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 6,
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
  metricsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  meta: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hint: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
});
