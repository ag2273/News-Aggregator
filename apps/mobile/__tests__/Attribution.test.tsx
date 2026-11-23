/**
 * #33 — attribution, tested against real fixtures from both sources.
 *
 * The user's report: «الجونة 0-2 الزمالك, and الزمالك's goals appear under الجونة».
 * The cause was a rendering swap: the header printed home first (the RIGHT column in
 * RTL) while the body put away first, so the two disagreed.
 *
 * These tests render `MatchTimeline` on its own and read its plain JSON output —
 * no React internals — so the assertion is about the column a reader sees.
 *
 * Fixtures are the live payloads, not invented shapes:
 *   - الزمالك 2-1 المقاولون: goals for BOTH teams, so a swap cannot hide;
 *   - الجونة 0-2 الزمالك: the exact match in the report;
 *   - ساسولو 0-2 جنوى: a European fixture, proving it is not source-specific.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { MatchTimeline } from '../components/MatchTimeline';
import { palette } from '../constants/colors';
import type { MatchEvent } from '../lib/api';

type Json = { type?: string; props?: Record<string, unknown>; children?: Json[] | null };

/** Every string in a rendered subtree. */
function texts(node: Json | null | undefined): string[] {
  if (!node) return [];
  const out: string[] = [];
  const walk = (n: Json | string) => {
    if (typeof n === 'string') return out.push(n);
    const kids = n.children;
    if (Array.isArray(kids)) kids.forEach(walk);
  };
  walk(node as Json);
  return out;
}

/** Flatten a rendered style prop to a searchable string. */
function styleOf(node: Json): string {
  const raw = node.props?.style;
  return JSON.stringify(raw ?? null);
}

/**
 * The column a label sits in, read from the CELL's own alignment.
 *
 * This is the signal that decides the column on screen: the home cell aligns to
 * flex-start (the right edge in RTL) and the away cell to flex-end. Asserting the
 * alignment rather than the child order is what makes the test fail when the
 * columns are swapped — child order alone stayed green through the bug.
 */
function columnOf(tree: Json, label: string): 'home' | 'away' | 'neutral' | 'none' {
  let found: 'home' | 'away' | 'neutral' | 'none' = 'none';
  const walk = (n: Json | string) => {
    if (typeof n === 'string' || !n) return;
    const style = styleOf(n);
    const has = texts(n).includes(label);
    if (has) {
      if (style.includes('neutralRow')) found = 'neutral';
      else if (style.includes('"alignItems":"flex-start"') && style.includes('"flex":1')) found = 'home';
      else if (style.includes('"alignItems":"flex-end"') && style.includes('"flex":1')) found = 'away';
    }
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
  // A neutral row wraps its label in the row itself, not in a side cell.
  if (found === 'none') {
    const walk2 = (n: Json | string) => {
      if (typeof n === 'string' || !n) return;
      if (styleOf(n).includes('neutralRow') && texts(n).includes(label)) found = 'neutral';
      (n.children ?? []).forEach(walk2);
    };
    walk2(tree);
  }
  return found;
}

const ev = (minute: number, player: string, side: 'r' | 'l' | null, type = 'هدف'): MatchEvent =>
  ({ minute, type, player, side });

describe('#33 attribution — real fixtures', () => {
  it('puts an Egyptian match with goals for BOTH teams in the right columns', () => {
    // الزمالك (home) 2-1 المقاولون (away). `r` is the page's right column = home.
    const { toJSON } = render(
      <MatchTimeline
        t={palette.light}
        home="الزمالك"
        away="المقاولون العرب"
        status="finished"
        events={[ev(88, 'شيكو بانزا', 'r'), ev(57, 'محمد عبد الناصر', 'l'), ev(46, 'محمد حمد', 'r')]}
      />,
    );
    const tree = toJSON() as unknown as Json;

    expect(columnOf(tree, 'شيكو بانزا')).toBe('home');
    expect(columnOf(tree, 'محمد حمد')).toBe('home');
    // The away goal is in the other column — this is the assertion that fails when
    // the two are swapped, which is exactly what the user saw.
    expect(columnOf(tree, 'محمد عبد الناصر')).toBe('away');
  });

  it('puts every goal of the reported match under the away club', () => {
    // الجونة 0-2 الزمالك — the exact fixture in the screenshot. Every goal is away.
    const { toJSON } = render(
      <MatchTimeline
        t={palette.light}
        home="الجونة"
        away="الزمالك"
        status="finished"
        events={[ev(17, 'عدي الدباغ', 'l'), ev(10, 'عدي الدباغ', 'l')]}
      />,
    );
    const tree = toJSON() as unknown as Json;
    expect(columnOf(tree, 'عدي الدباغ')).toBe('away');
  });

  it('behaves the same on a European fixture, so this is not an Egyptian-only path', () => {
    // ساسولو (home) 0-2 جنوى (away), Serie A.
    const { toJSON } = render(
      <MatchTimeline
        t={palette.light}
        home="ساسولو"
        away="جنوى"
        status="finished"
        events={[ev(63, 'كريستيان ثورستفيدت', 'r', 'بطاقة صفراء'), ev(38, 'ميلوتين أوسماييتش', 'l')]}
      />,
    );
    const tree = toJSON() as unknown as Json;
    expect(columnOf(tree, 'كريستيان ثورستفيدت')).toBe('home');
    expect(columnOf(tree, 'ميلوتين أوسماييتش')).toBe('away');
  });

  it('never attributes an unstamped row to a team', () => {
    const { toJSON } = render(
      <MatchTimeline
        t={palette.light}
        home="الجونة"
        away="الزمالك"
        status="finished"
        events={[ev(55, 'لاعب بلا فريق', null, 'تبديل')]}
      />,
    );
    const tree = toJSON() as unknown as Json;
    // The neutral row carries its own id, so the assertion does not depend on
    // guessing a style string.
    const neutral = JSON.stringify(tree).includes('timeline-neutral-row');
    expect(neutral).toBe(true);
    expect(texts(tree)).toContain('لاعب بلا فريق');
  });
});
