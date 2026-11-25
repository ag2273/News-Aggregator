// The ad and tracker hosts this app removes, shared by the server-side cleaner and
// (placed in the app's own lib) the WebView's link guard (#52).
//
// WHY A SHORT LIST AND NOT EASYLIST
// ---------------------------------
// EasyList is ~2MB and needs a parser plus a matcher over every request. This is the
// set of commercial ad/tracker networks these Arabic outlets actually load, which is
// what the reader is complaining about. The heavy lifting is done by removing the
// markup server-side; this list only decides which <script>/<iframe>/<link> tags go.

export const AD_HOSTNAMES = [
  // Google's ad stack and its measurement pixels.
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'googletagservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  '2mdn.net',
  // Content-recommendation widgets, the "you may also like" ad panels.
  'taboola.com',
  'outbrain.com',
  'mgid.com',
  'revcontent.com',
  'zemanta.com',
  'contentexchange.me',
  // Ad exchanges and sellers.
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
  'amazon-adsystem.com',
  'adsrvr.org',
  'teads.tv',
  'smartclip.net',
  'serving-sys.com',
  '360yield.com',
  'yieldmo.com',
  'sharethrough.com',
  'triplelift.com',
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
  'gemius.pl',
  'effectivecpmnetwork.com',
  'popcash.net',
  'clickadu.com',
  'hilltopads.net',
  'juicyads.com',
];
