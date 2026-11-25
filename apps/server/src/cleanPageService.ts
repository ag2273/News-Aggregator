// Serving a cleaned copy of a publisher page for the in-app browser (#52).
//
// WHY THIS EXISTS
// ---------------
// The first attempt hid ads with injected CSS inside the WebView. Measured on the
// user's device: "almost all the ads still show". CSS cannot help there — the ad
// SCRIPTS have already run and built their own containers, and react-native-webview
// exposes no sub-resource interception on either platform. Hiding a box after the
// network already paid for it is not ad blocking.
//
// So the page is fetched HERE, the ad and tracker scripts and their containers are
// removed from the markup, and the cleaned HTML is served to the WebView. The ads
// are never loaded because they are no longer in the document.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ----------------------------------
// It is not a general proxy. Only the specific page is fetched, links inside it are
// rewritten to absolute URLs so they still work, and the page's own stylesheets,
// images and fonts are kept — a "clean" page that lost its CSS is not readable.

import { fetchPage, isGoogleNewsUrl, resolveGoogleNewsUrl } from './articleText.js';
import { stripAdMarkup } from './cleanPage.js';

/** How long a cleaned page is reused per URL. */
const TTL_MS = 10 * 60 * 1000;

interface Cached {
  at: number;
  html: string;
}

const cache = new Map<string, Cached>();
const inFlight = new Map<string, Promise<string | null>>();

/** Test seam. */
export function resetCleanCache(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * The page with its ads removed, or null when it could not be fetched.
 *
 * Null is the honest answer for a publisher that refuses our server (measured:
 * dostor.org resets the TLS handshake from this host, IPv4 and IPv6). The route
 * turns that into a clear message rather than serving an ad-laden page and calling
 * it cleaned.
 */
export async function cleanPage(
  url: string,
  now: number = Date.now(),
  deps: { fetchImpl?: typeof fetch; resolve?: (u: string) => Promise<string | null> } = {},
): Promise<string | null> {
  const cached = cache.get(url);
  if (cached && now - cached.at < TTL_MS) return cached.html;
  const running = inFlight.get(url);
  if (running) return running;

  const resolve = deps.resolve ?? resolveGoogleNewsUrl;

  const job = (async (): Promise<string | null> => {
    try {
      // Every stored article URL from our feeds is a `news.google.com` link, not the
      // publisher's own. Fetching that link and cleaning it served Google's shell
      // page back with a 200 — which the WebView then rendered as an "invalid
      // redirect" error, and which never produced the 502 that switches the reader
      // to the publisher's live page (issue #54). Resolve it first, exactly as the
      // reader endpoint does, and refuse to ever serve Google's own document.
      const target = isGoogleNewsUrl(url) ? await resolve(url) : url;
      if (!target || isGoogleNewsUrl(target)) return null;
      const page = await fetchPage(target, deps.fetchImpl);
      if (!page.ok || !page.text) return null;
      const html = stripAdMarkup(page.text, target);
      // A page that still has no body after cleaning is not worth showing.
      return html || null;
    } catch {
      return null;
    }
  })();

  inFlight.set(url, job);
  try {
    const html = await job;
    if (html) cache.set(url, { at: Date.now(), html });
    return html;
  } finally {
    inFlight.delete(url);
  }
}
