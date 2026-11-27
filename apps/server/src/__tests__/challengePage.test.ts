// A bot check served with HTTP 200 must never be shown as the article (apk-90 report).
import { describe, it, expect } from 'vitest';
import { isChallengePage } from '../articleText.js';
import { cleanPage, resetCleanCache } from '../cleanPageService.js';

const MAX_ATTEMPTS =
  '<html><head><title></title></head><body><p>Max challenge attempts exceeded. Please refresh the page to try again!</p></body></html>';

describe('isChallengePage', () => {
  it('recognises the bot checks we have met', () => {
    expect(isChallengePage(MAX_ATTEMPTS)).toBe(true);
    expect(isChallengePage('<title>Just a moment...</title><div id="cf-browser-verification"></div>')).toBe(true);
    expect(isChallengePage('<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>')).toBe(true);
    expect(isChallengePage('<body>Request unsuccessful. Incapsula incident ID: 123</body>')).toBe(true);
  });

  it('does not flag a real article that only mentions a weak phrase', () => {
    const story = `<html><head><title>خبر</title></head><body><article>${'<p>نص الخبر الطويل عن التحقق الأمني security verification في البنوك.</p>'.repeat(600)}</article></body></html>`;
    expect(isChallengePage(story)).toBe(false);
  });
});

describe('the cleaned page refuses a bot check', () => {
  it('returns null (502) so the app opens the live page instead', async () => {
    resetCleanCache();
    const html = await cleanPage('https://asharqbusiness.com/news/1', Date.now(), {
      fetchImpl: (async () => new Response(MAX_ATTEMPTS, { status: 200 })) as unknown as typeof fetch,
    });
    expect(html).toBeNull();
  });
});
