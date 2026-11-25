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
 * CSS that removes the ad SLOTS the page reserved for the scripts we blocked.
 *
 * Blocking a request alone leaves an empty 300×250 hole and, worse, often a sticky
 * overlay covering the text. Hiding the usual container names is what makes the
 * page readable rather than merely lighter.
 */
export const HIDE_ADS_CSS = `
  [id*="ad-"], [id*="ad_"], [id^="ad"], [class*="ad-slot"], [class*="adslot"],
  [class*="advert"], [class*="ad-unit"], [class*="adsbygoogle"],
  [class*="taboola"], [class*="outbrain"], [class*="mgid"],
  [class*="sponsored"], [class*="promo-box"], [class*="sticky-ad"],
  iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
  iframe[src*="taboola"], iframe[src*="outbrain"],
  ins.adsbygoogle, .adsbygoogle, #div-gpt-ad, [data-ad-slot] {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
  }
  body { overflow-x: hidden !important; }
`;

/** Runs the hide-ads CSS after each load, and again when the page mutates. */
export const HIDE_ADS_JS = `
(function () {
  if (window.__noAdsInstalled) return true;
  window.__noAdsInstalled = true;
  var style = document.createElement('style');
  style.type = 'text/css';
  style.appendChild(document.createTextNode(${JSON.stringify(HIDE_ADS_CSS)}));
  (document.head || document.documentElement).appendChild(style);
  // Sticky ad bars are injected after load; strip them as they appear.
  var kill = function () {
    var nodes = document.querySelectorAll('[class*="sticky-ad"],[id*="sticky-ad"],[class*="ad-overlay"]');
    for (var i = 0; i < nodes.length; i++) nodes[i].style.display = 'none';
  };
  kill();
  try {
    new MutationObserver(kill).observe(document.body, { childList: true, subtree: true });
  } catch (e) {}
  true;
})();
true;
`;
