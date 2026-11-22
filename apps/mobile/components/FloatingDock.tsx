import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { Theme } from '../constants/colors';

export type DockTab = 'home' | 'digest' | 'saved' | 'profile';

/**
 * Floating capsule dock — four tabs.
 *
 * «أخباري» was removed by explicit user decision (#27): it showed the same content
 * as «مصادري», so it was duplication rather than a destination. «الأكثر تداولاً»
 * left the dock at the same time and lives in the header next to the profile.
 * The user authorised touching this dock for that change, which overrides the
 * earlier "never touch the dock" rule for this one edit.
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
        active={active === 'digest'}
        icon="today-outline"
        label="الخلاصة"
        onPress={() => router.push('/digest')}
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
