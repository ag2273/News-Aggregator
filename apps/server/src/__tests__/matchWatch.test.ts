import { describe, it, expect, beforeEach } from 'vitest';
import {
  stepMatch,
  watchMatch,
  unwatchMatch,
  getMatchWatches,
  watchersOf,
  _resetMatchWatches,
  MAX_WATCHES_PER_USER,
} from '../matchWatch.js';
import { parseFilGoalTimeline, parseYallakoraEvents, parseEspnKeyEvents, type LiveTimeline } from '../liveTimeline.js';
import type { MatchRow } from '../football.js';

const base: MatchRow = {
  id: 'fg-1', competitionId: 'egyptian-premier', competitionName: 'الدوري المصري',
  home: 'الأهلي', away: 'الزمالك', homeScore: null, awayScore: null,
  status: 'upcoming', statusText: 'لم تبدأ', kickoff: '20:00', round: null, minute: null,
  dataSource: 'filgoal', providerMatchId: '1',
};
const m = (over: Partial<MatchRow>): MatchRow => ({ ...base, ...over });
const live = (h: number, a: number): MatchRow => m({ status: 'live', statusText: 'مباشر', homeScore: h, awayScore: a });
const tl = (over: Partial<LiveTimeline>): LiveTimeline => ({ source: 'yallakora', events: [], phases: [], ...over });
const D = '2026-11-27';

/** Run a sequence of polls and collect the titles of what was announced. */
function run(polls: Array<[MatchRow, LiveTimeline | null]>): string[][] {
  let state: ReturnType<typeof stepMatch>['state'] | undefined;
  return polls.map(([row, timeline]) => {
    const step = stepMatch(state, row, D, timeline);
    state = step.state;
    return step.pushes.map((p) => p.title);
  });
}

describe('Yallakora events tab', () => {
  const html = `<div class="timeline events"><div class="cnts"><ul>
    <li class="referee"><div class="min">0</div><p class="description"></p></li>
    <li class="right goal "><div class="min">13</div><p class="description"><span></span> فلوريان فريتز <span class="assister">(ريو نجوموها)</span></p></li>
    <li class="left sub "><div class="min">22</div><p class="description"><span class="subIn">هاري ماجواير</span><span class="subOut">بريان مبيومو</span></p></li>
    <li class="left redCard "><div class="min">89</div><p class="description"><span></span> كوستينها </p></li>
    <li class="right yellowCard "><div class="min">90+2</div><p class="description"><span></span> برادلي باركولا </p></li>
  </ul></div></div><div class="centerSC">`;

  it('reads goals with the assister, subs, and cards, right column = home', () => {
    expect(parseYallakoraEvents(html)).toEqual([
      { kind: 'goal', minute: '13', player: 'فلوريان فريتز', other: 'ريو نجوموها', side: 'home' },
      { kind: 'sub', minute: '22', player: 'هاري ماجواير', other: 'بريان مبيومو', side: 'away' },
      { kind: 'red', minute: '89', player: 'كوستينها', other: null, side: 'away' },
      { kind: 'yellow', minute: '90+2', player: 'برادلي باركولا', other: null, side: 'home' },
    ]);
  });

  it('returns nothing for the «no data yet» stub', () => {
    expect(
      parseYallakoraEvents('<div class="timeline events"><div class="cnts"><div class="empty-tab"><p>ليس لدينا بيانات متوفرة حتى الان</p></div></div></div>'),
    ).toEqual([]);
  });
});

describe('FilGoal timeline', () => {
  const html = `<ul class="match-events-container" data-match-id="1">
    <li><h3>الشوط الثاني</h3></li>
    <li><span class=""> 54 </span>
      <p class="l"><img alt="بطاقة صفراء"><a href="/players/1/a">كيكي كوياتي</a></p>
      <p class="r"><img alt="بطاقة صفراء"><a href="/players/2/b">كوبا دا كوستا</a></p></li>
    <li><span class="extra"> 90 <b>+6</b> </span><p class="l"><img alt="هدف"><a href="/players/3/c">علي ياسر</a></p></li>
    <li><span class=""> 7 </span><p class="l"><img alt="إحراز ركلة جزاء"><a href="/players/4/d">جوشوا كينج</a></p></li>
    <li><h3>استراحة</h3></li>
    <li><h3>الشوط الاول</h3></li>
    <li><h3>لم تبدأ</h3></li>
  </ul>`;

  it('keeps both rows of one minute, stoppage time as published, and the phases', () => {
    const t = parseFilGoalTimeline(html);
    expect(t.events).toEqual([
      { kind: 'yellow', minute: '54', player: 'كيكي كوياتي', other: null, side: 'away' },
      { kind: 'yellow', minute: '54', player: 'كوبا دا كوستا', other: null, side: 'home' },
      { kind: 'goal', minute: '90+6', player: 'علي ياسر', other: null, side: 'away' },
      { kind: 'penaltyGoal', minute: '7', player: 'جوشوا كينج', other: null, side: 'away' },
    ]);
    expect(t.phases).toEqual(['secondHalf', 'halftime', 'firstHalf']);
  });
});

