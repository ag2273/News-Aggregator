// Football polling: detect real match transitions and notify followers.
//
// The rule that matters: a notification is sent only when the source itself
// reports a change — a match that moved from upcoming to live, a score that
// differs from the last poll, or a match that finished. Nothing is guessed from
// elapsed time, so a stalled feed can never produce a phantom goal.

import { loadDay, todayCairo } from './footballService.js';
import { followersOf, leagueFollowersOf } from './footballStore.js';
import { sendMatchNotifications } from './push.js';
import type { MatchRow } from './football.js';

/** Score and state of every match we have already seen, by match id. */
export interface SeenMatch {
  status: MatchRow['status'];
  homeScore: number | null;
  awayScore: number | null;
}

export const seen = new Map<string, SeenMatch>();

export function _resetFootballSeen(): void {
  seen.clear();
}

export interface Transition {
  /**
   * `score` is a score change with no timeline behind it: recorded so the next
   * poll compares against the right number, deliberately not announced.
   */
  kind: 'kickoff' | 'goal' | 'score' | 'final';
  match: MatchRow;
  score: string;
}

/**
 * Compare the current matches with what we saw last time.
 *
 * Returns the transitions worth a notification. The first observation of a match
 * is never a transition (otherwise every deploy would re-announce every goal).
 */
export function detectTransitions(matches: MatchRow[]): Transition[] {
  const out: Transition[] = [];
  for (const match of matches) {
    const before = seen.get(match.id);
    const current: SeenMatch = {
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    };
    seen.set(match.id, current);
    if (!before) continue;
    const score = `${match.homeScore ?? 0}-${match.awayScore ?? 0}`;
    if (before.status === 'upcoming' && match.status === 'live') {
      out.push({ kind: 'kickoff', match, score });
      continue;
    }
    if (match.status === 'live' && (before.homeScore !== match.homeScore || before.awayScore !== match.awayScore)) {
      // A goal notification promises a moment («هدف», at this minute). Only a
      // provider that reports the timeline can back that promise: ESPN does, the
      // Egyptian list pages do not — they show a score that changes, with no
      // minute. The user's rule for Egyptian matches is the final score, honestly
      // named, with no fake clock, so a score change there is recorded and not
      // announced. The final notification still goes out.
      if (match.dataSource === 'filgoal' || match.dataSource === 'yallakora') {
        out.push({ kind: 'score', match, score });
        continue;
      }
      out.push({ kind: 'goal', match, score });
      continue;
    }
    if (before.status !== 'finished' && match.status === 'finished') {
      out.push({ kind: 'final', match, score });
    }
  }
  return out;
}

/** One poll: fetch today, detect transitions, notify each team's followers. */
export async function pollFootball(options: {
  now?: number;
  fetchImpl?: typeof fetch;
  notify?: typeof sendMatchNotifications;
} = {}): Promise<{ transitions: number; notified: number }> {
  const day = await loadDay(todayCairo(options.now ?? Date.now()), options);
  if (day.unavailable) return { transitions: 0, notified: 0 };
  const transitions = detectTransitions(day.matches);
  let notified = 0;
  for (const t of transitions) {
    // A `score` transition exists only to update what we remember; it is not an
    // event to announce.
    if (t.kind === 'score') continue;
    // Both sides' followers care about the event, and so does anyone following the
    // competition. A league follow has no `notifyGoals` switch: goals are only ever
    // sent where the source has a timeline, and a league notification is about the
    // season, not a single score.
    const teamFollowers = [
      ...followersOf(t.match.home).map((f) => ({ userId: f.userId, follow: f.follow })),
      ...followersOf(t.match.away).map((f) => ({ userId: f.userId, follow: f.follow })),
    ];
    const leagueFollowers = leagueFollowersOf(t.match.competitionId).map((f) => ({
      userId: f.userId,
      follow: {
        notifyKickoff: f.follow.notifyKickoff,
        notifyGoals: false,
        notifyFinal: f.follow.notifyFinal,
      },
    }));
    // One person can follow both the club and its league; they get one notification.
    const seenUsers = new Set<string>();
    const followers = [...teamFollowers, ...leagueFollowers].filter((f) => {
      if (seenUsers.has(f.userId)) return false;
      seenUsers.add(f.userId);
      return true;
    });
    if (!followers.length) continue;
    try {
      notified += await (options.notify ?? sendMatchNotifications)(
        { kind: t.kind, home: t.match.home, away: t.match.away, score: t.score },
        followers,
        options.fetchImpl,
      );
    } catch (err) {
      console.error('[football] notification failed:', err);
    }
  }
  return { transitions: transitions.length, notified };
}
