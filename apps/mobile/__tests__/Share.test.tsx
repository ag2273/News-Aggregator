/**
 * Share: the message format the spec fixes, the link choice, and that a share
 * failure can never break a card.
 */

import { Share } from 'react-native';
import { shareMessage, shareArticle, isAggregatorUrl, SHARE_VIA } from '../lib/share';

describe('share message', () => {
  it('is title, then link, then the via line', () => {
    const msg = shareMessage({ title: 'خبر مهم', url: 'https://example.com/a' });
    expect(msg).toBe(`خبر مهم\nhttps://example.com/a\n${SHARE_VIA}`);
    expect(msg.split('\n')).toHaveLength(3);
  });

  it('uses the publisher URL when we have it', () => {
    const msg = shareMessage({
      title: 'خبر',
      url: 'https://www.aljazeera.net/news/2026/11/17/story',
    });
    expect(msg).toContain('https://www.aljazeera.net/news/2026/11/17/story');
    expect(msg).not.toContain('news.google.com');
  });

  it('shares the Google News link when that is all we have', () => {
    const url = 'https://news.google.com/rss/articles/CBMi0gRBVV95cUxQ';
    const msg = shareMessage({ title: 'خبر', url });
    expect(msg).toContain(url);
  });

  it('recognises aggregator links', () => {
    expect(isAggregatorUrl('https://news.google.com/rss/articles/x')).toBe(true);
    expect(isAggregatorUrl('https://www.youm7.com/story/1')).toBe(false);
  });

  it('appends the app name exactly as specified', () => {
    expect(SHARE_VIA).toBe('عبر تطبيق رئيس التحرير');
  });
});

describe('shareArticle', () => {
  afterEach(() => jest.restoreAllMocks());

  it('opens the native sheet with the title and message', async () => {
    const spy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction } as never);

    const ok = await shareArticle({ title: 'خبر', url: 'https://example.com/a' });

    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [content] = spy.mock.calls[0] as [any, any];
    expect(content.title).toBe('خبر');
    expect(content.message).toBe(`خبر\nhttps://example.com/a\n${SHARE_VIA}`);
  });

  it('treats dismissal as handled, not as a failure', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction } as never);
    await expect(shareArticle({ title: 'خبر', url: 'https://x/y' })).resolves.toBe(true);
  });

  it('never throws when the sheet cannot open', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('no activity'));
    await expect(shareArticle({ title: 'خبر', url: 'https://x/y' })).resolves.toBe(false);
  });
});
