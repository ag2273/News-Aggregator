import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { Theme } from '../constants/colors';

export type DockTab = 'home' | 'video' | 'saved' | 'profile';

/** Floating white capsule dock: glowing home, video cam, bookmarks, profile. */
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
        active={active === 'video'}
        icon="videocam-outline"
        label="الأكثر تداولاً"
        onPress={() => router.push('/trending')}
      />
      <DockButton t={t} active={active === 'saved'} icon="bookmark-outline" label="المحفوظات" />
      <DockButton
        t={t}
        active={active === 'profile'}
        icon="person-outline"
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
      <View style={[styles.activeWrap, { shadowColor: t.dockActiveGradientEnd }]}>
        <LinearGradient
          colors={[t.dockActiveGradientStart, t.dockActiveGradientEnd]}
          style={styles.activeGradient}
        >
          <Ionicons name={icon} size={20} color={t.dockActiveIcon} />
        </LinearGradient>
      </View>
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
    width: 290,
    height: 62,
    borderRadius: 31,
    paddingHorizontal: 12,
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
