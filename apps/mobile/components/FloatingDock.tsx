import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { Theme } from '../constants/colors';

export type DockTab = 'home' | 'digest' | 'matches' | 'saved' | 'profile';

/**
 * Floating capsule dock — five tabs, coloured glyphs.
 *
 * «أخباري» was removed by explicit user decision (#27): it showed the same content
 * as «مصادري». The FOOTBALL entry lives here (#31), because the design file's dock
 * is «🏠 الرئيسية · ✨ أخباري · ⚽ مباريات · 🔖 المحفوظات · 📰 مصادري».
 *
 * COLOUR (#37). The design draws these as emoji — 🏠 ✨ ⚽ 🔖 📰 — which carry their own
 * colour on every platform. The app had replaced them with monochrome Ionicons, so
 * four grey glyphs sat in an otherwise colourful bar. The emoji are back, and the
 * ball is drawn larger than the rest because the file gives football the prominent
 * slot in the middle.
 *
 * The active tab keeps the file's treatment: a filled gradient circle behind the
 * glyph and the accent colour on its label. An inactive tab is NOT grey-silent any
 * more — its glyph keeps its own colour; only the label dims.
 */

/** The file's icons, with football at the size the design gives it. */
const DOCK_ICON: Record<DockTab, string> = {
  home: '🏠',
  digest: '✨',
  matches: '⚽',
  saved: '🔖',
  profile: '📰',
};

export function FloatingDock({
  t,
  active,
  footballLive = false,
}: {
  t: Theme;
  active: DockTab;
  /**
   * A match the reader cares about is running: a dot on the football glyph. It used
   * to pulse on a header button; that button moved into the dock (#31).
   */
  footballLive?: boolean;
}) {
  const tabs: Array<{ id: DockTab; label: string; onPress: () => void }> = [
    { id: 'home', label: 'الرئيسية', onPress: () => router.replace('/') },
    { id: 'digest', label: 'الخلاصة', onPress: () => router.push('/digest') },
    { id: 'matches', label: 'مباريات', onPress: () => router.push('/matches') },
    { id: 'saved', label: 'المحفوظات', onPress: () => router.push('/saved') },
    { id: 'profile', label: 'مصادري', onPress: () => router.push('/sources') },
  ];

  return (
    <View style={[styles.dock, { backgroundColor: t.dockBg, shadowColor: t.dockShadow }]}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const isFootball = tab.id === 'matches';
        return (
          <TouchableOpacity
            key={tab.id}
            style={isActive ? styles.activeWrap : styles.dockItem}
            onPress={tab.onPress}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={isActive ? { selected: true } : undefined}
          >
            {isActive ? (
              <LinearGradient
                colors={[t.dockActiveGradientStart, t.dockActiveGradientEnd]}
                style={[styles.activeGradient, isFootball && styles.activeGradientFootball]}
              >
                <Text style={[styles.glyph, isFootball && styles.glyphFootball]}>
                  {DOCK_ICON[tab.id]}
                </Text>
              </LinearGradient>
            ) : (
              <View style={styles.glyphWrap}>
                <Text style={[styles.glyph, isFootball && styles.glyphFootball]}>
                  {DOCK_ICON[tab.id]}
                </Text>
                {isFootball && footballLive ? (
                  <View style={[styles.liveDot, { backgroundColor: t.liveRed }]} />
                ) : null}
              </View>
            )}
            <Text
              style={[styles.label, { color: isActive ? t.accent : t.textMuted }]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
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
    height: 72,
    borderRadius: 31,
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
  },
  glyphWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  // Emoji already carry colour, so no tint is applied — that is the #37 request.
  glyph: { fontSize: 19, lineHeight: 24 },
  // The file gives football the prominent middle slot; a larger glyph reads as that.
  glyphFootball: { fontSize: 25, lineHeight: 29 },
  activeGradient: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The ball is larger, so its active plate is too — otherwise the glyph would
  // overflow the circle it sits in.
  activeGradientFootball: { width: 34, height: 34, borderRadius: 17 },
  liveDot: {
    position: 'absolute',
    top: 0,
    right: -3,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: { fontFamily: 'Cairo_700Bold', fontSize: 9, lineHeight: 13, textAlign: 'center' },
});
