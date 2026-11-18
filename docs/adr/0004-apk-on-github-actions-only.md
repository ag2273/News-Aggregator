# 0004 — APK builds on GitHub Actions only, released as GitHub Releases

## Context
The app has to reach a real phone. Local Android builds on the dev machine froze
the whole box (CPU/RAM), and EAS builds were another moving part. Separately, the
GitHub account's Actions **artifact** storage quota was exhausted, which failed a
job whose build had already succeeded.

## Decision
- Build only in `.github/workflows/build-android.yml`; no local Gradle, no EAS.
- `arm64-v8a` only (`-PreactNativeArchitectures=arm64-v8a`), legacy packaging on.
- Hard size gate: the job fails above 30 MB (31,457,280 bytes).
- Publish the APK as a **GitHub Release** asset (`apk-<run_number>`, prerelease)
  instead of an Actions artifact, because releases are not quota-limited.
- The workflow fails fast if `GOOGLE_SERVICES_JSON` is missing or the config has no
  client for `com.nileorbit.newsrator`.

## Consequences
- A successful build is always downloadable, and the size budget stays enforced.
- Every push touching `apps/mobile/**` costs a ~20 minute run; batching changes
  matters.
- Releases accumulate as prerelease tags; nothing is deleted automatically.
- Signing uses the debug-compatible release config in the generated project; a
  Play-ready keystore is out of scope while distribution is a GitHub APK.
