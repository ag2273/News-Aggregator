/**
 * Push notification tests: matching rules + token registry round-trip.
 * The sender's network call is not exercised here; the pure rule and the
 * JSON-backed registry are.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Article } from '../types.js';
import {
  shouldPushTo,
  isValidMode,
  registerPushToken,
  updatePushPrefs,
  getPushPrefs,
  unregisterPushToken,
  _resetPushCache,
  type PushRecord,
} from '../push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');
const PUSH_FILE = path.join(DATA_DIR, 'push-tokens.json');

function article(isBreaking: boolean): Article {
  return {
    id: isBreaking ? 'breaking-1' : 'normal-1',
    title: isBreaking ? 'خبر عاجل مهم' : 'خبر عادي',
    summary: null,
    imageUrl: null,
    url: 'https://example.com/x',
    sourceId: 'test',
    sourceName: 'اليوم السابع',
    category: 'egypt',
    country: 'EG',
    publishedAt: Date.now(),
    isBreaking,
  };
}

function record(overrides: Partial<PushRecord> = {}): PushRecord {
  return {
    id: 'p1',
    userId: 'user-1',
    token: 'ExponentPushToken[abc]',
    platform: 'ios',
    enabled: true,
    mode: 'urgent',
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('push: matching rule', () => {
  it('sends breaking news to urgent and all subscribers', () => {
    expect(shouldPushTo(record({ mode: 'urgent' }), article(true))).toBe(true);
    expect(shouldPushTo(record({ mode: 'all' }), article(true))).toBe(true);
  });

  it('sends non-breaking news only to all subscribers', () => {
    expect(shouldPushTo(record({ mode: 'urgent' }), article(false))).toBe(false);
    expect(shouldPushTo(record({ mode: 'all' }), article(false))).toBe(true);
  });

  it('never sends to a disabled device', () => {
    expect(shouldPushTo(record({ enabled: false, mode: 'all' }), article(true))).toBe(false);
    expect(shouldPushTo(record({ enabled: false, mode: 'all' }), article(false))).toBe(false);
  });

  it('validates the mode values', () => {
    expect(isValidMode('urgent')).toBe(true);
    expect(isValidMode('all')).toBe(true);
    expect(isValidMode('sometimes')).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
    expect(isValidMode(1)).toBe(false);
  });
});

describe('push: token registry', () => {
  beforeEach(() => {
    try {
      fs.rmSync(PUSH_FILE, { force: true });
    } catch {
      /* ignore */
    }
    _resetPushCache();
  });

  it('registers a token with the documented defaults', () => {
    const r = registerPushToken('user-1', 'token-a', 'ios');
    expect(r.enabled).toBe(true);
    expect(r.mode).toBe('urgent');
    expect(r.userId).toBe('user-1');
  });

  it('upserts by token instead of duplicating', () => {
    const first = registerPushToken('user-1', 'token-a', 'ios');
    const second = registerPushToken('user-1', 'token-a', 'android');
    expect(second.id).toBe(first.id);
    expect(second.platform).toBe('android');
  });

  it('updates preferences and reads them back', () => {
    registerPushToken('user-1', 'token-a', 'ios');
    const updated = updatePushPrefs('user-1', 'token-a', { enabled: false, mode: 'all' });
    expect(updated?.enabled).toBe(false);
    expect(updated?.mode).toBe('all');

    const prefs = getPushPrefs('user-1', 'token-a');
    expect(prefs?.enabled).toBe(false);
    expect(prefs?.mode).toBe('all');
  });

  it('does not let another user touch the token', () => {
    registerPushToken('user-1', 'token-a', 'ios');
    expect(updatePushPrefs('user-2', 'token-a', { enabled: false })).toBeNull();
    expect(getPushPrefs('user-2', 'token-a')).toBeNull();
    expect(unregisterPushToken('user-2', 'token-a')).toBe(false);
    // Still intact for its owner.
    expect(getPushPrefs('user-1', 'token-a')?.enabled).toBe(true);
  });

  it('unregisters the token', () => {
    registerPushToken('user-1', 'token-a', 'ios');
    expect(unregisterPushToken('user-1', 'token-a')).toBe(true);
    expect(getPushPrefs('user-1', 'token-a')).toBeNull();
  });
});
