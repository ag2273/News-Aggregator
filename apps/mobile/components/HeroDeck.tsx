import React, { useCallback, useMemo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { GestureType } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { relativeTime } from '../lib/api';
import { swipeOutcome } from '../lib/swipe';
import type { Article } from '../lib/api';
import type { Theme } from '../constants/colors';
import { PublisherAvatar, PublisherMeta } from './Publisher';

const FLY_OUT_MS = 240;
const SPRING = { damping: 20, stiffness: 200 };
/** How far each card behind the front one peeks above it. */
const PEEK = 14;

/**
 * Swipeable 3-card hero deck (Tinder-style).
 *
 * Layout: the front card sits at the bottom of the deck box; two more cards sit
 * behind it, each lifted by PEEK and narrowed, so three card edges are always
 * visible. All three are real articles — only the source name is shown.
 *
 * Gesture: a horizontal-only Pan that runs alongside the feed's vertical scroll
 * (`simultaneousWithExternalGesture` + the list disables its scroll while the
 * card is under the finger).
 */
export function HeroDeck({
  articles,
  index,
  onIndexChange,
  t,
  onPress,
  onPressSource,
  scrollGesture,
  onDragChange,
}: {
  articles: Article[];
  index: number;
  onIndexChange: (next: number) => void;
  t: Theme;
  onPress: (a: Article) => void;
  onPressSource?: (a: Article) => void;
  /** Native scroll gesture of the feed list, so both can coexist. */
  scrollGesture?: GestureType;
  /** Lets the feed disable its own scrolling while a card is being dragged. */
  onDragChange?: (dragging: boolean) => void;
}) {
  const { width } = useWindowDimensions();
  const tx = useSharedValue(0);

  const front = articles[index];
  const second = articles[index + 1];
  const third = articles[index + 2];
  const canSwipe = Boolean(second);

  const advance = useCallback(() => {
    // New index first, then recentre, so the incoming card lands at rest.
    onIndexChange(index + 1);
    tx.value = 0;
  }, [index, onIndexChange, tx]);

  // Memoised: a gesture recreated on every render gets re-attached and can drop
  // an in-flight drag.
  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      .activeOffsetX([-10, 10])
      .failOffsetY([-26, 26])
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        // Only once the pan actually activates (10px horizontal), so dragging
        // down from the deck still scrolls the feed.
        if (onDragChange) runOnJS(onDragChange)(true);
      })
      .onUpdate((e) => {
        tx.value = e.translationX;
      })
      .onEnd((e) => {
        const dir = swipeOutcome(e.translationX, e.velocityX);
        if (dir !== 0) {
          tx.value = withTiming(dir * width * 1.35, { duration: FLY_OUT_MS }, (finished) => {
            'worklet';
            if (finished) runOnJS(advance)();
          });
        } else {
          tx.value = withSpring(0, SPRING);
        }
      })
      .onFinalize(() => {
        if (onDragChange) runOnJS(onDragChange)(false);
      });

    if (scrollGesture) gesture.simultaneousWithExternalGesture(scrollGesture);
    return gesture;
  }, [advance, onDragChange, scrollGesture, tx, width]);

  const disabled = useMemo(() => Gesture.Pan().enabled(false), []);

  // Taps are gestures too, so no RN Touchable sits inside the pan and steals
  // the touch responder (the classic reason a horizontal pan dies inside a list).
  const tapCard = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .onEnd((_e, success) => {
          if (success) runOnJS(onPress)(front!);
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
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-9, 0, 9])}deg` },
    ],
  }));

  // Back cards rise and square up as the front card leaves.
  const layer2Style = useAnimatedStyle(() => {
    const p = Math.min(Math.abs(tx.value) / 220, 1);
    return {
      transform: [{ translateY: -PEEK * p }, { scale: 0.96 + 0.04 * p }],
      opacity: 0.92 + 0.08 * p,
    };
  });

  const layer3Style = useAnimatedStyle(() => {
    const p = Math.min(Math.abs(tx.value) / 220, 1);
    return {
      transform: [{ translateY: -PEEK * p }, { scale: 0.93 + 0.07 * p }],
      opacity: 0.7 + 0.3 * p,
    };
  });

  if (!front) return null;

  return (
    <View style={styles.deckContainer}>
      {/* Deepest card: just its top edge shows. */}
      {third ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.layer,
            styles.deckLayer3,
            { backgroundColor: t.surfaceStackBack, borderColor: t.borderLight },
            layer3Style,
          ]}
        />
      ) : null}

      {/* Middle card: its top edge sits one step above the front card. */}
      {second ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.layer,
            styles.deckLayer2,
            { backgroundColor: t.surfaceStackMid, borderColor: t.borderLight },
            layer2Style,
          ]}
        />
      ) : null}

      <GestureDetector gesture={canSwipe ? composed : tapCard}>
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
                <PublisherAvatar name={front.sourceName} size={38} t={t} />
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

          <Text style={[styles.deckTitle, { color: t.textPrimary }]} numberOfLines={3}>
            {front.title} 🔥
          </Text>

          {front.imageUrl ? (
            <Image source={{ uri: front.imageUrl }} style={styles.deckImage} resizeMode="cover" />
          ) : (
            <View
              style={[styles.deckImage, styles.placeholder, { backgroundColor: t.pillInactiveBg }]}
            >
              <Ionicons name="newspaper-outline" size={34} color={t.textMuted} />
            </View>
          )}

          {/* Real data only: relative time + share. No invented engagement counts. */}
          <View style={styles.metricsBar}>
            <Text style={[styles.metricText, { color: t.textMuted }]}>
              {relativeTime(front.publishedAt)}
            </Text>
            <View style={styles.hintRow}>
              {canSwipe ? (
                <Text style={[styles.hintText, { color: t.textMuted }]}>اسحب للتالي</Text>
              ) : null}
              <Ionicons name="share-outline" size={16} color={t.textMuted} />
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  deckContainer: {
    marginHorizontal: 16,
    marginTop: 10,
    // Room for the two peeking card edges above the front card.
    paddingTop: PEEK * 2,
    marginBottom: 20,
    position: 'relative',
    alignItems: 'center',
  },
  layer: {
    position: 'absolute',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  // Deepest of the three: starts at the very top, 16% narrower than the front.
  deckLayer3: {
    top: 0,
    width: '84%',
    height: 60,
    opacity: 1,
  },
  // Middle card: offset by one PEEK step, 8% narrower than the front.
  deckLayer2: {
    top: PEEK,
    width: '92%',
    height: 60,
    opacity: 1,
  },
  frontCard: {
    width: '100%',
    borderRadius: 28,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
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
  deckTitle: { fontFamily: 'Cairo_700Bold', fontSize: 17, lineHeight: 26, marginBottom: 12 },
  deckImage: { width: '100%', height: 190, borderRadius: 20 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  metricsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingHorizontal: 4,
  },
  metricText: { fontFamily: 'Cairo_600SemiBold', fontSize: 12 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hintText: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
});
