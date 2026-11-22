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
  it('renders exactly the four approved tabs', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    for (const label of ['الرئيسية', 'الخلاصة', 'المحفوظات', 'مصادري']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
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

  it('gives every remaining tab a distinct icon', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    const labels = ['الرئيسية', 'الخلاصة', 'المحفوظات', 'مصادري'];
    const icons = labels.map((label) => iconFor(label));
    expect(icons.every(Boolean)).toBe(true);
    // No two tabs share an icon.
    expect(new Set(icons).size).toBe(icons.length);
  });
});
