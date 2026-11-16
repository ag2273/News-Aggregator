import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { relativeTime } from '../lib/api';
import type { Article } from '../lib/api';
import type { Theme } from '../constants/colors';
import { PublisherAvatar, PublisherMeta } from './Publisher';

/**
 * Tinder-style 3-card deck for the top story.
 * The two peeking layers are real articles (next in the feed) — only their
 * source name is shown, so nothing is invented.
 */
export function HeroDeck({
  articles,
  t,
  onPress,
  onPressSource,
}: {
  articles: Article[];
  t: Theme;
  onPress: (a: Article) => void;
  onPressSource?: (a: Article) => void;
}) {
  const [front, second, third] = articles;
  if (!front) return null;

  return (
    <View style={styles.deckContainer}>
      {third ? (
        <View style={[styles.layer, styles.deckLayer3, { backgroundColor: t.surface }]}>
          <Text style={[styles.layerText, { color: t.textMuted }]} numberOfLines={1}>
            {third.sourceName}
          </Text>
        </View>
      ) : null}

      {second ? (
        <View style={[styles.layer, styles.deckLayer2, { backgroundColor: t.surface }]}>
          <Text style={[styles.layerText, { color: t.textMuted }]} numberOfLines={1}>
            {second.sourceName}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => onPress(front)}
        style={[styles.frontCard, { backgroundColor: t.surface }]}
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
          <Image source={{ uri: front.imageUrl }} style={styles.deckImage} />
        ) : (
          <View style={[styles.deckImage, styles.placeholder, { backgroundColor: t.pillInactiveBg }]}>
            <Ionicons name="newspaper-outline" size={34} color={t.textMuted} />
          </View>
        )}

        {/* Real data only: relative time + share. No invented engagement counts. */}
        <View style={styles.metricsBar}>
          <Text style={[styles.metricText, { color: t.textMuted }]}>
            {relativeTime(front.publishedAt)}
          </Text>
          <TouchableOpacity style={styles.shareIconBtn} accessibilityLabel="مشاركة">
            <Ionicons name="share-outline" size={16} color={t.textMuted} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
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
  deckLayer3: {
    top: 0,
    width: '82%',
    height: 44,
    opacity: 0.75,
  },
  deckLayer2: {
    top: 10,
    width: '91%',
    height: 44,
    opacity: 0.95,
  },
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
  shareIconBtn: { padding: 4 },
});
