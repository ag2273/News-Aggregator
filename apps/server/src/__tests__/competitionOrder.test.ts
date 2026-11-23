/**
 * Per-user competition order (#26).
 *
 * The two things these pin, in order of importance:
 *   1. A reader who has NOT rearranged anything gets exactly the default order. The
 *      feature must add a preference, never change the Egypt-first default (#25) for
 *      everyone else.
 *   2. A saved order is applied without losing competitions: ids we no longer cover
 *      are dropped, and anything unranked keeps its default place afterwards.
 */

import { describe, it, expect } from 'vitest';
import {
  competitionOrderFor,
  defaultCompetitionOrder,
  normaliseCompetitionOrder,
} from '../competitionOrder.js';
import {
  clearCompetitionOrder,
  getCompetitionOrder,
  setCompetitionOrder,
  _resetFootballCache,
} from '../footballStore.js';
import { COMPETITIONS } from '../football.js';

describe('competition order', () => {
  it('serves the Egypt-first default to a reader who never rearranged', () => {
    _resetFootballCache();
    const order = competitionOrderFor(null);
    const ids = order.map((c) => c.id);
    // 1. Egypt is first, which is the whole point of the default (#25).
    expect(ids[0]).toBe('egyptian-premier');
    // 2. Every competition is present — an order must never hide one.
    expect(ids).toHaveLength(COMPETITIONS.length);
    // 3. A signed-in reader with no saved order gets the SAME list, not a variant.
    expect(competitionOrderFor('user-without-an-order').map((c) => c.id)).toEqual(ids);
  });

  it('keeps the default order byte-identical to the priority sort', () => {
    // Guards against the resolver quietly changing the default: it must equal the
    // ordering the app has been served since #25.
    const expected = [...COMPETITIONS]
      .sort((a, b) => a.priority - b.priority || a.nameAr.localeCompare(b.nameAr, 'ar'))
      .map((c) => c.id);
    expect(defaultCompetitionOrder().map((c) => c.id)).toEqual(expected);
  });

  it('applies a saved order, and leaves everything unranked in its default place', () => {
    _resetFootballCache();
    // The reader moves the Italian league to the top and says nothing about the rest.
    setCompetitionOrder('u1', ['ita-serie-a']);
    const ids = competitionOrderFor('u1').map((c) => c.id);

    expect(ids[0]).toBe('ita-serie-a');
    // Nothing lost.
    expect(ids).toHaveLength(COMPETITIONS.length);
    // The remainder is still the default order, starting with Egypt.
    expect(ids[1]).toBe('egyptian-premier');
  });

  it("honours the reader's relative order for several competitions", () => {
    _resetFootballCache();
    setCompetitionOrder('u2', ['saudi-pro-league', 'eng-premier', 'ita-serie-a']);
    const ids = competitionOrderFor('u2').map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual(['saudi-pro-league', 'eng-premier', 'ita-serie-a']);
  });

  it('is per user: one reader rearranging does not move another reader’s list', () => {
    _resetFootballCache();
    setCompetitionOrder('a', ['saudi-pro-league']);
    setCompetitionOrder('b', ['fra-ligue-1']);
    expect(competitionOrderFor('a').map((c) => c.id)[0]).toBe('saudi-pro-league');
    expect(competitionOrderFor('b').map((c) => c.id)[0]).toBe('fra-ligue-1');
    expect(competitionOrderFor('c').map((c) => c.id)[0]).toBe('egyptian-premier');
  });

  it('ignores an id we no longer cover instead of letting it take a slot', () => {
    _resetFootballCache();
    // A competition that was covered when the reader arranged the list and is not
    // now. The resolver must not serve a hole where it used to be.
    setCompetitionOrder('u3', ['gone-competition', 'esp-la-liga']);
    const ids = competitionOrderFor('u3').map((c) => c.id);
    expect(ids).not.toContain('gone-competition');
    expect(ids[0]).toBe('esp-la-liga');
    expect(ids).toHaveLength(COMPETITIONS.length);
  });

  it('drops unknown and duplicate ids when saving, rather than storing junk', () => {
    expect(normaliseCompetitionOrder(['egyptian-premier', 'nope', 'egyptian-premier', 42])).toEqual([
      'egyptian-premier',
    ]);
    expect(normaliseCompetitionOrder(['  ita-serie-a  '])).toEqual(['ita-serie-a']);
  });

  it('rejects a body that is not an array instead of saving something odd', () => {
    expect(normaliseCompetitionOrder('egyptian-premier')).toBeNull();
    expect(normaliseCompetitionOrder({ a: 1 })).toBeNull();
    expect(normaliseCompetitionOrder(null)).toBeNull();
  });

  it('falls back to the default after the saved order is cleared', () => {
    _resetFootballCache();
    setCompetitionOrder('u4', ['ger-bundesliga']);
    expect(competitionOrderFor('u4').map((c) => c.id)[0]).toBe('ger-bundesliga');
    clearCompetitionOrder('u4');
    expect(getCompetitionOrder('u4')).toEqual([]);
    expect(competitionOrderFor('u4').map((c) => c.id)[0]).toBe('egyptian-premier');
  });
});
