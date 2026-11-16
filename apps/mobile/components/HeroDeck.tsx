import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
import {
  PRELOAD_RADIUS,
  getPreloadNeighbors,
  prefetchWindowCovers,
  getOffscreenCoverStyle,
  getDeckAdjacentCards,
  type CoverDimensions,
} from '../lib/preload';
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
  const { nextArticle, prevArticle, farStrips } = useMemo(
    () => getDeckAdjacentCards(articles, index),
    [articles, index],
  );
  const canNext = index + 1 < articles.length;
  const canPrev = index > 0;

  const advanceTo = useCallback(
    (next: number) => {
      onIndexChange(next);
      tx.value = 0;
    },
    [onIndexChange, tx],
  );

  // Trigger loading next page when 8 cards or fewer remain, ensuring 3-ahead preload window never starves.
  useEffect(() => {
    if (articles.length - index <= 8) onNearEnd?.();
  }, [articles.length, index, onNearEnd]);

  useEffect(() => {
    tx.value = 0;
  }, [index, tx]);

  // Preload cover images for the active window (current + 3 ahead + 3 behind)
  useEffect(() => {
    prefetchWindowCovers(articles, index, PRELOAD_RADIUS, Image.prefetch);
  }, [articles, index]);

  const preloadNeighbors = useMemo(
    () => getPreloadNeighbors(articles, index, PRELOAD_RADIUS),
    [articles, index],
  );

  const [coverDimensions, setCoverDimensions] = useState<CoverDimensions | null>(null);

  const offscreenCoverStyle = useMemo(
    () => getOffscreenCoverStyle(coverDimensions, width),
    [coverDimensions, width],
  );

  const imageOpacity = useSharedValue(0);

  // Reset opacity when index changes so a residual decode never flashes blank
  useEffect(() => {
    imageOpacity.value = 0;
  }, [index, imageOpacity]);

  const handleImageLoad = useCallback(() => {
    imageOpacity.value = withTiming(1, { duration: 150 });
  }, [imageOpacity]);

  const handleImageError = useCallback(() => {
    imageOpacity.value = 0;
  }, [imageOpacity]);

  const imageFadeStyle = useAnimatedStyle(() => ({
    opacity: imageOpacity.value,
  }));

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

  const nextCardStyle = useAnimatedStyle(() => {
    if (tx.value < 0) {
      // Swiping left towards prev card -> fade next card out so prev card is cleanly revealed
      const opacity = interpolate(-tx.value, [0, 50], [1, 0], 'clamp');
      return {
        opacity,
        transform: [{ scale: 0.97 }, { translateY: -PEEK }],
      };
    }
    const p = Math.min(tx.value / width, 1);
    return {
      opacity: 1,
      transform: [
        { scale: interpolate(p, [0, 1], [0.97, 1]) },
        { translateY: interpolate(p, [0, 1], [-PEEK, 0]) },
      ],
    };
  });

  const prevCardStyle = useAnimatedStyle(() => {
    if (tx.value >= 0) {
      return {
        opacity: 0,
        transform: [{ scale: 0.97 }, { translateY: -PEEK }],
      };
    }
    const p = Math.min(-tx.value / width, 1);
    return {
      opacity: interpolate(-tx.value, [0, 50], [0, 1], 'clamp'),
      transform: [
        { scale: interpolate(p, [0, 1], [0.97, 1]) },
        { translateY: interpolate(p, [0, 1], [-PEEK, 0]) },
      ],
    };
  });

  const stripStyles = [
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
      {/* Decorative far strips for index+3 and index+2 (pile hint only) */}
      {farStrips
        .map((a, idx) => ({ a, idx, stripIndex: idx + 1 }))
        .reverse()
        .map(({ a, idx, stripIndex }) => (
          <Animated.View
            key={`strip-${a.id}-${stripIndex}`}
            pointerEvents="none"
            style={[
              styles.layer,
              {
                top: (DEPTH - 1 - stripIndex) * PEEK,
                width: `${94 - stripIndex * 6}%`,
                backgroundColor: stripIndex === 1 ? t.surfaceStackMid : t.surfaceStackBack,
                borderColor: t.stackEdge,
                opacity: stripIndex === 1 ? 0.95 : 0.85,
              },
              stripStyles[idx] ?? null,
            ]}
          />
        ))}

      {/* Immediately-adjacent cards rendered with FULL content behind front card */}
      {prevArticle ? (
        <StaticDeckCard
          key={`prev-${prevArticle.id}`}
          article={prevArticle}
          t={t}
          hintText="اسحب للسابق"
          style={prevCardStyle}
        />
      ) : null}

      {nextArticle ? (
        <StaticDeckCard
          key={`next-${nextArticle.id}`}
          article={nextArticle}
          t={t}
          hintText="اسحب للتالي"
          style={nextCardStyle}
        />
      ) : null}

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

          <View
            style={[styles.imageContainer, { backgroundColor: t.pillInactiveBg }]}
            onLayout={(e) => {
              const { width: w, height: h } = e.nativeEvent.layout;
              if (w > 1 && h > 1) {
                setCoverDimensions((prev) => {
                  if (prev?.width === w && prev?.height === h) return prev;
                  return { width: w, height: h };
                });
              }
            }}
          >
            {/* Base placeholder: always underneath so residual native decode never flashes empty/white */}
            <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <Ionicons name="newspaper-outline" size={44} color={t.textMuted} />
            </View>

            {front.imageUrl ? (
              <Animated.View style={[StyleSheet.absoluteFill, imageFadeStyle]}>
                <Image
                  source={{ uri: front.imageUrl }}
                  style={styles.image}
                  resizeMode="cover"
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              </Animated.View>
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
      </GestureDetector>

      {/* Off-screen neighbor pre-render: warms 3 ahead and 3 behind at real display dimensions */}
      <View
        style={styles.offscreenPreload}
        pointerEvents="none"
        accessible={false}
        aria-hidden={true}
      >
        {preloadNeighbors.map((a) => (
          <View key={`preload-${a.id}`} style={[styles.preloadItem, offscreenCoverStyle]}>
            <Text style={styles.preloadText}>{a.title}</Text>
            <Text style={styles.preloadText}>{a.sourceName}</Text>
            {a.imageUrl ? (
              <Image
                source={{ uri: a.imageUrl }}
                style={offscreenCoverStyle}
                resizeMode="cover"
              />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Fully rendered card model for adjacent deck cards (index+1 and index-1).
 * Positioned directly behind the front card with pointerEvents="none" and accessible={false}.
 * Reveals full publisher, title, and cover image during horizontal dragging.
 */
export function StaticDeckCard({
  article,
  t,
  hintText,
  style,
}: {
  article: Article;
  t: Theme;
  hintText?: string | null;
  style?: StyleProp<ViewStyle> | ReturnType<typeof useAnimatedStyle>;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      aria-hidden={true}
      style={[styles.adjacentCard, { backgroundColor: t.surface }, style]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.publisherRow}>
          <PublisherAvatar name={article.sourceName} size={40} t={t} />
          <PublisherMeta
            name={article.sourceName}
            relative={relativeTime(article.publishedAt)}
            t={t}
          />
        </View>
        <View style={[styles.moreBtn, { backgroundColor: t.surfaceSubtle }]}>
          <Ionicons name="ellipsis-vertical" size={16} color={t.textMuted} />
        </View>
      </View>

      <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={4}>
        {article.title} 🔥
      </Text>

      <View style={[styles.imageContainer, { backgroundColor: t.pillInactiveBg }]}>
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <Ionicons name="newspaper-outline" size={44} color={t.textMuted} />
        </View>

        {article.imageUrl ? (
          <Image
            source={{ uri: article.imageUrl }}
            style={[
              StyleSheet.absoluteFill,
              styles.image,
              { opacity: loaded ? 1 : 0 },
            ]}
            resizeMode="cover"
            onLoad={() => setLoaded(true)}
          />
        ) : null}
      </View>

      <View style={[styles.metricsBar, { borderTopColor: t.borderLight }]}>
        <Text style={[styles.meta, { color: t.textMuted }]}>
          {relativeTime(article.publishedAt)}
        </Text>
        <View style={styles.hintRow}>
          {hintText ? (
            <Text style={[styles.hint, { color: t.textMuted }]}>{hintText}</Text>
          ) : null}
          <Ionicons name="share-outline" size={17} color={t.textMuted} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  adjacentCard: {
    position: 'absolute',
    top: DEPTH * PEEK,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 28,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  offscreenPreload: {
    position: 'absolute',
    opacity: 0,
    overflow: 'hidden',
    left: -9999,
    top: -9999,
  },
  preloadItem: {
    position: 'absolute',
    opacity: 0,
  },
  preloadText: { fontSize: 1 },
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
