// The live timeline of one match, read from the sources, in one shape.
//
// Used by the match watch (matchWatch.ts): a reader follows ONE match and is told
// about every event in it. The events are read, never derived — a card the source
// did not publish is not announced, and a minute the source did not publish is not
// filled in from the clock.
//
// MEASURED 2026-11-27, three sources, three shapes:
//
//   * Yallakora's match page has an «أحداث المباراة» tab, server-rendered, with one
//     `<li class="right|left goal|sub|yellowCard|redCard">` per event, a `min` div,
//     the player and the assister / the player coming off. `right` is team A, the
//     home side (checked on ليفربول × مانشستر يونايتد 2026-11-22: سوبوسلاي and فيرتز
//     are `right`). Arabic names, so it is the first choice. Smaller fixtures (the
//     U-17 World Cup, the Egyptian second tier) show «ليس لدينا بيانات» instead.
//   * FilGoal's match page has the phases live («الشوط الاول», «استراحة», «الشوط
//     الثاني», «انتهت») and, for the fixtures it covers, goal and card rows with the
//     side as `p.r` / `p.l`. One `<li>` can hold two events at the same minute.
//   * ESPN's summary has `keyEvents` with a type, a clock and the team, for the
//     eight leagues we already pair with ESPN. The names are Latin, so it is the
//     last choice, and its rows are announced with the club, not the player.

/** What happened, in our own words. */
export type LiveEventKind =
  | 'goal'
  | 'ownGoal'
  | 'penaltyGoal'
  | 'missedPenalty'
  | 'yellow'
  | 'red'
  | 'secondYellow'
  | 'sub';

/** One event of the timeline. */
export interface LiveEvent {
  kind: LiveEventKind;
  /** The minute as published: «23», «90+4». Null when the row carries none. */
  minute: string | null;
  /** The scorer, the booked player, or the player coming on. */
  player: string | null;
  /** The assister for a goal, the player going off for a substitution. */
  other: string | null;
  side: 'home' | 'away' | null;
}

/** A phase of the match the source stated. */
export type LivePhase = 'firstHalf' | 'halftime' | 'secondHalf' | 'extraTime' | 'penalties' | 'final';

export interface LiveTimeline {
  /** Where the rows came from; a match keeps one timeline source once it has rows. */
  source: 'yallakora' | 'filgoal' | 'espn';
  events: LiveEvent[];
  phases: LivePhase[];
}

/** A stable identity for an event, so one row is announced once. */
export function eventKey(e: LiveEvent): string {
  return [e.kind, e.minute ?? '', e.player ?? '', e.side ?? ''].join('|');
}

