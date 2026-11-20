# Privacy data map — «رئيس التحرير» (nileorbit.com)

Every row below was verified against the code on 2026-11-21, not copied from a
template. File references are what the claim rests on. The public page built from
this inventory is `apps/server/src/privacy.ts`, served at `/privacy`.

## What exists

| Data | Purpose | Store / third party | Retention | Verified in |
|---|---|---|---|---|
| Email, name, scrypt password hash, `emailVerified`, `verifiedAt`, `createdAt` | Account, sign-in, email verification | Our server: `DATA_DIR/users.json` | Until account deletion | `apps/server/src/users.ts` |
| Session JWT (signed, 30-day expiry) | Staying signed in | Device SecureStore (`news_aggregator_auth_token`); server only verifies | 30 days from issue | `apps/server/src/auth.ts`, `apps/mobile/lib/auth.ts` |
| Followed sources | Personalised feed | `DATA_DIR/follows.json` | Until unfollow / deletion | `apps/server/src/follows.ts` |
| Saved articles | المحفوظات | `DATA_DIR/saved.json` | Until unsaved / deletion | `apps/server/src/saved.ts` |
| Reactions (5 types) + `updatedAt` | Reactions on cards and in the reader | `DATA_DIR/reactions.json` | Until removed / deletion | `apps/server/src/reactions.ts` |
| Followed keywords, muted keywords, muted sources, per-keyword notify | Feed tuning, keyword pushes | `DATA_DIR/keywords.json` | Until removed / deletion | `apps/server/src/keywords.ts` |
| FCM device token + push mode (`urgent` / `all`) | Notifications | `DATA_DIR/push-tokens.json` + Google FCM | Until unregister / deletion | `apps/server/src/push.ts` |
| Crash data, device/OS info | Fixing crashes | Google Firebase Crashlytics | Per Firebase project settings | `apps/mobile/lib/crash.ts` (Crashlytics only; no analytics, no ad id) |
| Email address + verification message | Verification link | Resend → recipient | Resend's own handling | `apps/server/src/verify.ts` |
| Random install id (`X-Install-Id`) | Daily active devices | Hashed with a **daily salt**; the raw id is never stored | Hash list kept for today + yesterday, then counts only; buckets pruned at 90 days | `apps/server/src/analytics.ts`, `apps/mobile/lib/analytics.ts` |
| Aggregate usage counts: opens, shares, source page views, search query text, saves, follows, mutes, sign-ups | Understanding real usage | `DATA_DIR/analytics.json` | 90 days | `apps/server/src/analytics.ts` |
| Server/access logs: client IP, time, path | Running, securing, diagnosing | Docker `json-file` logs on the VM (no rotation configured at the time of writing) | Bounded by the Docker log configuration; not used for behaviour analysis | `deploy/Caddyfile` (`log`), `docker-compose.yml` |
| Rate-limit state: client IP → request timestamps | Throttling beacons and admin logins | **In memory only**, never written to disk | Until the process restarts | `apps/server/src/analytics.ts` (`beaconHits`), `apps/server/src/adminReactions.ts` (`failures`) |
| Article content: titles, summaries, images, links | Displaying news | `DATA_DIR/news.json` (public RSS only; full articles are not stored) | Rolling store of recent items | `apps/server/src/db.ts` |

## What is deliberately absent

- No Firebase Analytics, no ad SDK, no Advertising ID, no third-party analytics.
- No email or user id appears on the admin stats page, its CSV, or the analytics
  store (asserted by tests in `apps/server/src/__tests__/analytics.test.ts`).
- Search query text is stored as a plain counter with no caller attached.
- The install id is never joined to an account.

## Infrastructure facts on the page

- **VM**: Google Cloud `e2-micro`, zone `us-central1-c` (United States), Caddy
  terminating TLS in front of the Hono server on port 3001 (not published).
- **Mail**: Cloudflare email routing (`route1/2/3.mx.cloudflare.net`); DMARC
  record at `_dmarc.nileorbit.com` references `privacy@nileorbit.com`.
- **Publisher shown**: «رئيس التحرير — nileorbit.com». No company/legal entity
  is asserted, because the repository does not name one.
  **TODO-OWNER-NAME** — if a registered entity must be named for Play, it has to
  come from the owner; nothing here invents one.

## Open items for the owner

1. **Confirm `privacy@nileorbit.com` actually receives mail.** The DMARC record
   references it and Cloudflare routing exists, but a mailbox rule that forwards
   it somewhere is the owner's to verify. The page publishes this address.
2. **Add an in-app privacy notice** (a first-run screen, not just the link). Play
   expects the policy URL, which now exists, but a visible notice is still worth
   having.
3. **Docker log rotation** is not configured (`json-file`, no `max-size`). Caddy
   logs client IPs; a `max-size`/`max-file` pair would bound retention to
   something stated, instead of "whatever disk allows".
