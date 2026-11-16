import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import type { Theme } from '../constants/colors';

/** In-app WebView pane with its own header. Used by the /webview route and the article sheet. */
export function WebViewPane({
  url,
  title,
  t,
  onClose,
}: {
  url: string;
  title: string;
  t: Theme;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);

  return (
    <View style={[styles.root, { backgroundColor: t.surface }]}>
      <View style={[styles.header, { borderBottomColor: t.borderLight }]}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="رجوع"
        >
          <Ionicons name="chevron-forward" size={22} color={t.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.back} />
      </View>
      <View style={styles.webviewWrap}>
        <WebView source={{ uri: url }} onLoadEnd={() => setLoading(false)} style={styles.webview} />
        {loading ? (
          <ActivityIndicator style={StyleSheet.absoluteFill} size="large" color={t.accent} />
        ) : null}
      </View>
    </View>
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
