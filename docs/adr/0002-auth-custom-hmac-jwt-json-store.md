# 0002 — Custom HMAC-SHA256 session tokens over a JSON-file store

## Context
Accounts need sign-up, sign-in, session persistence and per-user data (follows,
saved articles, push tokens, verification state). The original spec assumed
Supabase; the recommendation in `docs/AUTH_DB_REC.md` favoured keeping the stack
self-hosted and homogeneous for a single-VM deployment.

## Decision
No Supabase, no third-party auth. Instead:
- passwords hashed with scrypt and a per-user salt (`apps/server/src/auth.ts`),
- sessions are a self-contained token: base64url payload `{userId, exp}` plus an
  HMAC-SHA256 signature with `AUTH_SECRET`, valid 30 days,
- storage is JSON files under `DATA_DIR` (`users.json`, `follows.json`,
  `saved.json`), loaded into an in-process cache and rewritten on change,
- the token lives in the app in `expo-secure-store`.

## Consequences
- One dependency-free auth path; nothing to provision, and the whole database is
  a directory you can copy.
- Rotating `AUTH_SECRET` logs everyone out; a forged token is impossible without it.
- The in-memory cache means **writes must go through the running server**. Editing
  `users.json` or `push-tokens.json` behind a live process gets overwritten on the
  next save. Cleanup must be done inside the process (or followed by a restart).
- JSON files are not a database: no transactions, no indexes. Acceptable at this
  scale; revisit if the corpus or user count grows.
