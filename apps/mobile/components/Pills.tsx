import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Theme } from '../constants/colors';

export const CATEGORY_PILLS: Array<{ id: string | null; label: string }> = [
  { id: null, label: 'كل الأخبار' },
  { id: 'egypt', label: 'مصر' },
  { id: 'economy', label: 'اقتصاد' },
  { id: 'sports', label: 'رياضة' },
  { id: 'tech', label: 'تكنولوجيا' },
];

/** Horizontal scrolling pills. Active = solid black, inactive = clean white, no border. */
export function CategoryPills({
  t,
  active,
  onChange,
}: {
  t: Theme;
  active: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pillsRow}
    >
      {CATEGORY_PILLS.map((c) => {
        const isActive = c.id === active;
        return (
          <TouchableOpacity
            key={c.id ?? 'all'}
            activeOpacity={0.8}
            onPress={() => onChange(c.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            style={[
              styles.pill,
              {
                backgroundColor: isActive ? t.pillActiveBg : t.pillInactiveBg,
              },
            ]}
          >
            <Text
              style={[styles.pillText, { color: isActive ? t.pillActiveText : t.pillInactiveText }]}
            >
              {c.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/** Section title with a trailing "عرض الكل" link. */
export function SectionHeader({
  t,
  title,
  actionLabel = 'عرض الكل',
  onAction,
}: {
  t: Theme;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>{title}</Text>
      {onAction ? (
        <TouchableOpacity onPress={onAction} accessibilityRole="button">
          <Text style={[styles.sectionAction, { color: t.textMuted }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : actionLabel ? (
        <Text style={[styles.sectionAction, { color: t.textMuted }]}>{actionLabel}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pillsRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
  pill: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  pillText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 12,
  },
  sectionTitle: { fontFamily: 'Cairo_700Bold', fontSize: 18 },
  sectionAction: { fontFamily: 'Cairo_400Regular', fontSize: 13 },
});
