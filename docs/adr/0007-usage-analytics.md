# ADR 0007 — Usage analytics: server-side aggregate counts only

## Context
The owner wants to see how the app is used: which articles get opened, which
sources and categories matter, what people search for, and how many devices are
active. There is no analytics SDK in the app and we do not want one: Google Play
data-safety is simpler without Firebase Analytics or an advertising id, and an
aggregate count needs no personal data at all.

## Decision
Count everything **server-side**, from the calls the app already makes, plus
three small beacons for actions the server cannot see:

| Signal | Source |
|---|---|
| Article opens | `POST /api/events/open {articleId}` (the reader never used to call the server) |
| Shares | `POST /api/events/share {articleId}` |
| Daily active devices | `GET /api/events/ping` on app start, plus any beacon |
| Source page views | existing `GET /api/sources/:id/articles` |
| Search queries | existing `GET /api/search?q=`, stored as normalized text + count |
| Saves, follows, keyword follows/mutes | existing routes, counted at the write |
| Sign-ups, total/verified users | the existing user store, as counts |
| Reactions | the existing reaction store, via `/admin/reactions` |

### The install id
The app generates one random id per install (`lib/analytics.ts`, SecureStore;
resettable by reinstalling) and sends it as `X-Install-Id`. The server:

1. hashes it with **that Cairo day's salt** (16 random bytes, rotated at midnight)
   and stores the 32-hex hash in the day's device list;
2. never stores, logs or returns the raw id;
3. keeps the hashed list for **today and yesterday only**, then keeps just the
   count — so a device cannot be followed across days even by the operator;
4. drops the salt when the day rolls out, and prunes buckets beyond **90 days**.

The id is never joined to a user id, and ten beacons a minute per IP keeps a
scripted flood from being mistaken for users.

### Storage
`DATA_DIR/analytics.json` — one bucket per Cairo day:
`{ devices?: hash[], dau?, opens?, shares?, sourceViews?, queries?, signups?, events? }`
plus the day's salt. Bounded: ~90 day keys of counters and a device list that
shrinks to one number after a day. It survives deploys because it lives on the
same volume as the other stores.

## Consequences
- `/admin/stats` and `/admin/stats.csv`, Basic auth + noindex + the same failed-login
  rate limit as `/admin/reactions`, with a nav pill between the two pages.
- A privacy test asserts that a seeded install id, email and user id appear
  nowhere in the store file, the page or the CSV. It was shown to fail when the
  raw id or a user id is deliberately leaked.
- **Open item:** the app has no in-app privacy notice. Google Play expects one to
  describe this collection; it needs adding before the next store submission.
- DAU is device-based, not person-based. One person with two devices counts twice.
  That is intentional: it measures reach without identifying anyone.
