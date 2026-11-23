import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { Theme } from '../constants/colors';

export type DockTab = 'home' | 'digest' | 'matches' | 'saved' | 'profile';

/**
 * Floating capsule dock — five tabs.
 *
 * «أخباري» was removed by explicit user decision (#27): it showed the same content
 * as «مصادري», so it was duplication rather than a destination. «الأكثر تداولاً»
 * left the dock at the same time and lives in the header next to the profile.
 *
 * The FOOTBALL entry lives here too (#31). #29 read the approved design's header
 * and put the ball in its leading slot; the user's own screenshot and the design
 * file both disagree with that — the file's dock is «🏠 الرئيسية · ✨ أخباري ·
 * ⚽ مباريات · 🔖 المحفوظات · 📰 مصادري», so football is a dock tab, and the file
 * wins on any question of placement.
 *
 * The order is the file's, right to left as it renders in RTL: الرئيسية first.
 */
export function FloatingDock({
  t,
  active,
  footballLive = false,
}: {
  t: Theme;
  active: DockTab;
  /**
   * A match the reader cares about is running.
   *
   * This used to be a pulsing dot on the header's football button. The button
   * moved into the dock (#31), so the signal moves with it — a live match should
   * still be visible from the home screen, and the tab is now where the ball is.
   */
  footballLive?: boolean;
}) {
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
        active={active === 'matches'}
        icon="football-outline"
        label="مباريات"
        live={footballLive}
        onPress={() => router.push('/matches')}
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
  live = false,
  onPress,
}: {
  t: Theme;
  active: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  /** A live match is on: a small dot on the icon, with an honest label. */
  live?: boolean;
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
        {/* The approved design labels every dock tab under its icon, and colours
            the active label with the accent. An icon-only dock was one of the
            "not exactly the file" gaps. */}
        <Text style={[styles.label, { color: t.accent }]} numberOfLines={1}>
          {label}
        </Text>
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
      <View>
        <Ionicons name={icon} size={22} color={t.textMuted} />
        {live ? <View style={[styles.liveDot, { backgroundColor: t.liveRed }]} /> : null}
      </View>
      <Text style={[styles.label, { color: t.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
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
    // 62 could not hold an icon plus a label; the design's dock is 64 tall with
    // both, so the height follows the content rather than clipping the label.
    height: 72,
    borderRadius: 31,
    // FIVE 56px tabs need 280px; with 24px of padding and 8px of gaps that is
    // 312, so the 320 capsule holds all five without dropping one. The active tab
    // is the same width as the others now that there are five — a wider active
    // wrap is what pushed the fifth label off a 360dp phone.
    paddingHorizontal: 12,
    gap: 2,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  dockItem: {
    width: 56,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  activeWrap: {
    width: 56,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  activeGradient: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    position: 'absolute',
    top: -1,
    insetInlineEnd: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    fontFamily: 'Cairo_700Bold',
    fontSize: 9,
    lineHeight: 13,
    textAlign: 'center',
  },
});
