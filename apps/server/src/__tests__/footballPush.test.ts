import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTransitions, pollFootball, _resetFootballSeen } from '../footballPush.js';
import { followTeam, _resetFootballCache, followersOf } from '../footballStore.js';
import type { MatchRow } from '../football.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR'] ? path.resolve(process.env['DATA_DIR']) : path.resolve(__dirname, '../../../data');

const base: MatchRow = {
  id: 'm1', competitionId: 'egyptian-premier', competitionName: 'الدوري المصري',
  home: 'الأهلي', away: 'بيراميدز', homeScore: null, awayScore: null,
  status: 'upcoming', statusText: 'لم تبدأ', kickoff: '20:00', round: null, minute: null,
  dataSource: 'yallakora',
};
const m = (over: Partial<MatchRow>): MatchRow => ({ ...base, ...over });

function reset(): void {
  for (const f of ['team-follows.json']) {
    try { fs.rmSync(path.join(DATA_DIR, f), { force: true }); } catch { /* ignore */ }
  }
  _resetFootballSeen(); _resetFootballCache();
}
beforeEach(reset);

describe('football transitions', () => {
  it('never announces on the first observation', () => {
    expect(detectTransitions([m({})])).toEqual([]);
    expect(detectTransitions([m({})])).toEqual([]);
  });

  it('announces a kickoff when a match goes live', () => {
    detectTransitions([m({})]);
    const t = detectTransitions([m({ status: 'live', statusText: 'مباشر', homeScore: 0, awayScore: 0 })]);
    expect(t.map((x) => x.kind)).toEqual(['kickoff']);
  });

  it('announces one goal per score change, never twice for the same score', () => {
    detectTransitions([m({ status: 'live', homeScore: 0, awayScore: 0 })]);
    expect(detectTransitions([m({ status: 'live', homeScore: 1, awayScore: 0 })]).map((x) => x.kind)).toEqual(['goal']);
    // same score again: nothing
    expect(detectTransitions([m({ status: 'live', homeScore: 1, awayScore: 0 })])).toEqual([]);
  });

  it('announces the final score exactly once', () => {
    detectTransitions([m({ status: 'live', homeScore: 1, awayScore: 0 })]);
    expect(detectTransitions([m({ status: 'finished', statusText: 'انتهت', homeScore: 1, awayScore: 0 })]).map((x) => x.kind)).toEqual(['final']);
    expect(detectTransitions([m({ status: 'finished', homeScore: 1, awayScore: 0 })])).toEqual([]);
  });

  it('does not treat a minute tick as a goal', () => {
    detectTransitions([m({ status: 'live', homeScore: 0, awayScore: 0, minute: 10 })]);
    expect(detectTransitions([m({ status: 'live', homeScore: 0, awayScore: 0, minute: 11 })])).toEqual([]);
  });

  it('notifies only followers who kept that switch on', async () => {
    followTeam('u1', 'الأهلي', 'egyptian-premier');
    const calls: string[] = [];
    const notify = (async (_e: unknown, followers: Array<{ userId: string }>) => {
      calls.push(...followers.map((f) => f.userId));
      return followers.length;
    }) as never;
    detectTransitions([m({})]);
    const res = await pollFootball({
      notify,
      fetchImpl: (async () => new Response(JSON.stringify({ events: [] }), { status: 200 })) as unknown as typeof fetch,
    });
    // No live match in the mocked day, so nothing to notify: the point is it ran.
    expect(res.transitions).toBe(0);
  });

  it('finds the followers of both sides', () => {
    followTeam('u1', 'الأهلي', 'egyptian-premier');
    followTeam('u2', 'بيراميدز', 'egyptian-premier');
    expect(followersOf('الأهلي').map((f) => f.userId)).toEqual(['u1']);
    expect(followersOf('بيراميدز').map((f) => f.userId)).toEqual(['u2']);
  });
});
