import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  PRELOAD_RADIUS,
  getPreloadNeighbors,
  prefetchWindowCovers,
  getOffscreenCoverStyle,
  getDeckAdjacentCards,
  getActiveDeckCards,
  isCoverLoaded,
  markCoverLoaded,
  markCoverError,
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
  const indexSV = useSharedValue(index);
  const totalSV = useSharedValue(articles.length);
  const isAnimating = useSharedValue(false);

  // [deck] JS-thread heartbeat for freeze diagnosis
  useEffect(() => {
    const id = setInterval(() => console.warn('[deck] heartbeat ' + Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  const front = articles[index];
  const frontRef = useRef(front);
  frontRef.current = front;

  const { farStrips } = useMemo(
    () => getDeckAdjacentCards(articles, index),
    [articles, index],
  );
  const activeCards = useMemo(
    () => getActiveDeckCards(articles, index),
    [articles, index],
  );
  const canNext = index + 1 < articles.length;
  const canPrev = index > 0;

  // Synchronize shared value snapshots for worklets without recreating gesture handlers
  useEffect(() => {
    indexSV.value = index;
    totalSV.value = articles.length;
  }, [index, articles.length, indexSV, totalSV]);

  const advanceTo = useCallback(
    (next: number) => {
      console.warn('[deck] advanceTo next=' + next);
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
    if (!isAnimating.value && tx.value !== 0) {
      cancelAnimation(tx);
      tx.value = 0;
    }
  }, [index, tx, isAnimating]);

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

  // Pan gesture is created ONCE with stable deps; worklet reads indexSV and totalSV snapshots
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-15, 15])
        .shouldCancelWhenOutside(false)
        .onUpdate((e) => {
          'worklet';
          if (isAnimating.value) {
            console.warn('[deck] onUpdate ignored-animating');
            return;
          }
          console.warn('[deck] onUpdate anim=' + isAnimating.value);
          tx.value = e.translationX;
        })
        .onEnd((e) => {
          'worklet';
          const dir = swipeOutcome(e.translationX, e.velocityX);
          console.warn(
            '[deck] onEnd dir=' +
              dir +
              ' index=' +
              indexSV.value +
              ' total=' +
              totalSV.value +
              ' anim=' +
              isAnimating.value,
          );
          if (isAnimating.value) {
            console.warn('[deck] onEnd ignored-animating');
            return;
          }
          // Physical direction: finger right = next article, finger left = previous.
          const next = deckStep(indexSV.value, dir, totalSV.value);
          if (next === null) {
            tx.value = withSpring(0, SPRING);
            return;
          }
          isAnimating.value = true;
          tx.value = withTiming(dir * width * 1.4, { duration: FLY_OUT_MS }, (finished) => {
            'worklet';
            console.warn(
              '[deck] withTiming completion finished=' + finished + ' anim=' + isAnimating.value,
            );
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
    [advanceTo, isAnimating, indexSV, totalSV, tx, width],
  );

  const handleTap = useCallback(() => {
    if (!isAnimating.value && frontRef.current) {
      onPress(frontRef.current);
    }
  }, [isAnimating, onPress]);

  const handleSourceTap = useCallback(() => {
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

  const sourceTap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .onEnd((_e, success) => {
          'worklet';
          if (success) runOnJS(handleSourceTap)();
        }),
    [handleSourceTap],
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

      {/* Unified active cards [prev, next, front] keyed strictly by article.id ONLY */}
      {activeCards.map((card) => {
        const isFront = card.role === 'front';
        const cardStyle =
          card.role === 'front'
            ? frontStyle
            : card.role === 'next'
              ? nextCardStyle
              : prevCardStyle;
        const hintText =
          card.role === 'front'
            ? canNext
              ? 'اسحب للتالي'
              : canPrev
                ? 'اسحب للسابق'
                : null
            : card.role === 'next'
              ? 'اسحب للتالي'
              : 'اسحب للسابق';

        return (
          <DeckCard
            key={card.article.id}
            article={card.article}
            t={t}
            hintText={hintText}
            style={cardStyle}
            interactive={isFront}
            gesture={canNext || canPrev ? composed : tapCard}
            sourceGesture={sourceTap}
            onPress={onPress}
            onPressSource={onPressSource}
            onCoverLayout={
              isFront
                ? (layout) => {
                    setCoverDimensions((prev) => {
                      if (
                        prev?.width === layout.width &&
                        prev?.height === layout.height
                      ) {
                        return prev;
                      }
                      return layout;
                    });
                  }
                : undefined
            }
          />
        );
      })}

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

export interface DeckCardProps {
  article: Article;
  t: Theme;
  hintText?: string | null;
  style?: StyleProp<ViewStyle> | ReturnType<typeof useAnimatedStyle>;
  interactive?: boolean;
  gesture?: any;
  sourceGesture?: any;
  onPress?: (a: Article) => void;
  onPressSource?: (a: Article) => void;
  onCoverLayout?: (layout: { width: number; height: number }) => void;
}

/**
 * Unified full-content deck card used for front, next, and prev roles.
 * Keyed strictly by article.id so advancing index preserves the React fiber instance
 * across next -> front transition without unmounting or re-sourcing the cover Image.
 */
export function DeckCard({
  article,
  t,
  hintText,
  style,
  interactive = false,
  gesture,
  sourceGesture,
  onPress,
  onPressSource,
  onCoverLayout,
}: DeckCardProps) {
  const [loaded, setLoaded] = useState(() => isCoverLoaded(article.imageUrl));

  useEffect(() => {
    if (isCoverLoaded(article.imageUrl)) {
      setLoaded(true);
    }
  }, [article.imageUrl]);

  const imageSource = useMemo(
    () => (article.imageUrl ? { uri: article.imageUrl } : undefined),
    [article.imageUrl],
  );

  const disabledGesture = useMemo(() => Gesture.Tap().enabled(false), []);
  const activeGesture = interactive && gesture ? gesture : disabledGesture;
  const activeSourceGesture = interactive && sourceGesture ? sourceGesture : disabledGesture;

  return (
    <GestureDetector gesture={activeGesture as any}>
      <Animated.View
        pointerEvents={interactive ? 'auto' : 'none'}
        accessible={interactive}
        accessibilityRole={interactive ? 'button' : undefined}
        accessibilityLabel={interactive ? article.title : undefined}
        onAccessibilityTap={interactive && onPress ? () => onPress(article) : undefined}
        aria-hidden={!interactive}
        style={[styles.cardBox, { backgroundColor: t.surface }, style]}
      >
        <View style={styles.cardHeader}>
          <GestureDetector gesture={activeSourceGesture as any}>
            <View style={styles.publisherRow}>
              <PublisherAvatar name={article.sourceName} size={40} t={t} />
              <PublisherMeta
                name={article.sourceName}
                relative={relativeTime(article.publishedAt)}
                t={t}
              />
            </View>
          </GestureDetector>
          <View style={[styles.moreBtn, { backgroundColor: t.surfaceSubtle }]}>
            <Ionicons name="ellipsis-vertical" size={16} color={t.textMuted} />
          </View>
        </View>

        <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={4}>
          {article.title} 🔥
        </Text>

        <View
          style={[styles.imageContainer, { backgroundColor: t.pillInactiveBg }]}
          onLayout={
            onCoverLayout
              ? (e) => {
                  const { width: w, height: h } = e.nativeEvent.layout;
                  if (w > 1 && h > 1) {
                    onCoverLayout({ width: w, height: h });
                  }
                }
              : undefined
          }
        >
          {/* Base placeholder: always underneath so residual native decode never flashes empty/white */}
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <Ionicons name="newspaper-outline" size={44} color={t.textMuted} />
          </View>

          {article.imageUrl ? (
            <Image
              source={imageSource}
              style={[
                StyleSheet.absoluteFill,
                styles.image,
                { opacity: loaded ? 1 : 0 },
              ]}
              resizeMode="cover"
              onLoad={() => {
                markCoverLoaded(article.imageUrl);
                setLoaded(true);
              }}
              onError={() => {
                markCoverError(article.imageUrl);
                setLoaded(false);
              }}
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
    </GestureDetector>
  );
}

export const StaticDeckCard = DeckCard;

const styles = StyleSheet.create({
  cardBox: {
    position: 'absolute',
    top: DEPTH * PEEK,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 28,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 6,
  },
  adjacentCard: {
    position: 'absolute',
    top: DEPTH * PEEK,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 28,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 6,
  },
  frontCard: {
    position: 'absolute',
    top: DEPTH * PEEK,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 28,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 26,
    elevation: 6,
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
