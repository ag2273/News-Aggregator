import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import { TeamCrest } from './TeamCrest';
import { relativeTime } from '../lib/api';

/**
 * The match centre's news card, to the approved design.
 *
 * Three facts the design asks for and the old card did not carry: the article's
 * thumbnail, its source as a small plate, and its age as a relative time. When the
 * feed had no image the plate draws the football glyph — the design's own
 * fallback — rather than an empty grey rectangle.
 *
 * The title has room to finish (three lines). Two clipped real Egyptian headlines
 * mid-sentence on the old card was the finding that started this.
 */
export function MatchNewsCard({
  t,
  title,
  sourceName,
  publishedAt,
  imageUrl,
  both,
  onPress,
}: {
  t: Theme;
  title: string;
  sourceName: string;
  publishedAt: number;
  imageUrl?: string | null;
  /** The article names both clubs. */
  both?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: t.surface, borderColor: t.borderLight }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.thumb, { backgroundColor: t.badgePlate, borderColor: t.borderLight }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.thumbImg} resizeMode="cover" />
        ) : (
          <Text style={styles.thumbGlyph}>⚽</Text>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.metaRow}>
          <View style={[styles.sourcePlate, { backgroundColor: t.accentSoft }]}>
            <Text style={[styles.sourceText, { color: t.accent }]} numberOfLines={1}>
              {sourceName}
            </Text>
          </View>
          <Text style={[styles.time, { color: t.textDim }]} numberOfLines={1}>
            {`• ${relativeTime(publishedAt)}`}
          </Text>
          {both ? (
            <Text style={[styles.both, { color: t.textMuted }]} numberOfLines={1}>
              • الفريقان
            </Text>
          ) : null}
        </View>
        <Text style={[styles.title, { color: t.textPrimary }]} numberOfLines={3}>
          {title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
    alignItems: 'flex-start',
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbGlyph: { fontSize: 24 },
  body: { flex: 1, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  sourcePlate: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, maxWidth: 130 },
  sourceText: { fontFamily: 'Cairo_700Bold', fontSize: 10 },
  time: { fontFamily: 'Cairo_400Regular', fontSize: 10 },
  both: { fontFamily: 'Cairo_400Regular', fontSize: 10 },
  title: { fontFamily: 'Cairo_600SemiBold', fontSize: 13, lineHeight: 20 },
});
