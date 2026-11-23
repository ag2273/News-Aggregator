import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';

/** Circular publisher avatar built from the source name's first letter. */
export function PublisherAvatar({
  name,
  size = 36,
  t,
}: {
  name: string;
  size?: number;
  t: Theme;
}) {
  const letter = name.trim().charAt(0) || 'خ';
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: t.pillActiveBg,
        },
      ]}
    >
      <Text
        style={[
          styles.avatarLetter,
          { color: t.pillActiveText, fontSize: Math.round(size * 0.42) },
        ]}
      >
        {letter}
      </Text>
    </View>
  );
}

/** Source name + verified badge + relative time. */
export function PublisherMeta({
  name,
  relative,
  t,
}: {
  name: string;
  /**
   * The article's age. Optional because a surface that already prints it
   * elsewhere must not print it twice — the hero deck shows it in its footer
   * metrics bar, and printing it here too read «منذ 9 دقيقة» twice on one card.
   */
  relative?: string;
  t: Theme;
}) {
  return (
    <View>
      <View style={styles.nameRow}>
        <Text style={[styles.name, { color: t.textPrimary }]} numberOfLines={1}>
          {name}
        </Text>
        <Ionicons name="checkmark-circle" size={14} color={t.verified} />
      </View>
      {relative ? (
        <Text style={[styles.time, { color: t.textMuted }]}>{relative}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontFamily: 'Cairo_700Bold' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontFamily: 'Cairo_700Bold', fontSize: 14, maxWidth: 190 },
  time: { fontFamily: 'Cairo_400Regular', fontSize: 11 },
});
