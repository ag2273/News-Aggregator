import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';

/** In-app WebView for the full article at the original source. */
export default function WebViewScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const [loading, setLoading] = useState(true);

  if (!url) return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.surface }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: t.borderLight }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityLabel="رجوع">
          <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]} numberOfLines={1}>
          {title ?? 'المصدر'}
        </Text>
        <View style={styles.back} />
      </View>
      <View style={styles.webviewWrap}>
        <WebView source={{ uri: url }} onLoadEnd={() => setLoading(false)} style={styles.webview} />
        {loading ? (
          <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color={t.accent} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: 'Cairo_700Bold',
    fontSize: 16,
    paddingHorizontal: 8,
  },
  webviewWrap: { flex: 1 },
  webview: { flex: 1 },
});
