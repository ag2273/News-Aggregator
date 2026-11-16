import React, { useCallback, useEffect, useMemo } from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { relativeTime } from '../lib/api';
import { deckStep, swipeOutcome } from '../lib/swipe';
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

  const front = articles[index];
  const back = [1, 2, 3].map((n) => articles[index + n]);
  const canNext = index + 1 < articles.length;
  const canPrev = index > 0;

  const advanceTo = useCallback(
    (next: number) => {
      onIndexChange(next);
      tx.value = 0;
    },
    [onIndexChange, tx],
  );

  useEffect(() => {
    if (articles.length - index <= 4) onNearEnd?.();
  }, [articles.length, index, onNearEnd]);

  useEffect(() => {
    tx.value = 0;
  }, [index, tx]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-15, 15])
        .shouldCancelWhenOutside(false)
        .onUpdate((e) => {
          tx.value = e.translationX;
        })
        .onEnd((e) => {
          const dir = swipeOutcome(e.translationX, e.velocityX);
          // Physical direction: finger right = next article, finger left = previous.
          const next = deckStep(index, dir, articles.length);
          if (next === null) {
            tx.value = withSpring(0, SPRING);
            return;
          }
          tx.value = withTiming(dir * width * 1.4, { duration: FLY_OUT_MS }, (finished) => {
            'worklet';
            if (finished) runOnJS(advanceTo)(next);
          });
        })
        .onFinalize((_e, success) => {
          if (!success) {
            tx.value = withSpring(0, SPRING);
          }
        }),
    [advanceTo, articles.length, index, tx, width],
  );

  const tapCard = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .onEnd((_e, success) => {
          if (success && front) runOnJS(onPress)(front);
        }),
    [front, onPress],
  );

  const sourceTap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .onEnd((_e, success) => {
          if (success && onPressSource && front) runOnJS(onPressSource)(front);
        }),
    [front, onPressSource],
  );

  const composed = useMemo(() => Gesture.Race(pan, tapCard), [pan, tapCard]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-8, 0, 8])}deg` },
    ],
  }));

  const layerStyles = [
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
    <View style={styles.deck}>
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
                layerStyles[i],
              ]}
            />
          ) : null,
        )}

      <GestureDetector gesture={canNext || canPrev ? composed : tapCard}>
        <Animated.View
          accessible
          accessibilityRole="button"
          accessibilityLabel={front.title}
          onAccessibilityTap={() => onPress(front)}
          style={[styles.frontCard, { backgroundColor: t.surface }, frontStyle]}
        >
          <View style={styles.cardHeader}>
            <GestureDetector gesture={sourceTap}>
              <View style={styles.publisherRow}>
                <PublisherAvatar name={front.sourceName} size={40} t={t} />
                <PublisherMeta
                  name={front.sourceName}
                  relative={relativeTime(front.publishedAt)}
                  t={t}
                />
              </View>
            </GestureDetector>
            <View style={[styles.moreBtn, { backgroundColor: t.surfaceSubtle }]}>
              <Ionicons name="ellipsis-vertical" size={16} color={t.textMuted} />
            </View>
          </View>

          <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={4}>
            {front.title} 🔥
          </Text>

          {front.imageUrl ? (
            <Image source={{ uri: front.imageUrl }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={[styles.image, styles.placeholder, { backgroundColor: t.pillInactiveBg }]}>
              <Ionicons name="newspaper-outline" size={44} color={t.textMuted} />
            </View>
          )}

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
      </GestureDetector>
    </View>
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
  image: { width: '100%', flex: 1, minHeight: 120, borderRadius: 20, marginBottom: 12 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
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
