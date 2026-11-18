# 0006 — Email verification by link, gated on the server

## Context
Any typed email was accepted at sign-up, so an account could exist with an address
its owner did not control. The product needs proof of ownership without blocking
reading, and the client cannot be the authority.

## Decision
- Sign-up creates the account with `emailVerified: false`, sends a link through
  Resend, and **still returns a session** so the user can read immediately.
- Token: 32 random bytes, only its **SHA-256 hash** is stored
  (`DATA_DIR/verify-tokens.json`), single use, 24-hour expiry; issuing a new token
  invalidates the previous one.
- `GET /verify?token=` consumes it and renders a small RTL Arabic success or error
  page with no JavaScript.
- `POST /api/auth/resend-verification`: 60-second cooldown, 5 per rolling day, 429
  with `retryAfterSeconds`; already-verified is a 200 no-op.
- **Twelve account-bound endpoints return 403 `EMAIL_NOT_VERIFIED`** until
  verified (`requireVerified` in `apps/server/src/index.ts`). Browsing, search and
  the source pages stay public.
- Accounts created before this existed are migrated to verified once, on load.
- The mobile app treats the 403 as its own case: gated screens do not call gated
  endpoints while unverified, and show a locked state instead (`ApiError` carries
  the status and code, so a gate is never rendered as a network failure).

## Consequences
- The server is the authority; a modified client cannot skip verification.
- Two failure modes are now distinguishable to the user: "verify your email" versus
  "check your connection". That distinction is pinned by `test:verification`.
- Delivery depends on Resend, and the key is a send-only key (the `/domains`
  endpoint answers 401 `restricted_api_key` by design). A missing key logs one
  warning at boot and sign-up still works, just without the email.