function textOf(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function minuteText(raw: string): string | null {
  const m = raw.replace(/\s+/g, '').match(/^(\d{1,3})(?:\+(\d{1,2}))?'?$/);
  if (!m) return null;
  const base = Number(m[1]);
  if (base > 130) return null;
  return m[2] ? `${base}+${Number(m[2])}` : String(base);
}

// --- Yallakora -------------------------------------------------------------

/**
 * The «أحداث المباراة» tab of a Yallakora match page.
 *
 * Returns `[]` for a page with no events block or the «ليس لدينا بيانات» stub.
 * The kick-off row (`li.referee`, minute 0) is a marker, not an event.
 */
export function parseYallakoraEvents(html: string): LiveEvent[] {
  if (!html) return [];
  const start = html.indexOf('class="timeline events"');
  if (start < 0) return [];
  const endMarker = html.indexOf('class="centerSC"', start);
  const region = html.slice(start, endMarker > start ? endMarker : start + 40_000);
  const out: LiveEvent[] = [];
  for (const m of region.matchAll(/<li class="([^"]*)">([\s\S]*?)<\/li>/g)) {
    const classes = m[1]!.split(/\s+/);
    const body = m[2]!;
    const side = classes.includes('right') ? 'home' : classes.includes('left') ? 'away' : null;
    const kind: LiveEventKind | null = classes.includes('goal')
      ? 'goal'
      : classes.includes('redCard')
        ? 'red'
        : classes.includes('yellowCard')
          ? 'yellow'
          : classes.includes('sub')
            ? 'sub'
            : null;
    if (!kind || !side) continue;
    const minute = minuteText(textOf((body.match(/class="min">([\s\S]*?)<\/div>/) ?? [])[1] ?? ''));
    const description = (body.match(/class="description">([\s\S]*?)<\/p>/) ?? [])[1] ?? '';
    if (kind === 'sub') {
      const on = textOf((description.match(/class="subIn">([\s\S]*?)<\/span>/) ?? [])[1] ?? '');
      const off = textOf((description.match(/class="subOut">([\s\S]*?)<\/span>/) ?? [])[1] ?? '');
      if (!on && !off) continue;
      out.push({ kind, minute, player: on || null, other: off || null, side });
      continue;
    }
    const assister = textOf((description.match(/class="assister">([\s\S]*?)<\/span>/) ?? [])[1] ?? '')
      .replace(/^\(|\)$/g, '')
      .trim();
    const player = textOf(description.replace(/<span class="assister">[\s\S]*?<\/span>/, ''));
    if (!player) continue;
    // The page marks an own goal and a penalty in the goal row's own classes.
    const goalKind: LiveEventKind =
      kind !== 'goal'
        ? kind
        : classes.some((c) => /own/i.test(c))
          ? 'ownGoal'
          : classes.some((c) => /pen/i.test(c))
            ? 'penaltyGoal'
            : 'goal';
    out.push({ kind: goalKind, minute, player, other: assister || null, side });
  }
  return out;
}

// --- FilGoal ---------------------------------------------------------------

const FILGOAL_PHASES: Array<[RegExp, LivePhase]> = [
  [/^الشوط (?:الاول|الأول)$/, 'firstHalf'],
  [/^استراحة$/, 'halftime'],
  [/^الشوط الثاني$/, 'secondHalf'],
  [/^(?:الوقت الإضافي|الوقت الاضافي|أشواط إضافية|اشواط اضافية)/, 'extraTime'],
  [/^(?:ركلات الترجيح|ضربات الترجيح)/, 'penalties'],
  [/^انتهت$/, 'final'],
];

function filGoalKind(label: string): LiveEventKind | null {
  if (/عكسي|ذاتي|في مرماه/.test(label)) return 'ownGoal';
  if (/إهدار|اهدار|أهدر|ضائعة/.test(label)) return 'missedPenalty';
  if (/ركلة جزاء|ضربة جزاء/.test(label)) return 'penaltyGoal';
  if (/هدف/.test(label)) return 'goal';
  if (/صفراء ثانية|إنذار ثان|انذار ثان/.test(label)) return 'secondYellow';
  if (/حمراء|طرد/.test(label)) return 'red';
  if (/صفراء|إنذار|انذار/.test(label)) return 'yellow';
  if (/تبديل|تغيير/.test(label)) return 'sub';
  return null;
}

/**
 * The timeline block of a FilGoal match page: its events and its phases.
 *
 * `p.r` is the home column, `p.l` the away one (the template is right-to-left).
 * One `<li>` may carry two `<p>` rows at the same minute; both are kept.
 */
export function parseFilGoalTimeline(html: string): { events: LiveEvent[]; phases: LivePhase[] } {
  const empty = { events: [], phases: [] };
  if (!html) return empty;
  const start = html.indexOf('match-events-container');
  if (start < 0) return empty;
  const end = html.indexOf('</ul>', start);
  const region = html.slice(start, end > start ? end : start + 20_000);
  const events: LiveEvent[] = [];
  const phases: LivePhase[] = [];
  for (const m of region.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const body = m[1]!;
    const status = body.match(/<h3>\s*([^<]+?)\s*<\/h3>/);
    if (status) {
      const label = status[1]!.trim();
      const phase = FILGOAL_PHASES.find(([re]) => re.test(label))?.[1];
      if (phase && !phases.includes(phase)) phases.push(phase);
      continue;
    }
    const minuteRaw = (body.match(/<span[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? '';
    const minute = minuteText(textOf(minuteRaw).replace(/\s*\+\s*/, '+'));
    for (const p of body.matchAll(/<p class="\s*([rl])\s*">([\s\S]*?)<\/p>/g)) {
      const label = (p[2]!.match(/alt="([^"]*)"/) ?? [])[1]?.trim() ?? '';
      const kind = filGoalKind(label);
      if (!kind) continue;
      const names = [...p[2]!.matchAll(/\/players\/\d+\/[^"]*">([^<]+)<\/a>/g)].map((x) => x[1]!.trim());
      events.push({
        kind,
        minute,
        player: names[0] ?? null,
        other: names[1] ?? null,
        side: p[1] === 'r' ? 'home' : 'away',
      });
    }
  }
  return { events, phases };
}

// --- ESPN ------------------------------------------------------------------

/**
 * `keyEvents` of an ESPN soccer summary.
 *
 * `homeTeamName` is ESPN's own display name for the home club, read from the
 * same payload, so the side is never guessed from our Arabic spelling.
 */
export function parseEspnKeyEvents(json: unknown): { events: LiveEvent[]; phases: LivePhase[] } {
  const body = (json ?? {}) as Record<string, any>;
  const competitors = (body['header']?.['competitions']?.[0]?.['competitors'] ?? []) as Array<Record<string, any>>;
  const homeId = String(competitors.find((c) => c['homeAway'] === 'home')?.['team']?.['id'] ?? competitors.find((c) => c['homeAway'] === 'home')?.['id'] ?? '');
  const awayId = String(competitors.find((c) => c['homeAway'] === 'away')?.['team']?.['id'] ?? competitors.find((c) => c['homeAway'] === 'away')?.['id'] ?? '');
  const events: LiveEvent[] = [];
  const phases: LivePhase[] = [];
  for (const k of (body['keyEvents'] ?? []) as Array<Record<string, any>>) {
    const type = String(k['type']?.['type'] ?? '');
    const phase: LivePhase | null =
      type === 'kickoff'
        ? 'firstHalf'
        : type === 'halftime'
          ? 'halftime'
          : type === 'start-2nd-half'
            ? 'secondHalf'
            : type.startsWith('start-extra') || type === 'start-1st-extra-time'
              ? 'extraTime'
              : type.includes('shootout')
                ? 'penalties'
                : null;
    if (phase) {
      if (!phases.includes(phase)) phases.push(phase);
      continue;
    }
    const kind: LiveEventKind | null = type.startsWith('own-goal')
      ? 'ownGoal'
      : type.startsWith('penalty---scored') || type === 'goal---penalty'
        ? 'penaltyGoal'
        : type.startsWith('penalty---missed') || type.startsWith('penalty---saved')
          ? 'missedPenalty'
          : type.startsWith('goal')
            ? 'goal'
            : type === 'red-card'
              ? 'red'
              : type === 'yellow-card'
                ? 'yellow'
                : type === 'substitution'
                  ? 'sub'
                  : null;
    if (!kind) continue;
    const teamId = String(k['team']?.['id'] ?? '');
    const side = teamId && teamId === homeId ? 'home' : teamId && teamId === awayId ? 'away' : null;
    const people = ((k['participants'] ?? []) as Array<Record<string, any>>).map((p) =>
      String(p['athlete']?.['displayName'] ?? '').trim(),
    );
    const clock = String(k['clock']?.['displayValue'] ?? '').replace(/'/g, '');
    events.push({
      kind,
      minute: minuteText(clock),
      player: people[0] || null,
      other: people[1] || null,
      side,
    });
  }
  return { events, phases };
}
