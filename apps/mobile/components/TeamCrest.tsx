import React, { useState } from 'react';
import { Image, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { logoUrl } from '../lib/api';
import type { Theme } from '../constants/colors';

/**
 * A club crest, with an honest gap when there is none.
 *
 * The source does not publish a crest for every team — measured, FilGoal has one
 * for every team on its day pages, but a competition it does not cover has none.
 * When the URL is missing, or the image fails to load, this draws the same shield
 * placeholder the screens used before rather than a broken image.
 *
 * The URL always points at our own API; nothing here loads bytes from a source.
 */
export function TeamCrest({
  logo,
  name,
  size = 28,
  t,
  style,
}: {
  logo?: string | null;
  /** Used for the accessibility label, so a screen reader says which club. */
  name: string;
  size?: number;
  t: Theme;
  /** Shape overrides for the crest itself (border, margin). */
  style?: StyleProp<ImageStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const uri = logoUrl(logo);

  if (!uri || failed) {
    return (
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: t.pillInactiveBg,
            alignItems: 'center',
            justifyContent: 'center',
          },
          style as StyleProp<ViewStyle>,
        ]}
        accessibilityRole="image"
        accessibilityLabel={`${name} — الشعار غير متاح`}
      >
        <Ionicons name="shield-outline" size={Math.round(size * 0.55)} color={t.textMuted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      onError={() => setFailed(true)}
      accessibilityRole="image"
      accessibilityLabel={name}
      // Crests are small and round; a plain resize keeps them crisp.
      resizeMode="contain"
    />
  );
}

/** A crest with the club name under it, as the match hero uses. */
export function TeamCrestWithName({
  logo,
  name,
  size = 44,
  t,
  textStyle,
}: {
  logo?: string | null;
  name: string;
  size?: number;
  t: Theme;
  textStyle?: object;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <TeamCrest logo={logo} name={name} size={size} t={t} />
      <Text style={[{ fontSize: 13, fontWeight: '700', textAlign: 'center', color: t.textPrimary }, textStyle]} numberOfLines={2}>
        {name}
      </Text>
    </View>
  );
}
