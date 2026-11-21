import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { Theme } from '../constants/colors';

export type DockTab = 'home' | 'following' | 'digest' | 'video' | 'saved' | 'profile';

/**
 * Floating white capsule dock.
 *
 * The digest was added alongside the tabs that already existed, never in place of
 * one: الأكثر تداولاً keeps its slot and its icon. Five 44px items plus padding
 * fit inside the 320px capsule, so nothing has to be dropped.
 */
export function FloatingDock({ t, active }: { t: Theme; active: DockTab }) {
  return (
    <View style={[styles.dock, { backgroundColor: t.dockBg, shadowColor: t.dockShadow }]}>
      <DockButton
        t={t}
        active={active === 'home'}
        icon="home"
        label="الرئيسية"
        onPress={() => router.replace('/')}
      />
      <DockButton
        t={t}
        active={active === 'following'}
        icon="sparkles-outline"
        label="أخباري"
        onPress={() => router.push('/following')}
      />
      <DockButton
        t={t}
        active={active === 'digest'}
        icon="today-outline"
        label="الخلاصة"
        onPress={() => router.push('/digest')}
      />
      <DockButton
        t={t}
        active={active === 'video'}
        icon="trending-up-outline"
        label="الأكثر تداولاً"
        onPress={() => router.push('/trending')}
      />
      <DockButton
        t={t}
        active={active === 'saved'}
        icon="bookmarks-outline"
        label="المحفوظات"
        onPress={() => router.push('/saved')}
      />
      <DockButton
        t={t}
        active={active === 'profile'}
        icon="newspaper-outline"
        label="مصادري"
        onPress={() => router.push('/sources')}
      />
    </View>
  );
}

function DockButton({
  t,
  active,
  icon,
  label,
  onPress,
}: {
  t: Theme;
  active: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress?: () => void;
}) {
  if (active) {
    return (
      // The active tab is still a tab: it must announce itself to a screen reader
      // and stay tappable, exactly like the inactive ones.
      <TouchableOpacity
        style={[styles.activeWrap, { shadowColor: t.dockActiveGradientEnd }]}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: true }}
      >
        <LinearGradient
          colors={[t.dockActiveGradientStart, t.dockActiveGradientEnd]}
          style={styles.activeGradient}
        >
          <Ionicons name={icon} size={20} color={t.dockActiveIcon} />
        </LinearGradient>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity
      style={styles.dockItem}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={22} color={t.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    bottom: 22,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 320,
    height: 62,
    borderRadius: 31,
    // Six 44px items plus one 46px active wrap need 266px; with 12px padding a
    // side that is 290px, so the capsule stays 320 and nothing is dropped.
    paddingHorizontal: 12,
    gap: 2,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  dockItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  activeGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
