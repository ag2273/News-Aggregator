// Ad and tracker hosts, and the CSS that hides the slots they leave behind (#51).
//
// WHY A SHORT LIST AND NOT EASYLIST
// ---------------------------------
// EasyList is ~2MB of text and would need a parser at runtime plus a matcher over
// every request — on a phone that is a real cost for a fallback screen most readers
// never see. This list is the commercial ad/tracker networks these Arabic outlets
// actually load (Google's ad stack, Taboola/Outbrain widgets, the regional ad
// servers and the analytics beacons), which removes the ads a reader complains
// about. It is a denylist of REQUEST HOSTS: nothing is rewritten, and a page that
// needs a host still gets it.
//
// In a plain module rather than inside the component, so the rules can be tested
// without a React runtime.

import { API_BASE } from './api';

/**
 * The URL the WebView loads for an article when ads must be blocked.
 *
 * The SERVER fetches the page and removes the ad scripts, then sends the cleaned
 * HTML — so the ads are never loaded at all. Hiding them with CSS inside the WebView
 * was measured to leave "almost all the ads" visible, because the ad scripts had
 * already run and built their containers (issue #52).
 */
export function cleanPageUrl(articleUrl: string): string {
  return `${API_BASE}/api/articles/clean?url=${encodeURIComponent(articleUrl)}`;
}

export const AD_HOSTS = [
  // Google's ad stack and its measurement pixels.
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'googletagservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  // Content-recommendation widgets, the "you may also like" ad panels.
  'taboola.com',
  'outbrain.com',
  'mgid.com',
  'revcontent.com',
  'zemanta.com',
  'contentexchange.me',
  // Ad exchanges and regional sellers.
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
  'adskeeper.com',
  'exoclick.com',
  'popads.net',
  'propellerads.com',
  'onclickalgo.com',
  'adsterra.com',
  // Arab-regional sellers and trackers seen on these outlets.
  'ads.yahoo.com',
  'arabyads.com',
  'adsensecustomsearchads.com',
  'moatads.com',
  'scorecardresearch.com',
  'quantserve.com',
  'chartbeat.com',
  'hotjar.com',
  'connect.facebook.net',
  'bat.bing.com',
];

/**
 * Is this request an ad or a tracker?
 *
 * Exact host or a SUBDOMAIN of a listed host — never a substring. A lookalike such
 * as `doubleclick.net.attacker.example` resolves to a host that neither equals nor
 * ends with the listed name, so it is not blocked and cannot be used to smuggle a
 * different request through the check.
 */
export function isBlockedRequest(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return AD_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * Selectors that hide an ad slot.
 *
 * Measured against a real dostor.org page (224KB, 42 ad references) rather than
 * guessed: its slots are `.adfull`, `.reponsiveAd` and `.ad-now`, none of which the
 * first build matched — which is why the user still saw "almost all the ads". The
 * list below covers those three by NAME plus the generic vocabulary every ad stack
 * uses, so a page from any of our outlets is caught.
 *
 * Deliberately attribute-based (`class*=`) rather than exact class names: these
 * outlets swap the surrounding classes per template, but the ad slot keeps its
 * identity.
 */
export const AD_SLOT_SELECTORS = [
  // The three real dostor.org slots, measured.
  '.adfull', '.reponsiveAd', '.ad-now',
  // Google's stack.
  'ins.adsbygoogle', '.adsbygoogle', '[id^="google_ads"]', '[id*="div-gpt-ad"]',
  '[data-ad-slot]', '[data-google-query-id]', '[id^="aswift"]', '[id^="google_ads_iframe"]',
  // Recommendation widgets.
  '[id*="taboola"]', '[class*="taboola"]', '[id*="outbrain"]', '[class*="outbrain"]',
  '[class*="mgid"]', '[id*="mgid"]', '[class*="revcontent"]',
  // Generic slot vocabulary.
  '[class*="ad-slot"]', '[class*="adslot"]', '[class*="ad_slot"]', '[class*="advert"]',
  '[class*="ad-unit"]', '[class*="adunit"]', '[class*="ad-banner"]', '[class*="adbanner"]',
  '[class*="ad-container"]', '[class*="adcontainer"]', '[class*="banner-ad"]',
  '[class*="sponsored"]', '[class*="ad-label"]', '[class*="adlabel"]',
  '[id*="ad-slot"]', '[id*="adslot"]', '[id*="advert"]', '[id^="ad-"]', '[id^="ad_"]',
  // Overlays and sticky bars, which are what actually cover the article text.
  '[class*="sticky-ad"]', '[id*="sticky-ad"]', '[class*="ad-overlay"]', '[class*="adsticky"]',
  '[class*="interstitial"]', '[class*="popup-ad"]', '[class*="ad-modal"]',
  // Iframes pointing at an ad network.
  'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
  'iframe[src*="taboola"]', 'iframe[src*="outbrain"]', 'iframe[src*="adnxs"]',
];

/**
 * CSS that removes the ad slots.
 *
 * `display:none` alone leaves the page's own spacing in some layouts, so the box is
 * collapsed too — an empty 300×250 hole in the middle of an article is not "no ads".
 */
export const HIDE_ADS_CSS = `
  ${AD_SLOT_SELECTORS.join(',\n  ')} {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    overflow: hidden !important;
  }
  body { overflow-x: hidden !important; }
`;

/**
 * The script injected into the page.
 *
 * Three passes, because the ad scripts run AFTER our script does:
 *   1. the stylesheet above, so slots are hidden the moment they appear;
 *   2. a MutationObserver that removes new ad nodes as they are inserted;
 *   3. an attribute watcher for the `style` the scripts set inline, which would
 *      otherwise override our `display:none`.
 */
export const HIDE_ADS_JS = `
(function () {
  if (window.__noAdsInstalled) return true;
  window.__noAdsInstalled = true;
  var SELECTORS = ${JSON.stringify(AD_SLOT_SELECTORS)};
  var style = document.createElement('style');
  style.type = 'text/css';
  style.appendChild(document.createTextNode(${JSON.stringify(HIDE_ADS_CSS)}));
  (document.head || document.documentElement).appendChild(style);

  var sweep = function () {
    for (var i = 0; i < SELECTORS.length; i++) {
      var nodes;
      try { nodes = document.querySelectorAll(SELECTORS[i]); } catch (e) { continue; }
      for (var j = 0; j < nodes.length; j++) {
        var n = nodes[j];
        if (n.__noAds) continue;
        n.__noAds = true;
        // Override the inline style the ad script may have set on the same node.
        n.style.setProperty('display', 'none', 'important');
        n.style.setProperty('height', '0', 'important');
      }
    }
  };
  sweep();
  try {
    new MutationObserver(sweep).observe(document.documentElement || document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'],
    });
  } catch (e) {}
  // The ad scripts on these pages load late; a slow sweep catches what the
  // observer's first pass missed without polling forever.
  var rounds = 0;
  var timer = setInterval(function () { sweep(); if (++rounds > 20) clearInterval(timer); }, 500);
  true;
})();
true;
`;
