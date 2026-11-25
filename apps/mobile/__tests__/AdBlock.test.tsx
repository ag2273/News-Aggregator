/**
 * Ad blocking (issue #51).
 *
 * These outlets' ads are the reason the reader asked for this. The rule that matters
 * is two-sided: the ad networks must be blocked, and the article's own host must
 * not be — a "clean" page that cannot load its images is not a working fallback.
 */

import { isBlockedRequest, AD_HOSTS, HIDE_ADS_CSS } from '../lib/adBlock';

describe('what the fallback browser blocks', () => {
  it('blocks the ad and tracker hosts these outlets load', () => {
    expect(isBlockedRequest('https://securepubads.g.doubleclick.net/tag/js/gpt.js')).toBe(true);
    expect(isBlockedRequest('https://cdn.taboola.com/libtrc/loader.js')).toBe(true);
    expect(isBlockedRequest('https://www.googletagmanager.com/gtag/js')).toBe(true);
    expect(isBlockedRequest('https://ads.yahoo.com/x')).toBe(true);
  });

  it('never blocks the article itself or its own assets', () => {
    expect(isBlockedRequest('https://www.youm7.com/story/2026/11/24/الأهلي')).toBe(false);
    expect(isBlockedRequest('https://cdn.youm7.com/images/lead.jpg')).toBe(false);
    expect(isBlockedRequest('https://fonts.googleapis.com/css2?family=Cairo')).toBe(false);
  });

  it('cannot be fooled by a lookalike host', () => {
    // A host merely CONTAINING the name is not the ad network's host.
    expect(isBlockedRequest('https://not-doubleclick.net.example.com/x')).toBe(false);
    expect(isBlockedRequest('https://doubleclick.net.attacker.example/x')).toBe(false);
  });

  it('ships a stylesheet that hides the empty ad slots', () => {
    // Blocking a request leaves the reserved box behind; without this the page has a
    // 300×250 hole where the ad was.
    expect(HIDE_ADS_CSS).toContain('adsbygoogle');
    expect(HIDE_ADS_CSS).toContain('display: none');
    expect(AD_HOSTS.length).toBeGreaterThan(20);
  });
});
