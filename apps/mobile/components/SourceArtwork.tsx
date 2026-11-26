import React, { useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { API_BASE } from '../lib/api';

/**
 * The image slot of a story that has no picture (#57, design option A, approved
 * 2026-11-26): the outlet's colour as a soft gradient, its site icon on a white
 * tile in the middle, and its name under it.
 *
 * The icon comes from OUR server (`/api/sources/:id/icon`), never from the outlet.
 * When there is no icon, or it fails to load, the tile shows the name's first
 * letter in the outlet's colour, so the slot never shows a broken image.
 */
const FALLBACK_COLOR = '#334155';

/** `#RRGGBB` mixed toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const mix = (c: number) => Math.round(c + (target - c) * a);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function sourceIconUrl(sourceId: string): string {
  return `${API_BASE}/api/sources/${encodeURIComponent(sourceId)}/icon`;
}

export function SourceArtwork({
  sourceId,
  sourceName,
  color,
  style,
}: {
  sourceId: string;
  sourceName: string;
  color?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const brand = color && /^#[0-9a-f]{6}$/i.test(color) ? color : FALLBACK_COLOR;
  const [iconFailed, setIconFailed] = useState(false);
  const letter = sourceName.trim().charAt(0) || 'خ';
  return (
    <LinearGradient
      testID="source-artwork"
      colors={[shade(brand, 0.22), brand, shade(brand, -0.3)]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={[styles.slot, style]}
    >
      <View style={styles.tile}>
        {iconFailed ? (
          <Text style={[styles.letter, { color: brand }]}>{letter}</Text>
        ) : (
          <Image
            testID="source-artwork-icon"
            source={{ uri: sourceIconUrl(sourceId) }}
            style={styles.icon}
            resizeMode="contain"
            onError={() => setIconFailed(true)}
            accessibilityIgnoresInvertColors
          />
        )}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {sourceName}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  slot: { alignItems: 'center', justifyContent: 'center', gap: 10, overflow: 'hidden' },
  tile: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  icon: { width: 46, height: 46, borderRadius: 10 },
  letter: { fontFamily: 'Cairo_700Bold', fontSize: 26, lineHeight: 36 },
  name: { color: '#FFFFFF', fontFamily: 'Cairo_700Bold', fontSize: 14, opacity: 0.92, maxWidth: '80%' },
});
