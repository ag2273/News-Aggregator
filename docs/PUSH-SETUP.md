# Push notifications — what the app still needs

The app side is finished: the settings screen, the server registry, the sender,
and the error messages. What is missing is the Google/Firebase wiring that
Android needs before an Expo push token can exist at all.

## Why it is needed

On Android, `expo-notifications` gets its Expo push token from an FCM token
(`PushTokenModule.getDevicePushTokenAsync` → `FirebaseMessaging.getInstance()`).
Without Firebase config that call throws:

```
Unable to get Firebase Messaging instance. Did you configure `googleServicesFile` path in app config?
```

So the switch could never turn on, and the old toast blamed the network. The
settings screen now says the truth instead («الإشعارات غير مهيّأة في هذه النسخة»).

Two separate things are required, and both are needed:

1. **`google-services.json` in the app** — Firebase project config, baked in at
   build time. Without it the app cannot even ask Firebase for a token.
2. **An FCM V1 service-account key on the EAS project** — lets Expo's push
   service authenticate to Google when it sends. `pushSecurityEnabled` is false
   and no FCM V1 key is uploaded for `@zorro_tmh/news-aggregator` today.

## Steps (the account owner must do these)

1. Create a Firebase project (any name), add an **Android app** with package
   `com.nileorbit.newsrator`.
2. Download its `google-services.json`.
3. Add it to the repo as a secret: **Settings → Secrets and variables → Actions
   → New repository secret**, name `GOOGLE_SERVICES_JSON_B64`, value
   `base64 -w0 google-services.json`.
   (`.github/workflows/build-android.yml` writes the file before prebuild; a
   missing secret only produces a warning, the build still succeeds.)
4. In Firebase → Project settings → **Service accounts**, generate a new private
   key (JSON).
5. Upload that key to Expo: `eas credentials` → Android →
   `com.nileorbit.newsrator` → **FCM V1**, or the Expo dashboard's Android
   credentials page. This is the key Expo uses to send through FCM.
6. Rebuild the APK. Push should then register on first launch.

Nothing above can be done from this machine: it needs a Google account and it
creates cloud resources.
