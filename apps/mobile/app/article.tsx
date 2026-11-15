import { useLocalSearchParams, router } from 'expo-router';
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { palette } from '../constants/colors';

export default function ArticleScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const [loading, setLoading] = useState(true);
  const t = useColorScheme() === 'dark' ? palette.dark : palette.light;

  if (!url) return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.background }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityLabel="رجوع">
          <Text style={[styles.backIcon, { color: t.textPrimary }]}>→</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]} numberOfLines={1}>
          {title ?? 'الخبر'}
        </Text>
        <View style={styles.back} />
      </View>
      <View style={styles.webviewWrap}>
        <WebView
          source={{ uri: url }}
          onLoadEnd={() => setLoading(false)}
          style={styles.webview}
        />
        {loading && (
          <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color={t.dockActiveGlow} />
        )}
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
  backIcon: { fontSize: 22, fontWeight: '700' },
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
