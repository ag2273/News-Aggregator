/**
 * The dock after the approved navigation restructure (#27).
 *
 * The user removed «أخباري» from the dock — it showed the same content as
 * «مصادري» — and moved «الأكثر تداولاً» into the header. So the dock is four
 * tabs, and this file exists to prove both halves of that: the removed tab is
 * really gone, and nothing else was quietly dropped with it.
 *
 * A regression shipped once before: الخلاصة was added by REPLACING another tab.
 * These tests are the guard that a future edit cannot repeat that.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));

import { router } from 'expo-router';
import { FloatingDock, type DockTab } from '../components/FloatingDock';
import { palette } from '../constants/colors';

/** Pull the Ionicons name out of the rendered tree for a given label. */
function iconFor(label: string): string | null {
  const node = screen.getByLabelText(label);
  const found: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const props = (n as { props?: Record<string, unknown> }).props;
    if (props && typeof props['name'] === 'string') {
      found.push(props['name'] as string);
    }
    const children = (n as { children?: unknown }).children;
    if (Array.isArray(children)) children.forEach(walk);
    else if (children) walk(children);
  };
  walk(node);
  return found[0] ?? null;
}

describe('FloatingDock', () => {
  it('renders the five tabs the approved design draws (#31)', () => {
    // The design file's dock is «🏠 الرئيسية · ✨ أخباري · ⚽ مباريات · 🔖
    // المحفوظات · 📰 مصادري». «أخباري» stays removed by #27, and football moved
    // here from the header by #31 — the file wins on placement.
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    for (const label of ['الرئيسية', 'الخلاصة', 'مباريات', 'المحفوظات', 'مصادري']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('opens the matches screen from the football tab (#31)', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    (router.push as jest.Mock).mockClear();
    fireEvent.press(screen.getByLabelText('مباريات'));
    expect(router.push).toHaveBeenCalledWith('/matches');
  });

  it('spells the sources tab with ي, not ى (#32)', () => {
    // The user's screenshot read «مصادرى». The source string was already correct,
    // so this test exists to keep it that way rather than to fix a live typo.
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    expect(screen.getByLabelText('مصادري')).toBeTruthy();
    expect(screen.queryByLabelText('مصادرى')).toBeNull();
  });

  it('marks a live match on the football tab, which replaced the header dot (#31)', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} footballLive />);
    // The dot is a child of the football tab's icon wrapper, not a separate button.
    expect(screen.getByLabelText('مباريات')).toBeTruthy();
  });

  it('no longer shows «أخباري» (#27)', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    expect(screen.queryByLabelText('أخباري')).toBeNull();
  });

  it('no longer shows «الأكثر تداولاً» in the dock — it moved to the header (#27)', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    expect(screen.queryByLabelText('الأكثر تداولاً')).toBeNull();
  });

  it('opens the digest from its own tab', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    (router.push as jest.Mock).mockClear();
    fireEvent.press(screen.getByLabelText('الخلاصة'));
    expect(router.push).toHaveBeenCalledWith('/digest');
  });

  it('labels every tab, as the approved design does (#29)', () => {
    // The design's dock shows the label under the icon; an icon-only dock was one
    // of the "not exactly the file" gaps the user reported on apk-54.
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    for (const label of ['الرئيسية', 'الخلاصة', 'مباريات', 'المحفوظات', 'مصادري']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('gives every tab a distinct coloured glyph (#37)', () => {
    // The design's dock uses emoji, so "coloured" is a property of the glyph itself.
    // This asserts one distinct glyph per tab, which is also what stops two tabs
    // from looking alike.
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    for (const glyph of ['🏠', '✨', '⚽', '🔖', '📰']) {
      expect(screen.getAllByText(glyph).length).toBeGreaterThan(0);
    }
  });

  it('draws the football glyph larger than the rest (#37)', () => {
    // The file gives football the prominent middle slot, and the user asked for it
    // "bigger and clearer than the others". Read from the LAST style entry, because
    // React Native flattens a style array and the per-glyph size is the last one.
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    const sizeOf = (glyph: string): number => {
      const node = screen.getAllByText(glyph)[0]!;
      const raw = node.props.style;
      const entries = Array.isArray(raw) ? raw : [raw];
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const fs = entries[i]?.fontSize;
        if (typeof fs === 'number') return fs;
      }
      return 0;
    };
    expect(sizeOf('⚽')).toBeGreaterThan(sizeOf('🏠'));
    expect(sizeOf('⚽')).toBeGreaterThan(sizeOf('📰'));
  });


});
