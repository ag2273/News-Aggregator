import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { createUser, _resetUsersCache } from '../users.js';
import { createToken } from '../auth.js';
import { _resetFootballCache, followLeague, getLeagueFollows, getTeamFollows, leagueFollowersOf, followTeam } from '../footballStore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR'] ? path.resolve(process.env['DATA_DIR']) : path.resolve(here, '../../../data');

function reset(): void {
  for (const f of ['users.json', 'news.json', 'team-follows.json']) {
    try { fs.rmSync(path.join(DATA_DIR, f), { force: true }); } catch { /* ignore */ }
  }
  _resetUsersCache(); _resetFootballCache();
}
function verified(id = 'lf-1'): string {
  const u = createUser({ id, email: `${id}@secret.example`, passwordHash: 's:h', createdAt: Date.now(), emailVerified: true });
  return createToken(u.id);
}
beforeEach(reset);

describe('league follows', () => {
  it('follows the Egyptian league and lists it', async () => {
    const token = verified();
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const put = await app.request('/api/football/league-follows', {
      method: 'PUT', headers: auth, body: JSON.stringify({ competitionId: 'egyptian-premier' }),
    });
    expect(put.status).toBe(200);
    const list = await app.request('/api/football/league-follows', { headers: auth });
    const { data } = (await list.json()) as { data: { leagues: Array<{ competitionId: string; nameAr: string }> } };
    expect(data.leagues.map((l) => l.competitionId)).toEqual(['egyptian-premier']);
    // The display name is stored with the follow, so a device needs no lookup.
    expect(data.leagues[0]!.nameAr).toBe('الدوري المصري');
  });

  it('requires a verified account, exactly like a team follow', async () => {
    const u = createUser({ id: 'lf-2', email: 'unv2@secret.example', passwordHash: 's:h', createdAt: Date.now(), emailVerified: false });
    const token = createToken(u.id);
    const res = await app.request('/api/football/league-follows', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ competitionId: 'egyptian-premier' }),
    });
    expect(res.status).toBe(403);
    expect(getLeagueFollows('lf-2')).toHaveLength(0);
  });

  it('refuses a cup, which has no league season to notify about', async () => {
    const token = verified('lf-3');
    const res = await app.request('/api/football/league-follows', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ competitionId: 'egypt-cup' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown competition', async () => {
    const token = verified('lf-4');
    const res = await app.request('/api/football/league-follows', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ competitionId: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('follows twice idempotently, toggles switches, then unfollows', async () => {
    const token = verified('lf-5');
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    await app.request('/api/football/league-follows', { method: 'PUT', headers: auth, body: JSON.stringify({ competitionId: 'egyptian-premier' }) });
    await app.request('/api/football/league-follows', { method: 'PUT', headers: auth, body: JSON.stringify({ competitionId: 'egyptian-premier' }) });
    expect(getLeagueFollows('lf-5')).toHaveLength(1);

    const off = await app.request('/api/football/league-follows/egyptian-premier/notify', {
      method: 'PUT', headers: auth, body: JSON.stringify({ notifyFinal: false }),
    });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { data: { league: { notifyFinal: boolean } } }).data.league.notifyFinal).toBe(false);

    const del = await app.request('/api/football/league-follows/egyptian-premier', { method: 'DELETE', headers: auth });
    expect(del.status).toBe(200);
    expect(getLeagueFollows('lf-5')).toHaveLength(0);
  });

  it('keeps team follows and league follows separate', () => {
    followTeam('u1', 'الأهلي', 'egyptian-premier');
    followLeague('u1', 'egyptian-premier', 'الدوري المصري');
    expect(getTeamFollows('u1')).toHaveLength(1);
    expect(getLeagueFollows('u1')).toHaveLength(1);
    expect(leagueFollowersOf('egyptian-premier').map((f) => f.userId)).toEqual(['u1']);
  });
});
