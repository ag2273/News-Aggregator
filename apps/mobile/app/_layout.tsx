import { Stack, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';
import { AppState, I18nManager, ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ArticleSheetProvider } from '../components/ArticleSheet';
import { AuthProvider, useAuth } from '../lib/auth';
import { cairoDay } from '../lib/dates';
import { logEvent } from '../lib/perfLog';
import { initCrashReporting } from '../lib/crash';
import { beaconPing } from '../lib/analytics';
import {
  addNotificationResponseListener,
  handleInitialNotification,
  addPushTokenRefreshListener,
  ensureNotificationChannels,
} from '../lib/notifications';
import {
  useFonts,
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
} from '@expo-google-fonts/cairo';

// Force RTL for Arabic
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

/**
 * Keeps the server's copy of this device's FCM token current: channels are
 * created once, and a rotated token is re-registered immediately.
 */
function PushTokenSync() {
  const { token, refreshSession } = useAuth();
  useEffect(() => {
    ensureNotificationChannels();
    // One aggregate "this install is active today" count. Fire and forget.
    beaconPing();
  }, []);
  useEffect(() => addPushTokenRefreshListener(() => token), [token]);

  // Boot marker for the performance log (#60). The start-up matches prefetch that used
  // to run here was rolled back with the rest of the device cache (#59) — the user's
  // decision: the app behaved better without it.
  useEffect(() => {
    logEvent('boot', 'root-rendered', { signedIn: !!token });
  }, [token]);

  // Verification happens in the browser, so re-read the session whenever the
  // app comes back to the foreground: the user taps the link, returns, and the
  // banner disappears without a restart.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshSession().catch(() => {});
    });
    return () => sub.remove();
  }, [refreshSession]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Cairo_400Regular,
    Cairo_600SemiBold,
    Cairo_700Bold,
  });

  // Open the article a tapped notification refers to, while the app is running.
  useEffect(() => addNotificationResponseListener(), []);
  // ...and the tap that LAUNCHED the app. The listener above only fires while
  // the app is alive, so a cold start from a push (the usual case: the phone was
  // asleep) used to fall through and open the default screen. Wait for the
  // router to mount, then route to the digest/article the push pointed at.
  const navigationState = useRootNavigationState();
  useEffect(() => {
    if (!navigationState?.key) return;
    void handleInitialNotification(async () => {
      // One tick after the root navigator exists, so a push during mount lands.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // Only once per mount: the response is cleared inside the handler.
  }, [navigationState?.key]);

  // Crash reporting only (no analytics). Failure here must never block startup.
  useEffect(() => {
    initCrashReporting().catch(() => {});
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#22C55E" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <PushTokenSync />
          <ArticleSheetProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </ArticleSheetProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
