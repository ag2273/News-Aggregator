import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
 * advances; taps open the article sheet. The cards behind the front one are
 * decorative strips only.
 */
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

  const front = articles[index];
  const frontRef = useRef(front);
  frontRef.current = front;

  const coverSource = useMemo(
    () => (front?.imageUrl ? { uri: front.imageUrl } : undefined),
    [front?.imageUrl],
  );

  // Decorative strips for the cards that would sit behind the front one.
  const back = [1, 2, 3].map((n) => articles[index + n]);
  const canNext = index + 1 < articles.length;
  const canPrev = index > 0;

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
        })
        .onEnd((e) => {
          'worklet';
          const dir = swipeOutcome(e.translationX, e.velocityX);
          if (isAnimating.value) return;
          // Physical direction: finger right = next article, finger left = previous.
          const next = deckStep(indexSV.value, dir, totalSV.value);
          if (next === null) {
            tx.value = withSpring(0, SPRING);
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
              runOnJS(advanceTo)(next);
            } else {
              cancelAnimation(tx);
              tx.value = 0;
              isAnimating.value = false;
            }
          });
        })
        .onFinalize((_e, success) => {
          'worklet';
          if (!success && !isAnimating.value) {
            tx.value = withSpring(0, SPRING);
          }
        }),
    [advanceTo, clearAnimTimeout, indexSV, isAnimating, startAnimTimeout, totalSV, tx, width],
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

  const stripStyles = [
    useAnimatedStyle(() => {
      const p = Math.min(Math.abs(tx.value) / 220, 1);
      return { transform: [{ translateY: -PEEK * p }] };
    }),
    useAnimatedStyle(() => {
      const p = Math.min(Math.abs(tx.value) / 220, 1);
      return { transform: [{ translateY: -PEEK * p }] };
    }),
    useAnimatedStyle(() => {
      const p = Math.min(Math.abs(tx.value) / 220, 1);
      return { transform: [{ translateY: -PEEK * p }] };
    }),
  ];

  if (!front) return null;

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.deck}>
        {/* Decorative strips for the cards behind the front one (pile hint only) */}
        {back
          .map((a, i) => ({ a, i }))
          .reverse()
          .map(({ a, i }) =>
            a ? (
              <Animated.View
                key={`${a.id}-${i}`}
                pointerEvents="none"
                style={[
                  styles.layer,
                  {
                    top: (DEPTH - 1 - i) * PEEK,
                    width: `${94 - i * 6}%`,
                    backgroundColor: i === 0 ? t.surfaceStackMid : t.surfaceStackBack,
                    borderColor: t.stackEdge,
                    opacity: i === 0 ? 1 : 0.95 - i * 0.1,
                  },
                  stripStyles[i] ?? null,
                ]}
              />
            ) : null,
          )}

        <Animated.View
          accessible
          accessibilityRole="button"
          accessibilityLabel={front.title}
          onAccessibilityTap={() => onPress(front)}
          style={[styles.frontCard, { backgroundColor: t.surface }, frontStyle]}
        >
          <View style={styles.cardHeader}>
            <Pressable
              onPress={handleSourcePress}
              style={styles.publisherRow}
              accessible
              accessibilityRole="button"
              accessibilityLabel={front.sourceName}
            >
              <PublisherAvatar name={front.sourceName} size={40} t={t} />
              <PublisherMeta
                name={front.sourceName}
                relative={relativeTime(front.publishedAt)}
                t={t}
              />
            </Pressable>
            <View style={[styles.moreBtn, { backgroundColor: t.surfaceSubtle }]}>
              <Ionicons name="ellipsis-vertical" size={16} color={t.textMuted} />
            </View>
          </View>

          <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={4}>
            {front.title} 🔥
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
              {relativeTime(front.publishedAt)}
            </Text>
            <View style={styles.hintRow}>
              {canNext ? (
                <Text style={[styles.hint, { color: t.textMuted }]}>اسحب للتالي</Text>
              ) : canPrev ? (
                <Text style={[styles.hint, { color: t.textMuted }]}>اسحب للسابق</Text>
              ) : null}
              <Ionicons name="share-outline" size={17} color={t.textMuted} />
            </View>
          </View>
        </Animated.View>
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
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 6,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
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
