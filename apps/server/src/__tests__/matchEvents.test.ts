/**
 * The match timeline, against real FilGoal markup.
 *
 * The ticket that opened this said a goal timeline was impossible. It was
 * measured against the page's JSON payload, which has no `MatchEvents` — the
 * events live in the page's own `match-events-container` markup, which nobody had
 * read. These tests are built on a captured real page so the fix cannot silently
 * regress to "impossible".
 *
 * The fixtures are trimmed to the structure that matters: the `<li>` rows, the
 * minute span, the event's `alt` label, the player link, and the `r`/`l` column.
 */

import { describe, it, expect } from 'vitest';
import { parseMatchEvents, playableEvents } from '../matchEvents.js';

const row = (minute: string, kind: string, player: string, side: 'r' | 'l') => `
  <li>
    <span class="">${minute}</span>
    <p class="${side}">
      <img src="//semedia.filgoal.com/Photos/Event/8.png" alt="${kind}" title="${kind}">
      <a target="_blank" href="/players/117622/x">${player}</a>
    </p>
  </li>`;

const page = (rows: string) => `
<div id="mc-events">
  <div id="mc-e-body">
    <ul class="match-events-container" data-match-id="375930">
      <li><h3>انتهت</h3></li>
      ${rows}
    </ul>
  </div>
</div>`;

describe('match events', () => {
  it('reads goals with their minute and scorer, as the box publishes them', () => {
    const events = playableEvents(parseMatchEvents(page(row('88', 'هدف', 'شيكو بانزا', 'r'))));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      minute: 88,
      type: 'هدف',
      player: 'شيكو بانزا',
      side: 'r',
      isStatus: false,
    });
  });

  it('reconciles with the published score on a real Egyptian fixture', () => {
    // الزمالك 2-1 المقاولون العرب, 2026-10-28. Three goals: two in the right
    // column, one in the left. If the parser ever scrambles sides, or invents a
    // minute, this stops matching the score the source itself published.
    const html = page(
      [
        row('88', 'هدف', 'شيكو بانزا', 'r'),
        row('81', 'بطاقة صفراء', 'أحمد شريف', 'r'),
        row('57', 'هدف', 'محمد عبد الناصر', 'l'),
        row('46', 'هدف', 'محمد حمد', 'r'),
      ].join(''),
    );
    const goals = playableEvents(parseMatchEvents(html)).filter((e) => /هدف/.test(e.type));
    expect(goals.filter((g) => g.side === 'r')).toHaveLength(2);
    expect(goals.filter((g) => g.side === 'l')).toHaveLength(1);
    expect(goals.map((g) => g.minute)).toEqual([88, 57, 46]);
  });

  it('keeps cards as events, because the source publishes them too', () => {
    const events = playableEvents(parseMatchEvents(page(row('81', 'بطاقة صفراء', 'أحمد شريف', 'r'))));
    expect(events[0]!.type).toBe('بطاقة صفراء');
    expect(events[0]!.minute).toBe(81);
  });

  it('drops status rows from the timeline, so «انتهت» is not an event', () => {
    const all = parseMatchEvents(page(row('46', 'هدف', 'محمد حمد', 'r')));
    expect(all.some((e) => e.isStatus)).toBe(true);
    expect(playableEvents(all).every((e) => !e.isStatus)).toBe(true);
  });

  it('returns nothing for an unplayed match, rather than guessing', () => {
    // The real markup of an upcoming match: the block exists with status rows.
    const upcoming = `<ul class="match-events-container"><li><h3>لم تبدأ</h3></li></ul>`;
    expect(playableEvents(parseMatchEvents(upcoming))).toHaveLength(0);
  });

  it('returns nothing when the page has no events block at all', () => {
    expect(parseMatchEvents('<html><body>لا شيء</body></html>')).toEqual([]);
  });

  it('rejects a minute outside a match, so a stray number is not an event', () => {
    const events = playableEvents(parseMatchEvents(page(row('999', 'هدف', 'خطأ', 'r'))));
    expect(events).toHaveLength(0);
  });

  it('drops a row with no event label instead of showing a bare minute', () => {
    const noLabel = `
      <ul class="match-events-container">
        <li><span>55</span><p class="r"><a href="/players/1/x">لاعب</a></p></li>
      </ul>`;
    expect(playableEvents(parseMatchEvents(noLabel))).toHaveLength(0);
  });
});
