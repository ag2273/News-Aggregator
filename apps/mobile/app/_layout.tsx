import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState, I18nManager, ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ArticleSheetProvider } from '../components/ArticleSheet';
import { AuthProvider, useAuth } from '../lib/auth';
import {
  addNotificationResponseListener,
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
  }, []);
  useEffect(() => addPushTokenRefreshListener(() => token), [token]);

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

  // Open the article a tapped notification refers to.
  useEffect(() => addNotificationResponseListener(), []);

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
