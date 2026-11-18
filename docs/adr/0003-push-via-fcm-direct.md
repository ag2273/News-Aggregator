# 0003 — Push via FCM HTTP v1 directly, not the Expo push service

## Context
The first implementation used the Expo push service: a device registered an Expo
push token and the server posted to `exp.host`. It never worked on the user's
device. Root cause, confirmed in the shipped APK: no `google_app_id` /
`gcm_defaultSenderId` resources, so Firebase never initialised and
`FirebaseMessaging.getInstance()` threw inside `expo-notifications` before any
network call — and the app reported it as a connection error.

## Decision
Talk to Firebase Cloud Messaging directly:
- the device registers its **native FCM token** (`getDevicePushTokenAsync`) with
  `provider: 'fcm'`; `addPushTokenListener` re-registers on rotation,
- the server signs a JWT with a Firebase service-account key and exchanges it for
  an OAuth2 token (`apps/server/src/push.ts`, no Google SDK), then posts one v1
  message per token with at most 10 in flight,
- `google-services.json` is baked in at build time from the
  `GOOGLE_SERVICES_JSON` repo secret; the build fails without it,
- two Android channels: `breaking` (high importance) and `news` (default).
- Tokens FCM reports as `UNREGISTERED` / `NOT_FOUND` / `INVALID_ARGUMENT` are
  deleted from the registry.

## Consequences
- No Expo account, no Expo push tokens; the delivery path is Google-only.
- Only articles published in the last 15 minutes are sent, so a backfill or a
  re-classification never notifies anyone (pinned by a vitest case).
- Legacy `ExponentPushToken[...]` records are dropped on load and rejected at
  registration.
- Setup is heavier: one service-account key on the VM, one build secret. Both are
  documented in `docs/PUSH-SETUP.md`.
