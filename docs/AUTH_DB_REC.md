# T4 Auth/DB Recommendation

## Recommendation: Self-hosted JWT (not Supabase)

**Reason:** This is an Egypt-focused app likely deployed on a local/self-managed server
(already running Node+SQLite). Adding Supabase introduces an external dependency,
a Postgres instance, and a paid tier once traffic grows. Self-hosted JWT with:

- `jose` or `jsonwebtoken` for HS256 token signing
- Phone-number OTP or email magic-link via SMTP (free)
- User table in the existing SQLite DB (or Postgres if scale demands it)

keeps the stack homogeneous, free, and fully self-contained.

**Use Supabase instead if:** the team wants managed auth, row-level security,
real-time subscriptions, or social logins out of the box — Supabase's free tier
covers early-stage comfortably and its client SDK reduces boilerplate significantly.
