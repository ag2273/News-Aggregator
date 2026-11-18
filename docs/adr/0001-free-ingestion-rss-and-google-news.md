# 0001 — Free ingestion via RSS + Google News RSS, no scraping

## Context
The product needs Arabic and Egyptian news without paying a news API. Some outlets
publish a usable RSS feed; others block server requests (403 or timeouts) or return
an empty channel — `youm7`'s own SectionRss answers 200 with a 538-byte empty
channel. The spec also forbids scraping full article bodies.

## Decision
Ingest from two sources only, server-side, every 10 minutes:
- the outlet's direct RSS where it works (`apps/server/src/types.ts`), and
- Google News RSS with a `site:` filter for the rest.

Store only title, summary, image, link, source and timestamps. Never fetch or store
the article body; the reader opens the original in a WebView. Deduplicate by URL.

## Consequences
- Zero data cost, no key rotation, and the source list is data, not code.
- Google News titles carry an outlet suffix and its links are redirect URLs; both
  are tolerated (this is why breaking-label detection handles `- عاجل -`).
- A dead feed is invisible unless measured — `youm7` contributed 0 articles for
  months while returning HTTP 200. Feed health must be checked by article count,
  not status code.
- Adding a source is a one-object change in `types.ts` plus an entry in
  `docs/SOURCES.md`.
