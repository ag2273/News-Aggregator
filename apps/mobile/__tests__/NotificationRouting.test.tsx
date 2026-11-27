/**
 * Notification tap routing.
 *
 * The bug: a digest push carried `{ digest: '1' }`, but the tap handler only
 * understood `articleId` and `url`, so it did nothing and the user stayed on
 * whatever screen was open. Second half of the same bug: the listener only fires
 * while the app is RUNNING, so a cold start from a push never routed at all.
 *
 * These tests press the real handlers and assert the destination.
 */

import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';

// A hand-written mock: the module installs a notification handler at import
// time, which the default native mock cannot satisfy under jest.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
}));
import {
  notificationTarget,
  openNotificationArticle,
  handleInitialNotification,
} from '../lib/notifications';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));

describe('notificationTarget: the payload shapes the server sends', () => {
  it('routes a digest tap to the digest screen', () => {
    // Exactly what push.ts sends for a digest.
    expect(notificationTarget({ digest: '1', slot: '2026-11-21T09:00' })).toEqual({ kind: 'digest' });
  });

  it('routes an article tap to that article', () => {
    expect(notificationTarget({ articleId: 'abc123' })).toEqual({
      kind: 'article',
      articleId: 'abc123',
    });
  });

  it('routes a keyword push to its article', () => {
    expect(notificationTarget({ articleId: 'abc123', keyword: 'غزة' })).toEqual({
      kind: 'article',
      articleId: 'abc123',
    });
  });

  it('routes a url payload to the in-app browser', () => {
    expect(notificationTarget({ url: 'https://example.com/a' })).toEqual({
      kind: 'webview',
      url: 'https://example.com/a',
    });
  });

  it('treats the digest as the more specific destination when both are present', () => {
    expect(notificationTarget({ digest: '1', articleId: 'x' })).toEqual({ kind: 'digest' });
  });

  it('ignores an empty or unknown payload instead of guessing', () => {
    expect(notificationTarget(undefined)).toBeNull();
    expect(notificationTarget({})).toBeNull();
    expect(notificationTarget({ articleId: '' })).toBeNull();
    expect(notificationTarget({ url: 'javascript:alert(1)' })).toBeNull();
  });
});

describe('openNotificationArticle: the tap navigates', () => {
  beforeEach(() => jest.clearAllMocks());

  it('navigates to الخلاصة for a digest tap', () => {
    const target = openNotificationArticle({ digest: '1', slot: '2026-11-21T18:00' });
    expect(target).toEqual({ kind: 'digest' });
    expect(router.push).toHaveBeenCalledWith('/digest');
  });

  it('navigates to the article for an article tap', () => {
    openNotificationArticle({ articleId: 'abc123' });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/article', params: { id: 'abc123' } });
  });

  it('does not navigate at all for an unknown payload', () => {
    expect(openNotificationArticle({})).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('handleInitialNotification: a cold start from a push', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes the launch tap to الخلاصة', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue({
      notification: { request: { content: { data: { digest: '1', slot: '2026-11-21T09:00' } } } },
    });
    const target = await handleInitialNotification();
    expect(target).toEqual({ kind: 'digest' });
    expect(router.push).toHaveBeenCalledWith('/digest');
  });

  it('routes the launch tap to the article', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue({
      notification: { request: { content: { data: { articleId: 'z9' } } } },
    });
    await handleInitialNotification();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/article', params: { id: 'z9' } });
  });

  it('waits for the router before navigating', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue({
      notification: { request: { content: { data: { digest: '1' } } } },
    });
    const order: string[] = [];
    const waitForRouter = jest.fn(async () => {
      order.push('router');
    });
    await handleInitialNotification(waitForRouter);
    expect(waitForRouter).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['router']);
    expect(router.push).toHaveBeenCalledWith('/digest');
  });

  it('does nothing when the app was launched normally', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
    await expect(handleInitialNotification()).resolves.toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('clears the response so a resume does not re-navigate', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue({
      notification: { request: { content: { data: { digest: '1' } } } },
    });
    await handleInitialNotification();
    expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });

  it('never throws if the platform call fails', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(handleInitialNotification()).resolves.toBeNull();
  });
});

describe('a followed match event', () => {
  it('opens the match centre for that match and day', () => {
    // Exactly what push.ts buildWatchMessage sends.
    const data = { football: '1', kind: 'goal', matchId: 'fg-379728', date: '2026-11-27' };
    expect(notificationTarget(data)).toEqual({ kind: 'match', matchId: 'fg-379728', date: '2026-11-27' });
    openNotificationArticle(data);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/matches/[id]', params: { id: 'fg-379728', date: '2026-11-27' } });
  });

  it('leaves a team-follow push (no matchId) without a destination, as before', () => {
    expect(notificationTarget({ football: '1', kind: 'final' })).toBeNull();
  });
});
