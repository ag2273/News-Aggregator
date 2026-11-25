// Ad-network hosts, and the publishers whose pages the app reads from the device (#55).
//
// WHY THIS FILE EXISTS
// --------------------
// The same host list is needed in two places:
//
//   * in JavaScript, for the request observer that hides what slipped through;
//   * in the NATIVE Android WebView, which is the only place a sub-resource request
//     can actually be stopped before the network pays for it. The native side gets
//     this exact list, so the two can never drift apart.
//
// `react-native-webview` exposes no sub-resource interception point (checked in its
// 14.0.1 sources: only top-level navigations reach JS, through
// `onShouldStartLoadWithRequest`), so the native side is a small patch that reads
// the list this module hands to it. See `lib/nativeAdBlock.ts`.

/**
 * Publishers our server cannot fetch at all.
 *
 * Measured, not guessed: from this host their TLS handshake is reset, so the
 * server-side reader and the server-side cleaner both fail for them (#52, #54).
 * The DEVICE network reaches them — that is what the user confirmed on their phone —
 * so for these three the app reads the page itself and never asks the server.
 *
 * A page here is read from the device in two steps (#55):
 *   1. extract the article locally and draw it in the app's reader design;
 *   2. if that extraction is too thin, open the publisher page in the WebView with
 *      the ad requests blocked natively. No banner, no user action.
 */
export const DEVICE_FIRST_HOSTS = ['dostor.org', 'alarabiya.net', 'ahram.org.eg'];

/**
 * Ad and tracker networks to refuse at the request layer.
 *
 * A curated denylist rather than EasyList: the full list is ~2MB of text plus a
 * parser and a matcher over every request, which is a real cost on a phone for a
 * fallback screen. These are the networks measured on these outlets (see
 * `docs/` measurement in the #55 report), plus the regional sellers seen on the
 * Arabic press.
 *
 * Matching is exact host or SUBDOMAIN, never a substring: `doubleclick.net.example`
 * is a different host and stays loadable, so a lookalike cannot be used to smuggle
 * a request through, and an innocent publisher host is never caught by accident.
 */
export const AD_BLOCK_HOSTS = [
  // Google's ad stack: gpt.js, the ad iframes, the impression beacons.
  'doubleclick.net',
  'googleadservices.com',
  'googlesyndication.com',
  'googletagservices.com',
  'googletagmanager.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'adsafeprotected.com',
  // Measurement and analytics, which is not an ad but is the same tracking payload.
  'google-analytics.com',
  'analytics.google.com',
  'scorecardresearch.com',
  'quantserve.com',
  'chartbeat.com',
  'chartbeat.net',
  'hotjar.com',
  'connect.facebook.net',
  'bat.bing.com',
  'cloudflareinsights.com',
  // Content-recommendation widgets: the "you may also like" panels.
  'taboola.com',
  'outbrain.com',
  'mgid.com',
  'revcontent.com',
  'zemanta.com',
  'contentexchange.me',
  // Exchanges and sellers. Measured live on ahram: prebid-server.rubiconproject.com,
  // adx.adform.net, pa.openx.net, eus.rubiconproject.com.
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'criteo.com',
  'criteo.net',
  'smartadserver.com',
  'adform.net',
  'openx.net',
  'casalemedia.com',
  'media.net',
  'amazon-adsystem.com',
  'adskeeper.com',
  'exoclick.com',
  'popads.net',
  'propellerads.com',
  'onclickalgo.com',
  'adsterra.com',
  // Regional sellers and the two supply-side platforms measured on these outlets.
  'ads.yahoo.com',
  'arabyads.com',
  'adsensecustomsearchads.com',
  'moatads.com',
  'optad360.io',
  'ideanetwork.site',
  // Push/engagement SDKs that show their own banners over the article.
  'clevertap-prod.com',
  'alati.ai',
];

/**
 * Is this request an ad or a tracker?
 *
 * Exact host, or a subdomain of a listed host. A lookalike such as
 * `doubleclick.net.attacker.example` neither equals nor ends with a listed name and
 * is therefore not blocked.
 */
export function isAdRequestHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return AD_BLOCK_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/** Does this article URL live on a publisher our server cannot reach? */
export function isDeviceFirstUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return DEVICE_FIRST_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
