/**
 * The dock must keep every tab the reader already uses.
 *
 * A regression shipped once: الخلاصة was added by REPLACING الأكثر تداولاً, and it
 * reused مصادري's icon. These tests exist so that cannot happen again — the dock
 * renders all six tabs, each with a distinct icon, and trending is still there.
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
  it('renders every tab, including الأكثر تداولاً and مصادري', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    for (const label of [
      'الرئيسية',
      'أخباري',
      'الخلاصة',
      'الأكثر تداولاً',
      'المحفوظات',
      'مصادري',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('keeps trending pointing at /trending', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    (router.push as jest.Mock).mockClear();
    fireEvent.press(screen.getByLabelText('الأكثر تداولاً'));
    expect(router.push).toHaveBeenCalledWith('/trending');
  });

  it('opens the digest from its own tab', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    (router.push as jest.Mock).mockClear();
    fireEvent.press(screen.getByLabelText('الخلاصة'));
    expect(router.push).toHaveBeenCalledWith('/digest');
  });

  it('gives every tab a distinct icon', () => {
    render(<FloatingDock t={palette.light} active={'home' as DockTab} />);
    const icons = ['الرئيسية', 'أخباري', 'الخلاصة', 'الأكثر تداولاً', 'المحفوظات', 'مصادري'].map(
      (label) => iconFor(label),
    );
    expect(icons.every(Boolean)).toBe(true);
    // The digest icon must not be مصادري's icon again.
    const digestIcon = iconFor('الخلاصة');
    const sourcesIcon = iconFor('مصادري');
    expect(digestIcon).not.toBe(sourcesIcon);
    // No two tabs share an icon at all.
    expect(new Set(icons).size).toBe(icons.length);
  });
});
