/**
 * Design tokens — mirrors docs/VISUAL-DIRECTION.md §3 exactly.
 * Light is the default; dark mirrors the forest-obsidian palette.
 */

export const palette = {
  light: {
    // Background gradient (vertical, soft sage)
    bgGradientTop: '#E6F0E9',
    bgGradientMid: '#EEF6F1',
    bgGradientBottom: '#8FB99F',

    // Surfaces
    surface: '#FFFFFF',
    surfaceTranslucent: 'rgba(255, 255, 255, 0.85)',
    surfaceFrosted: 'rgba(255, 255, 255, 0.45)',

    // Floating dock
    dockBg: '#FFFFFF',
    dockShadow: 'rgba(0, 0, 0, 0.12)',
    dockActiveGradientStart: '#34D399',
    dockActiveGradientEnd: '#10B981',
    dockActiveIcon: '#064E3B',

    // Text
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#64748B',

    // Pills
    pillActiveBg: '#0F172A',
    pillActiveText: '#FFFFFF',
    pillInactiveBg: '#FFFFFF',
    pillInactiveText: '#475569',

    // Badges / accents
    verified: '#2563EB',
    breaking: '#EF4444',
    accent: '#10B981',

    // Borders
    borderLight: 'rgba(226, 232, 240, 0.6)',

    // --- compatibility aliases used by older screens ---
    background: '#EEF6F1',
    surfaceSubtle: 'rgba(255, 255, 255, 0.85)',
    dockActiveGlow: '#10B981',
    border: 'rgba(226, 232, 240, 0.6)',
    breakingBg: '#FEF2F2',
    followedBg: '#E8F7EE',
    followedText: '#047857',
  },
  dark: {
    bgGradientTop: '#0B1511',
    bgGradientMid: '#12221B',
    bgGradientBottom: '#07100D',

    surface: '#182721',
    surfaceTranslucent: 'rgba(24, 39, 33, 0.85)',
    surfaceFrosted: 'rgba(0, 0, 0, 0.45)',

    dockBg: '#182721',
    dockShadow: 'rgba(0, 0, 0, 0.4)',
    dockActiveGradientStart: '#10B981',
    dockActiveGradientEnd: '#059669',
    dockActiveIcon: '#ECFDF5',

    textPrimary: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textMuted: '#94A3B8',

    pillActiveBg: '#F1F5F9',
    pillActiveText: '#0F172A',
    pillInactiveBg: 'rgba(255, 255, 255, 0.1)',
    pillInactiveText: '#CBD5E1',

    verified: '#3B82F6',
    breaking: '#F87171',
    accent: '#34D399',

    borderLight: 'rgba(255, 255, 255, 0.1)',

    // --- compatibility aliases ---
    background: '#12221B',
    surfaceSubtle: 'rgba(24, 39, 33, 0.85)',
    dockActiveGlow: '#34D399',
    border: 'rgba(255, 255, 255, 0.1)',
    breakingBg: '#3B1215',
    followedBg: '#14301F',
    followedText: '#6EE7B7',
  },
};

export type Theme = (typeof palette)['light'];
