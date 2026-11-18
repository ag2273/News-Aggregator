# Push notifications (FCM direct) — setup

The app sends push through **Firebase Cloud Messaging HTTP v1** directly.
There is no Expo push service, no Expo push token and no dependency on an Expo
account: the device registers its native FCM token, and the server signs a JWT
with a service account to call FCM.

Two files make it work. Neither belongs in git.

## 1. `google-services.json` (mobile, build time)

Firebase → Project settings → your Android app (`com.nileorbit.newsrator`) →
download `google-services.json`.

The APK cannot mint an FCM token without it: `expo-notifications` calls
`FirebaseMessaging.getInstance()`, which throws when the Firebase config is
missing.

**Where it goes in CI:** repository secret `GOOGLE_SERVICES_JSON_B64`, holding
the base64 of the file:

```bash
base64 -w0 google-services.json | pbcopy   # or your clipboard tool
```

Then add it at GitHub → Settings → Secrets and variables → Actions → New
repository secret, name `GOOGLE_SERVICES_JSON_B64`.

`.github/workflows/build-android.yml` decodes it to
`apps/mobile/google-services.json` before prebuild, then **fails the build** if
the secret is missing, if the file has no client for `com.nileorbit.newsrator`,
or if prebuild did not copy it to `android/app/`. Shipping an APK that silently
cannot receive push is worse than failing the build.

`apps/mobile/app.config.js` adds `android.googleServicesFile` only when the file
is present, so a local build without the secret still runs (just without push).

## 2. Service-account key (server, runtime)

Firebase → Project settings → Service accounts → **Generate new private key**.

**Where it goes on the VM:** `~/news-aggregator/deploy/secrets/fcm-service-account.json`
on the host. `docker-compose.yml` mounts that directory read-only at
`/data/secrets`, and the server reads
`/data/secrets/fcm-service-account.json`.

```bash
# on the VM
cd ~/news-aggregator
mkdir -p deploy/secrets
chmod 700 deploy/secrets
# paste the JSON into the file, then:
chmod 600 deploy/secrets/fcm-service-account.json
docker compose up -d server
docker compose logs server | grep '\[push\]'
```

`FCM_SERVICE_ACCOUNT_FILE` overrides the path. A missing key logs one warning at
boot and disables sending — the server stays up and keeps serving the news feed.

## What the server sends

One FCM v1 request per token, at most 10 in flight:

```json
{
  "message": {
    "token": "<device FCM token>",
    "notification": { "title": "خبر عاجل", "body": "<article title>" },
    "data": { "articleId": "<id>" },
    "android": {
      "priority": "high",
      "notification": { "channel_id": "breaking", "color": "#22C55E" }
    }
  }
}
```

Breaking news uses the `breaking` channel and `high` priority; everything else
uses `news` and `normal`. Those two channels are created by the app on launch.

Rules that still apply: matches the device preference (`urgent` = breaking only,
`all` = everything), only articles published in the last 15 minutes, never on the
first refresh after boot, one push per article per process. A token FCM reports
as `UNREGISTERED` / `NOT_FOUND` / `INVALID_ARGUMENT` is deleted from the registry.

## Tokens from the old Expo setup

`ExponentPushToken[...]` records cannot be delivered by FCM and are dropped when
`push-tokens.json` is loaded. Devices re-register their FCM token the next time
the app starts with notifications allowed.
