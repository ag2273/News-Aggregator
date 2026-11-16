import React, { useCallback } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
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
import { swipeOutcome } from '../lib/swipe';
import type { Article } from '../lib/api';
import type { Theme } from '../constants/colors';
import { PublisherAvatar, PublisherMeta } from './Publisher';

const FLY_OUT_MS = 240;
const SPRING = { damping: 20, stiffness: 200 };

/**
 * Swipeable 3-card hero deck (Tinder-style).
 * The front card follows the finger, flies off past the threshold and the next
 * card comes forward; the two peeking layers behind grow as it leaves.
 * The back layers are real articles (next in the feed), so only their source
 * name shows — nothing is invented.
 */
export function HeroDeck({
  articles,
  index,
  onIndexChange,
  t,
  onPress,
  onPressSource,
}: {
  articles: Article[];
  index: number;
  onIndexChange: (next: number) => void;
  t: Theme;
  onPress: (a: Article) => void;
  onPressSource?: (a: Article) => void;
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

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
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
    });

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-9, 0, 9])}deg` },
    ],
  }));

  const layer2Style = useAnimatedStyle(() => {
    const p = Math.min(Math.abs(tx.value) / 240, 1);
    return {
      transform: [{ translateY: -2 * p }, { scale: 0.96 + 0.04 * p }],
      opacity: 0.85 + 0.15 * p,
    };
  });

  const layer3Style = useAnimatedStyle(() => {
    const p = Math.min(Math.abs(tx.value) / 240, 1);
    return {
      transform: [{ translateY: -3 * p }, { scale: 0.94 + 0.05 * p }],
      opacity: 0.55 + 0.25 * p,
    };
  });

  if (!front) return null;

  return (
    <View style={styles.deckContainer}>
      {third ? (
        <Animated.View
          style={[styles.layer, styles.deckLayer3, { backgroundColor: t.surface }, layer3Style]}
        >
          <Text style={[styles.layerText, { color: t.textMuted }]} numberOfLines={1}>
            {third.sourceName}
          </Text>
        </Animated.View>
      ) : null}

      {second ? (
        <Animated.View
          style={[styles.layer, styles.deckLayer2, { backgroundColor: t.surface }, layer2Style]}
        >
          <Text style={[styles.layerText, { color: t.textMuted }]} numberOfLines={1}>
            {second.sourceName}
          </Text>
        </Animated.View>
      ) : null}

      <GestureDetector gesture={canSwipe ? pan : Gesture.Pan().enabled(false)}>
        <Animated.View style={[styles.frontCard, { backgroundColor: t.surface }, frontStyle]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => onPress(front)}
            accessibilityRole="button"
            accessibilityLabel={front.title}
          >
            <View style={styles.cardHeader}>
              <TouchableOpacity
                style={styles.publisherRow}
                activeOpacity={0.7}
                onPress={() => onPressSource?.(front)}
                disabled={!onPressSource}
              >
                <PublisherAvatar name={front.sourceName} size={38} t={t} />
                <PublisherMeta
                  name={front.sourceName}
                  relative={relativeTime(front.publishedAt)}
                  t={t}
                />
              </TouchableOpacity>
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
          </TouchableOpacity>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  deckContainer: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 20,
    paddingTop: 40,
    position: 'relative',
    alignItems: 'center',
  },
  layer: {
    position: 'absolute',
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 9,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  deckLayer3: { top: 0, width: '82%', height: 44 },
  deckLayer2: { top: 10, width: '91%', height: 44 },
  layerText: { fontFamily: 'Cairo_600SemiBold', fontSize: 11 },
  frontCard: {
    width: '100%',
    borderRadius: 28,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 5,
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
