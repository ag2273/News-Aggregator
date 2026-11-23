// Per-user competition order (#26).
//
// The default order has been data since #25: every competition carries a `priority`
// and the three screens that group by competition sort on it. This file adds the
// reader's own order on top, without ever breaking that default.
//
// Why ACCOUNT and not device
// --------------------------
// The issue asks for «ترتيب مخصص محفوظ لكل مستخدم موثق» — a verified user's order.
// Account is also the right call for two reasons a device store cannot answer:
//   1. The app is already account-bound for the things that would sit next to this:
//      team follows and league follows are per-user, gated on a verified session.
//      A device-only order would be the one preference that silently vanished on a
//      reinstall or a new phone while its neighbours came back from the server.
//   2. The order has to agree across screens. The matches groups, the standings
//      strip and the competition catalogue all render from the server, so an order
//      the server does not know about would apply to one screen and not the others.
// A guest still gets the default order, because that is what everyone gets before
// they rearrange anything — no sign-in wall on reading the board.

import { COMPETITIONS, type Competition } from './football.js';
import { getCompetitionOrder } from './footballStore.js';

/** The default order: Egypt first, then the served priority, ties on the name. */
export function defaultCompetitionOrder(): Competition[] {
  return [...COMPETITIONS].sort(
    (a, b) => a.priority - b.priority || a.nameAr.localeCompare(b.nameAr, 'ar'),
  );
}

/**
 * The order to serve this caller.
 *
 * A saved order is a PREFERENCE, not a source of truth about which competitions
 * exist: ids that are no longer covered are ignored, and anything the reader has
 * never ranked keeps its default position after the ranked ones. That way adding a
 * competition tomorrow does not hide it from someone who ranked the list today.
 */
export function competitionOrderFor(userId: string | null): Competition[] {
  const base = defaultCompetitionOrder();
  if (!userId) return base;

  const saved = getCompetitionOrder(userId);
  if (!saved.length) return base;

  const rank = new Map<string, number>();
  for (const [index, id] of saved.entries()) rank.set(id, index);

  return [...base].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    // Ranked ids first, in the reader's order…
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    // …then everything else exactly as the default ordered it.
    return a.priority - b.priority || a.nameAr.localeCompare(b.nameAr, 'ar');
  });
}

/**
 * Validate and normalise a submitted order.
 *
 * Returns the ids that are actually covered competitions, de-duplicated and in the
 * submitted order. Unknown ids are dropped rather than stored: a saved list is read
 * back on every request, so it must not accumulate ids that no longer exist.
 */
export function normaliseCompetitionOrder(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const known = new Set(COMPETITIONS.map((c) => c.id));
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim();
    if (!known.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}
