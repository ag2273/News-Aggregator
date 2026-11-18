/**
 * Dynamic Expo config.
 *
 * app.json stays the single source of truth; this file only adds what cannot be
 * committed: the Firebase Android config that push notifications need.
 *
 * Android push tokens are FCM tokens, so `expo-notifications` can only mint one
 * when the app is built with google-services.json
 * (`FirebaseMessaging.getInstance()` throws otherwise and the settings screen
 * reports "not configured"). The file contains project keys, so it is not in the
 * repo — CI writes it from the GOOGLE_SERVICES_JSON secret before prebuild, and
 * a local build can drop it at apps/mobile/google-services.json.
 *
 * When it is absent the config is returned unchanged: the build still succeeds,
 * it just cannot receive push.
 */

const fs = require('node:fs');
const path = require('node:path');

/** app.json -> the expo object that expo-router imports elsewhere. */
module.exports = ({ config }) => {
  const googleServicesFile = path.join(__dirname, 'google-services.json');

  if (!fs.existsSync(googleServicesFile)) {
    return config;
  }

  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile: './google-services.json',
    },
  };
};