describe('ESPN key events', () => {
  it('maps types, sides by team id, and phases', () => {
    const json = {
      header: { competitions: [{ competitors: [{ homeAway: 'home', team: { id: '364' } }, { homeAway: 'away', team: { id: '360' } }] }] },
      keyEvents: [
        { type: { type: 'kickoff' }, clock: { displayValue: '' } },
        { type: { type: 'red-card' }, clock: { displayValue: "8'" }, team: { id: '360' }, participants: [{ athlete: { displayName: 'Leny Yoro' } }] },
        { type: { type: 'goal---free-kick' }, clock: { displayValue: "10'" }, team: { id: '364' }, participants: [{ athlete: { displayName: 'Dominik Szoboszlai' } }] },
        { type: { type: 'halftime' }, clock: { displayValue: "45'+5'" } },
      ],
    };
    const t = parseEspnKeyEvents(json);
    expect(t.phases).toEqual(['firstHalf', 'halftime']);
    expect(t.events).toEqual([
      { kind: 'red', minute: '8', player: 'Leny Yoro', other: null, side: 'away' },
      { kind: 'goal', minute: '10', player: 'Dominik Szoboszlai', other: null, side: 'home' },
    ]);
  });
});

describe('match follow: what gets announced', () => {
  const goal = { kind: 'goal' as const, minute: '23', player: 'إمام عاشور', other: 'زيزو', side: 'home' as const };
  const card = { kind: 'yellow' as const, minute: '30', player: 'عبد الله السعيد', other: null, side: 'away' as const };

  it('announces nothing on the first look, even mid-match', () => {
    const out = run([[live(1, 0), tl({ events: [goal, card], phases: ['firstHalf'] })]]);
    expect(out).toEqual([[]]);
  });

  it('announces kick-off, a goal with its scorer, a card, half-time and full time', () => {
    const out = run([
      [m({}), null],
      [live(0, 0), tl({ phases: ['firstHalf'] })],
      [live(1, 0), tl({ events: [goal], phases: ['firstHalf'] })],
      [live(1, 0), tl({ events: [goal, card], phases: ['firstHalf'] })],
      [live(1, 0), tl({ events: [goal, card], phases: ['firstHalf', 'halftime'] })],
      [live(1, 0), tl({ events: [goal, card], phases: ['firstHalf', 'halftime', 'secondHalf'] })],
      [m({ status: 'finished', statusText: 'انتهت', homeScore: 1, awayScore: 0 }), tl({ events: [goal, card], phases: ['final'] })],
    ]);
    expect(out[0]).toEqual([]);
    expect(out[1]).toEqual(['🟢 بدأت المباراة']);
    expect(out[2]).toEqual(['⚽ جوووول للأهلي! الأهلي 1 - 0 الزمالك']);
    expect(out[3]).toEqual(['🟨 إنذار — الزمالك']);
    expect(out[4]).toEqual(['⏸️ نهاية الشوط الأول']);
    expect(out[5]).toEqual(['▶️ بداية الشوط الثاني']);
    expect(out[6]).toEqual(['🏁 انتهت المباراة']);
  });

  it('waits two polls for the scorer, then sends the goal with the club and score only', () => {
    const out = run([
      [live(0, 0), null],
      [live(0, 1), tl({})],
      [live(0, 1), tl({})],
      [live(0, 1), tl({})],
      // The row arrives late: it is not a second goal.
      [live(0, 1), tl({ events: [{ ...goal, side: 'away' }] })],
    ]);
    expect(out[1]).toEqual([]);
    expect(out[2]).toEqual([]);
    expect(out[3]).toEqual(['⚽ جوووول للزمالك!']);
    expect(out[4]).toEqual([]);
  });

  it('never announces a goal row when the score did not move', () => {
    const out = run([
      [live(0, 0), tl({})],
      [live(0, 0), tl({ events: [goal] })],
      [live(0, 0), tl({ events: [goal] })],
      [live(0, 0), tl({ events: [goal] })],
      [live(0, 0), tl({ events: [goal] })],
      [live(0, 0), tl({ events: [goal] })],
    ]);
    expect(out.flat()).toEqual([]);
  });

  it('takes the score a match shows when it leaves «unknown» as where it is, not as goals', () => {
    const out = run([
      [m({ status: 'unknown', statusText: '' }), null],
      [live(1, 1), tl({})],
      [live(1, 1), tl({})],
      [live(1, 1), tl({})],
    ]);
    expect(out.flat()).toEqual([]);
  });

  it('does not call «بعد قليل» (unknown) a kick-off; the kick-off is when it goes live', () => {
    const out = run([
      [m({}), null],
      [m({ status: 'unknown', statusText: 'بعد قليل' }), null],
      [live(0, 0), tl({})],
    ]);
    expect(out).toEqual([[], [], ['🟢 بدأت المباراة']]);
  });

  it('drops a pending goal the score takes back, without a correction', () => {
    const out = run([
      [live(1, 0), tl({})],
      [live(3, 0), tl({})],
      [live(2, 0), tl({})],
      [live(2, 0), tl({})],
      [live(2, 0), tl({})],
    ]);
    expect(out.flat()).toEqual(['⚽ جوووول للأهلي!']);
  });

  it('sends a last-minute goal before the final whistle, and nothing after it', () => {
    const fin = (h: number, a: number) => m({ status: 'finished', statusText: 'انتهت', homeScore: h, awayScore: a });
    const out = run([
      [live(3, 0), tl({})],
      [live(3, 1), tl({ phases: ['final'] })],
      [fin(3, 1), tl({ phases: ['final'] })],
    ]);
    expect(out[1]).toEqual(['⚽ جوووول للزمالك!', '🏁 انتهت المباراة']);
    expect(out[2]).toEqual([]);
  });

  it('records a back-fill of many rows without announcing them', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...card, minute: String(10 + i), player: `لاعب ${i}` }));
    const out = run([
      [live(0, 0), tl({})],
      [live(0, 0), tl({ events: many })],
    ]);
    expect(out.flat()).toEqual([]);
  });

  it('announces a goal taken back only once the lower score holds', () => {
    const out = run([
      [live(1, 0), tl({})],
      [live(0, 0), tl({})],
      [live(0, 0), tl({})],
    ]);
    expect(out[1]).toEqual([]);
    expect(out[2]).toEqual(['↩️ تعديل في النتيجة']);
  });

  it('keeps the source that gave the first rows, so one card is not sent twice', () => {
    const out = run([
      [live(0, 0), tl({ source: 'yallakora' })],
      [live(0, 0), tl({ source: 'yallakora', events: [card] })],
      [live(0, 0), tl({ source: 'filgoal', events: [{ ...card, player: 'عبدالله السعيد' }] })],
    ]);
    expect(out[1]).toEqual(['🟨 إنذار — الزمالك']);
    expect(out[2]).toEqual([]);
  });
});

describe('match follow store', () => {
  beforeEach(() => _resetMatchWatches());

  it('follows, refuses a finished match, caps the list, and unfollows', () => {
    expect(watchMatch('u1', live(0, 0), D).ok).toBe(true);
    expect(watchMatch('u1', live(0, 0), D)).toMatchObject({ ok: true });
    expect(getMatchWatches('u1')).toHaveLength(1);
    expect(watchersOf('fg-1')).toEqual(new Set(['u1']));
    expect(watchMatch('u1', m({ id: 'fg-2', status: 'finished' }), D)).toEqual({ ok: false, reason: 'finished' });
    for (let i = 0; i < MAX_WATCHES_PER_USER + 2; i += 1) watchMatch('u1', m({ id: `fg-x${i}` }), D);
    expect(getMatchWatches('u1')).toHaveLength(MAX_WATCHES_PER_USER);
    unwatchMatch('u1', 'fg-1');
    expect(watchersOf('fg-1').size).toBe(0);
  });
});
