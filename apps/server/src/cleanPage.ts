// Removing ads from a publisher page before it reaches the in-app browser (#52).
//
// WHAT IS REMOVED
// ---------------
//   * <script> tags pointing at an ad/tracker network, and inline scripts that are
//     recognisably an ad loader (googletag, taboola, outbrain, adsbygoogle).
//   * elements whose id/class marks them as an ad slot (the same names the CSS
//     attempt used, which is why they are proven to exist on these pages).
//   * iframes pointing at ad hosts.
//   * <link rel=preload/preconnect> to ad hosts, which would otherwise start the
//     request even with the script gone.
//
// WHAT IS KEPT
// ------------
// Everything the article needs: its own stylesheets, images, fonts and inline
// styles. A page stripped of its CSS is not a readable page, so the cleaning is
// surgical: remove the ad networks, keep the publication.
//
// Relative URLs are made absolute against the page's own base, because the browser
// is now showing our host, not theirs.

import { AD_HOSTNAMES } from './adHosts.js';

/** Is this URL (or host) one of the ad networks? */
export function isAdUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url, 'https://example.invalid').hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return AD_HOSTNAMES.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Inline script bodies that ARE ad loaders, matched on their own vocabulary. */
const INLINE_AD_SCRIPT = /(googletag|\badsbygoogle\b|taboola|outbrain|doubleclick|googlesyndication|advertise|adSlot|gpt\.js|prebid|amazon-adsystem)/i;

/** Then fetch the page's own base URL so links inside it still work. */
function absolutise(html: string, base: string, origin: string): string {
  // src/href that are site-relative, pointed at the publisher so the images and
  // stylesheets the page needs still resolve.
  return html
    .replace(/\b(src|href)=(["'])\/(?!\/)([^"']*)\2/gi, (_m, attr, q, rest) => `${attr}=${q}${origin}/${rest}${q}`)
    // Protocol-relative URLs ("//cdn.example/x.png") need a scheme, or a WebView
    // loading our http(s) page may refuse them.
    .replace(/\b(src|href)=(["'])\/\/([^"']*)\2/gi, (_m, attr, q, rest) => `${attr}=${q}https://${rest}${q}`)
    // A <base> pointing at the publisher makes every remaining relative URL resolve
    // the way it did on the original page, including ones inside inline styles.
    .replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`);
}

/**
 * The page without its ads, ready to serve to the WebView.
 *
 * Exported so the cleaning rules can be tested against a real page's markup.
 */
export function stripAdMarkup(html: string, url: string): string {
  let base: URL;
  try {
    base = new URL(url);
  } catch {
    return '';
  }
  const origin = base.origin;
  let out = html;

  // 1. Ad-network script tags, preloads and preconnects, in both attribute orders.
  out = out.replace(/<script\b[^>]*>/gi, (tag) => {
    const m = tag.match(/src=["']([^"']+)["']/i);
    return m && isAdUrl(m[1]!) ? '<!-- ad script removed -->' : tag;
  });
  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    return m && isAdUrl(m[1]!) ? '' : tag;
  });

  // 2. Inline scripts that are an ad loader. Kept as an empty comment so the
  //    document order (and any `</script>`-adjacent markup) is unchanged.
  out = out.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs: string, body: string) => {
    if (/src=/i.test(attrs)) return whole; // already handled above
    return INLINE_AD_SCRIPT.test(body) ? '<!-- inline ad script removed -->' : whole;
  });

  // 3. Ad iframes.
  out = out.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (tag) => {
    const m = tag.match(/src=["']([^"']+)["']/i);
    return m && isAdUrl(m[1]!) ? '<!-- ad iframe removed -->' : tag;
  });
  out = out.replace(/<iframe\b[^>]*\/>/gi, (tag) => {
    const m = tag.match(/src=["']([^"']+)["']/i);
    return m && isAdUrl(m[1]!) ? '<!-- ad iframe removed -->' : tag;
  });

  // 4. Containers the ad scripts build. The names are the ones measured on these
  //    outlets: ad-slot, adsbygoogle, taboola, outbrain, gpt, sticky-ad.
  const AD_SLOT_NAME =
    /(^|[\s_-])(ad|ads|adslot|adsbygoogle|advert|advertisement|taboola|outbrain|mgid|sponsored|sticky-ad|gpt-ad)([\s_-]|$)/i;
  // Paired containers first…
  out = out.replace(
    /<(div|ins|aside|section|span|figure)\b[^>]*\b(?:id|class)=["']([^"']*)["'][^>]*>[\s\S]*?<\/\1>/gi,
    (whole, _tag: string, name: string) =>
      AD_SLOT_NAME.test(name) ? '<!-- ad container removed -->' : whole,
  );
  // …then any remaining empty/self-closed element carrying an ad class, `ins`
  // included: measured pages ship `<ins class="adsbygoogle" …></ins>` and the paired
  // pass can miss it when the tag is not the first attribute holder.
  out = out.replace(/<(ins|div|span|iframe)\b[^>]*\b(?:id|class)=["']([^"']*)["'][^>]*>\s*<\/\1>/gi,
    (whole, _tag: string, name: string) => (AD_SLOT_NAME.test(name) ? '<!-- ad container removed -->' : whole));
  out = out.replace(/<(ins|div|span)\b[^>]*\b(?:id|class)=["']([^"']*(?:adsbygoogle|adslot|ad-slot)[^"']*)["'][^>]*>/gi,
    '<!-- ad container removed -->');

  return absolutise(out, base.href, origin);
}
