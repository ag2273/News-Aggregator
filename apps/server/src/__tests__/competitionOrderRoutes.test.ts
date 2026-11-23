/**
 * The #26 endpoints, exercised through the real router.
 *
 * The important assertion is not that a PUT stores something — it is that the
 * /competitions response actually changes for the reader who saved an order, and
 * does not change for anybody else.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { createUser, _resetUsersCache } from '../users.js';
import { createToken } from '../auth.js';
import { _resetFootballCache } from '../footballStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR'] ? path.resolve(process.env['DATA_DIR']) : path.resolve(__dirname, '../../../data');

function reset(): void {
  for (const f of ['users.json', 'team-follows.json']) {
    try { fs.rmSync(path.join(DATA_DIR, f), { force: true }); } catch { /* ignore */ }
  }
  _resetUsersCache();
  _resetFootballCache();
}

/** A verified account — the order endpoint gates on verification like a follow. */
function verifiedToken(id = 'co-1'): string {
  const u = createUser({
    id,
    email: `${id}@secret.example`,
    passwordHash: 's:h',
    createdAt: Date.now(),
    emailVerified: true,
  });
  return createToken(u.id);
}

const ids = async (token?: string): Promise<string[]> => {
  const res = await app.request('/api/football/competitions', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = (await res.json()) as { data: Array<{ id: string }> };
  return body.data.map((x) => x.id);
};

beforeEach(reset);

describe('competition order endpoints', () => {
  it('saves an order and serves /competitions in it', async () => {
    const token = verifiedToken();
    const put = await app.request('/api/football/competition-order', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ order: ['saudi-pro-league', 'ita-serie-a'] }),
    });
    expect(put.status).toBe(200);

    const order = await ids(token);
    expect(order.slice(0, 2)).toEqual(['saudi-pro-league', 'ita-serie-a']);
    // Nothing lost: every competition is still served.
    expect(order.length).toBeGreaterThan(10);
  });

  it('does not move the order for a reader who never saved one', async () => {
    const someone = verifiedToken('co-2');
    const other = verifiedToken('co-3');
    // `someone` rearranges; `other` must keep Egypt first.
    await app.request('/api/football/competition-order', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${someone}`, 'content-type': 'application/json' },
      body: JSON.stringify({ order: ['fra-ligue-1'] }),
    });
    const theirs = await ids(other);
    expect(theirs[0]).toBe('egyptian-premier');
  });

  it('leaves the guest order at the Egypt-first default', async () => {
    const guest = await ids();
    expect(guest[0]).toBe('egyptian-premier');
  });

  it('refuses to save without a session', async () => {
    const res = await app.request('/api/football/competition-order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: ['ita-serie-a'] }),
    });
    expect(res.status).toBe(401);
  });

  it('resets on DELETE', async () => {
    const token = verifiedToken('co-4');
    await app.request('/api/football/competition-order', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ order: ['ger-bundesliga'] }),
    });
    expect((await ids(token))[0]).toBe('ger-bundesliga');

    const del = await app.request('/api/football/competition-order', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(200);
    expect((await ids(token))[0]).toBe('egyptian-premier');
  });

  it('reports whether the order is the reader’s own', async () => {
    const token = verifiedToken('co-5');
    const before = await app.request('/api/football/competition-order', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(((await before.json()) as { data: { personalised: boolean } }).data.personalised).toBe(false);

    await app.request('/api/football/competition-order', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ order: ['esp-la-liga'] }),
    });
    const after = await app.request('/api/football/competition-order', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await after.json()) as { data: { personalised: boolean; order: string[] } };
    expect(body.data.personalised).toBe(true);
    expect(body.data.order).toEqual(['esp-la-liga']);
  });

  it('rejects a body that is not a list of ids, and an empty list', async () => {
    const token = verifiedToken('co-6');
    const notList = await app.request('/api/football/competition-order', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ order: 'egyptian-premier' }),
    });
    expect(notList.status).toBe(400);

    const empty = await app.request('/api/football/competition-order', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ order: [] }),
    });
    expect(empty.status).toBe(400);
  });

  it('applies the same order to the day’s competition list', async () => {
    // The matches screen groups by the competitions array; it must agree with the
    // competitions endpoint, or one screen would reorder and the other would not.
    const token = verifiedToken('co-7');
    await app.request('/api/football/competition-order', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ order: ['eng-premier'] }),
    });
    const res = await app.request('/api/football/matches?date=2026-11-23', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { data: { competitions: Array<{ id: string }> } };
    expect(body.data.competitions[0]!.id).toBe('eng-premier');
  });
});
