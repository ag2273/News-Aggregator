import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { WebViewNavigation } from 'react-native-webview';
import { AdBlockingWebView } from '../lib/nativeAdBlock';
import type { Theme } from '../constants/colors';
import { HIDE_ADS_JS, cleanPageUrl, isBlockedRequest } from '../lib/adBlock';

/** In-app WebView pane with its own header. Used by the /webview route and the article sheet. */
export function WebViewPane({
  url,
  title,
  t,
  onClose,
  blockAds = false,
  fallbackNote,
  unreachableNote,
}: {
  url: string;
  title: string;
  t: Theme;
  onClose: () => void;
  /** Drop ad and tracker requests, and hide the empty slots they leave. */
  blockAds?: boolean;
  /** Shown once above the page, so the reader knows why they are not in reader view. */
  fallbackNote?: string;
  /** Shown instead when the cleaned page could not be produced at all. */
  unreachableNote?: string;
}) {
  const [loading, setLoading] = useState(true);
  // If the cleaned page is genuinely unavailable the WebView shows its own error;
  // the header note must then say the truth rather than claim the ads are gone.
  const [failed, setFailed] = useState(false);
  // The server could not fetch the publisher (measured: dostor.org, ahram.org.eg and
  // alarabiya.net reset its TLS handshake). The user's decision: load the page
  // DIRECTLY from the device instead, with the injection doing what it can. The ads
  // then do load — that is the accepted trade, so the note says so.
  const [direct, setDirect] = useState(false);

  const onShouldStart = useCallback(
    (req: WebViewNavigation) => (blockAds ? !isBlockedRequest(req.url) : true),
    [blockAds],
  );

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
      {fallbackNote ? (
        <Text style={[styles.note, { color: t.textSecondary, backgroundColor: t.badgePlate }]}>
          {direct && unreachableNote ? unreachableNote : failed && unreachableNote ? unreachableNote : fallbackNote}
        </Text>
      ) : null}
      <View style={styles.webviewWrap}>
        <AdBlockingWebView
          // With ads blocked, the CLEANED page is loaded instead of the live one:
          // the ad scripts are already gone from the document, so they never run.
          // Measured: hiding them with injected CSS left "almost all the ads"
          // visible, because the scripts had already built their containers (#52).
          source={{ uri: blockAds && !direct ? cleanPageUrl(url) : url }}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onHttpError={(e) => {
            // 502 from our cleaner means "publisher not reachable from the server".
            // Rather than stopping, load the page from THIS device. The user chose
            // this and accepts that the ads then load, because the alternative is no
            // page at all; the injection still hides what it can on the screen.
            // NOT verified: whether every phone's own network can reach these hosts —
            // only the user's device can answer that.
            if ((e.nativeEvent as { statusCode?: number }).statusCode === 502) {
              setDirect(true);
              setLoading(true);
            }
          }}
          // This callback sees TOP-LEVEL navigations only, so it stops a tap that
          // would open an ad landing page, and nothing more.
          onShouldStartLoadWithRequest={onShouldStart}
          {...(blockAds
            ? {
                // Request-level blocking: the ad payloads are refused before the
                // network, by the patched native client (#55). This is the layer that
                // actually removes them.
                blockAds: true,
                // Second layer: hides any slot whose container still appears, and the
                // sticky overlays the remaining scripts fill.
                injectedJavaScript: HIDE_ADS_JS,
                javaScriptEnabled: true,
              }
            : {})}
          style={styles.webview}
        />
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
  note: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 11,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  webviewWrap: { flex: 1 },
  webview: { flex: 1 },
});
