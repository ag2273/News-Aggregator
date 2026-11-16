import React from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import { WebViewPane } from '../components/WebViewPane';

/** Standalone in-app WebView route (kept for direct links). */
export default function WebViewScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;

  if (!url) return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.surface }]} edges={['top']}>
      <View style={styles.root}>
        <WebViewPane url={url} title={title ?? 'المصدر'} t={t} onClose={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
