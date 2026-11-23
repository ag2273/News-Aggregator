/**
 * Yallakora's scorer list, against the real markup.
 *
 * This is the source that settles the «هدافين بدقائق» question. The project twice
 * closed it as impossible after reading FilGoal's JSON payload; Yallakora's match
 * page carries a `playerScorers` block with a name and a minute per goal, on a
 * source whose robots.txt permits us and that we already read every minute.
 *
 * The fixture shape below is copied from a real page (match 112046,
 * الزمالك 2-1 المقاولون العرب, 2026-10-28) with the surrounding ad and tab markup
 * removed.
 */

import { describe, it, expect } from 'vitest';
import { parseYallakoraGoals } from '../yallakoraMatch.js';

const scorerBlock = (side: 'A' | 'B', rows: Array<{ name: string; minute?: string }>) => `
<div class="matcResultAction scorer">
  <div class="team team${side} playerScorers" actionList="5,6,7,8,10" parameters="112046 -- 4048 ">
    <div class="matchScorer">
      ${rows
        .map(
          (r) => `
        <div class="goal icon-goal ">
          <a class="player" href="/egyptian-league/3031/player/61655/x">
            <span class="playerName">${r.name}</span>
            ${r.minute === undefined ? '' : `<span class="time">${r.minute}</span>`}
          </a>
        </div>`,
        )
        .join('')}
    </div>
  </div>
</div>`;

describe('Yallakora scorers', () => {
  it('reads the scorer and the minute of each goal', () => {
    const html = scorerBlock('A', [
      { name: 'محمد حمد', minute: '46' },
      { name: 'شيكو بانزا', minute: '88' },
    ]);
    const goals = parseYallakoraGoals(html);
    expect(goals).toHaveLength(2);
    expect(goals[0]).toEqual({ minute: 46, player: 'محمد حمد', side: 'A', ownGoal: false });
    expect(goals[1]).toEqual({ minute: 88, player: 'شيكو بانزا', side: 'A', ownGoal: false });
  });

  it('keeps the two sides apart, which is what makes a score add up', () => {
    // Real fixture: الزمالك 2-1 المقاولون — two goals in column A, one in B.
    const html =
      scorerBlock('A', [
        { name: 'محمد حمد', minute: '46' },
        { name: 'شيكو بانزا', minute: '88' },
      ]) + scorerBlock('B', [{ name: 'محمد عبد الناصر', minute: '57' }]);
    const goals = parseYallakoraGoals(html);
    expect(goals.filter((g) => g.side === 'A')).toHaveLength(2);
    expect(goals.filter((g) => g.side === 'B')).toHaveLength(1);
  });

  it('keeps a scorer whose minute the page does not carry', () => {
    // A name with no minute is still a goal. Dropping it would lose a scorer;
    // inventing a minute would be worse.
    const goals = parseYallakoraGoals(scorerBlock('A', [{ name: 'لاعب بلا دقيقة' }]));
    expect(goals).toHaveLength(1);
    expect(goals[0]!.minute).toBeNull();
    expect(goals[0]!.player).toBe('لاعب بلا دقيقة');
  });

  it('rejects a minute that cannot be a goal', () => {
    const goals = parseYallakoraGoals(scorerBlock('A', [{ name: 'خطأ', minute: '999' }]));
    expect(goals[0]!.minute).toBeNull();
  });

  it('returns nothing for an unplayed match, rather than guessing', () => {
    expect(parseYallakoraGoals('<html><body>لا شيء</body></html>')).toEqual([]);
  });
});
