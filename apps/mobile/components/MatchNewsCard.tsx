import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Theme } from '../constants/colors';
import { relativeTime } from '../lib/api';

/**
 * The match centre's news card, matching the approved design file.
 *
 * Measured against `football-follow-redesign.html`:
 *   - card: 12px padding, 16px radius, 12px gap, items centred;
 *   - thumbnail: 82×82, 12px radius, and — per the file — a football glyph on a dark
 *     green gradient when the feed carried no image. That glyph is the design, not a
 *     placeholder standing in for a real picture: only about one article in ten from
 *     our Egyptian outlets carries a lead image, so a page of real photos is not
 *     something the corpus can give.
 *   - source: a 16px square plate with the outlet's initial, then the outlet's name
 *     as plain text in the muted tone, then a dim «منذ …». The previous build put the
 *     source in a bold accent capsule, which read louder than the headline beneath it
 *     — the file gives the source a 9px initial and nothing more.
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
      <View style={[styles.thumb, { borderColor: t.borderLight }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.thumbImg} resizeMode="cover" />
        ) : (
          // The design's own fallback: a deep-green plate with the ball.
          <View style={styles.thumbGlyphWrap}>
            <Text style={styles.thumbGlyph}>⚽</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.metaRow}>
          <View style={[styles.sourcePlate, { backgroundColor: t.badgePlate }]}>
            <Text style={[styles.sourceInitial, { color: t.textSecondary }]}>
              {sourceName.trim().charAt(0)}
            </Text>
          </View>
          <Text style={[styles.sourceName, { color: t.textSecondary }]} numberOfLines={1}>
            {sourceName}
          </Text>
          <Text style={[styles.time, { color: t.textDim }]} numberOfLines={1}>
            {`• منذ ${relativeTime(publishedAt).replace('منذ ', '')}`}
          </Text>
          {both ? (
            <Text style={[styles.time, { color: t.textDim }]} numberOfLines={1}>
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
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    // The file centres the two columns vertically.
    alignItems: 'center',
  },
  thumb: {
    width: 82,
    height: 82,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: '#12211A',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbGlyphWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#064E3B',
  },
  thumbGlyph: { fontSize: 26 },
  body: { flex: 1, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sourcePlate: {
    width: 16,
    height: 16,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceInitial: { fontFamily: 'Cairo_700Bold', fontSize: 9 },
  sourceName: { fontFamily: 'Cairo_400Regular', fontSize: 10, flexShrink: 1 },
  time: { fontFamily: 'Cairo_400Regular', fontSize: 10 },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 12, lineHeight: 18 },
});
