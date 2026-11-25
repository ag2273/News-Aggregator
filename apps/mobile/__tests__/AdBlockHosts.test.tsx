/**
 * Request-level ad blocking (#55).
 *
 * The user's report after apk-75: on a real phone the ad payloads still downloaded
 * and slots still rendered, so hiding containers was not enough. The fix refuses the
 * request itself in the native WebView — `react-native-webview` 14 has no JS hook for
 * sub-resources, only top-level navigations.
 *
 * What can be tested here: the host matcher that decides, and the `blockAdHosts`
 * prop the native gate reads. What CANNOT be tested here: that Android actually calls
 * `shouldInterceptRequest` — that is native code exercised only on a device, and the
 * report says so.
 */

import { isAdRequestHost, isDeviceFirstUrl, AD_BLOCK_HOSTS, DEVICE_FIRST_HOSTS } from '../lib/adBlockHosts';

describe('the host matcher the native gate uses', () => {
  it('blocks the ad payloads measured on these outlets', () => {
    // Measured live on الأهرام and العربية: the prebid/exchange hosts, gpt.js and the
    // impression beacons are what actually download.
    expect(isAdRequestHost('https://securepubads.g.doubleclick.net/tag/js/gpt.js')).toBe(true);
    expect(isAdRequestHost('https://prebid-server.rubiconproject.com/openrtb2/auction')).toBe(true);
    expect(isAdRequestHost('https://adx.adform.net/adx')).toBe(true);
    expect(isAdRequestHost('https://pa.openx.net/x')).toBe(true);
    expect(isAdRequestHost('https://cdn.taboola.com/libtrc/loader.js')).toBe(true);
    expect(isAdRequestHost('https://www.googletagmanager.com/gtag/js')).toBe(true);
    expect(isAdRequestHost('https://get.optad360.io/assets/js/x.js')).toBe(true);
    // Chartbeat measured on العربية: a tracker, not an ad, same payload class.
    expect(isAdRequestHost('https://static.chartbeat.com/js/x.js')).toBe(true);
  });

  it('never blocks the publisher’s own page, stylesheets or images', () => {
    // The whole point of blocking requests instead of hiding slots: the article must
    // still look like the article.
    expect(isAdRequestHost('https://www.dostor.org/5790251')).toBe(false);
    expect(isAdRequestHost('https://www.dostor.org/css/site.css')).toBe(false);
    expect(isAdRequestHost('https://cdn.dostor.org/img/lead.jpg')).toBe(false);
    expect(isAdRequestHost('https://www.alarabiya.net/.resources/fonts/x.woff2')).toBe(false);
    expect(isAdRequestHost('https://gate.ahram.org.eg/News/1.aspx')).toBe(false);
    expect(isAdRequestHost('https://fonts.googleapis.com/css2?family=Cairo')).toBe(false);
  });

  it('cannot be fooled by a lookalike host', () => {
    // Same anti-lookalike rule as the JS list: exact host or subdomain, never a
    // substring, so neither an attacker nor an innocent site is caught by accident.
    expect(isAdRequestHost('https://doubleclick.net.attacker.example/x')).toBe(false);
    expect(isAdRequestHost('https://notdoubleclick.net/x')).toBe(false);
    expect(isAdRequestHost('https://taboola.com.evil.example/x')).toBe(false);
  });

  it('treats a garbage url as not-an-ad rather than throwing', () => {
    expect(isAdRequestHost('not a url')).toBe(false);
    expect(isAdRequestHost('')).toBe(false);
  });

  it('ships the denylist the native side receives', () => {
    // The prop carries this array itself, so a missing entry is a real regression
    // rather than a lookup that silently comes back empty.
    expect(AD_BLOCK_HOSTS.length).toBeGreaterThan(40);
    expect(AD_BLOCK_HOSTS.every((h) => h === h.toLowerCase())).toBe(true);
    expect(AD_BLOCK_HOSTS.some((h) => h.includes('://'))).toBe(false);
  });
});

describe('which publishers are read from the device', () => {
  it('is exactly the three the server cannot reach', () => {
    expect(DEVICE_FIRST_HOSTS).toStrictEqual(['dostor.org', 'alarabiya.net', 'ahram.org.eg']);
  });

  it('matches both bare and subdomain article urls', () => {
    // The feed resolves articles to elcaptain.dostor.org and gate.ahram.org.eg, so a
    // bare-host check would miss the real pages.
    expect(isDeviceFirstUrl('https://www.dostor.org/5790251')).toBe(true);
    expect(isDeviceFirstUrl('https://elcaptain.dostor.org/231454')).toBe(true);
    expect(isDeviceFirstUrl('https://gate.ahram.org.eg/News/1.aspx')).toBe(true);
    expect(isDeviceFirstUrl('https://www.alarabiya.net/culture/1')).toBe(true);
  });

  it('leaves every other publisher on the server path', () => {
    expect(isDeviceFirstUrl('https://www.masrawy.com/news/1')).toBe(false);
    expect(isDeviceFirstUrl('https://www.youm7.com/story/1')).toBe(false);
    expect(isDeviceFirstUrl('https://notdostor.org/x')).toBe(false);
  });
});
