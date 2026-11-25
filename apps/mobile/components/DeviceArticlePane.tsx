// Reading a publisher our server cannot reach, from the device itself (#55).
//
// WHY A WEBVIEW AND NOT `fetch()`
// -------------------------------
// Measured on all three publishers, from a browser shaped like the app:
//
//   dostor.org    fetch() -> TypeError, the connection is reset
//   alarabiya.net fetch() -> 403, and the body is a challenge page (130 Arabic chars)
//   ahram.org.eg  fetch() -> 403 with browser headers; 200 but only 350 chars of prose
//
// A real NAVIGATION to the same URLs works: with the ad requests refused, العربية
// gave 14 paragraphs / 1,963 Arabic characters. So the page is loaded by a WebView —
// which is what actually gets the story — and its settled markup is read back out.
//
// ONE WebView, TWO OUTCOMES. It loads the page with the native ad blocking on, so the
// story is read without paying for its ads. Then:
//
//   1. the extracted article is drawn in the app's own reader design, the same look
//      the server reader gives every other source; or
//   2. if the extraction is thin (MIN_DEVICE_*), the same WebView is simply revealed
//      on the original URL, ads still blocked. No banner, no user action.
//
// Nothing is fetched twice: the page the extractor reads IS the page shown on
// failure, so the fallback is instant.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import type { DeviceArticle } from '../lib/deviceReader';
import { extractDeviceArticle } from '../lib/deviceReader';
import { AdBlockingWebView } from '../lib/nativeAdBlock';
import { HIDE_ADS_JS } from '../lib/adBlock';
import { useArticleSpeech } from '../lib/articleSpeech';
import { ListenButton, SpeechNotice } from './ListenButton';

/**
 * How long to wait for the page before showing it as-is.
 *
 * These outlets are slow, and slow is not broken: the wait exists only so a page that
 * never settles still reaches the reader instead of spinning forever. Measured load
 * times on the three were 4–7s.
 */
export const EXTRACT_TIMEOUT_MS = 12000;

/**
 * Read the settled document, once, and hand it to the app.
 *
 * Injected after load: the article body of these pages is built by their own scripts,
 * so the raw response is not the story. Posted (not returned) because React Native
 * discards an injected script's return value.
 *
 * Two passes — at load, and once more a moment later — because the body of a slow
 * page can still be filling in when the load event fires. `__deviceReadDone` keeps it
 * to a single post, and the body is capped so a pathological page cannot flood the
 * bridge.
 */
export const EXTRACT_PAGE_JS = `
(function () {
  var sent = false;
  function post(tag) {
    if (sent) return;
    sent = true;
    try {
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      window.ReactNativeWebView.postMessage(JSON.stringify({ tag: tag, html: html.slice(0, 1500000) }));
    } catch (e) {
      try { window.ReactNativeWebView.postMessage(JSON.stringify({ tag: 'error', html: '' })); } catch (e2) {}
    }
  }
  post('load');
  setTimeout(function () { post('late'); }, 2500);
})();
true;
`;

/** Stable empty body, so the speech hook is not re-declared every render. */
const EMPTY_BLOCKS: never[] = [];

export type DevicePhase =
  | { phase: 'extracting' }
  | { phase: 'reader'; article: DeviceArticle }
  | { phase: 'web' };

export function DeviceArticlePane({
  url,
  title,
  t,
  onClose,
  onExternal,
}: {
  url: string;
  title: string;
  t: Theme;
  onClose: () => void;
  onExternal?: () => void;
}) {
  const [state, setState] = useState<DevicePhase>({ phase: 'extracting' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read-aloud for a page read on the device (#56).
  const speech = useArticleSpeech({
    title: state.phase === 'reader' ? state.article.title : null,
    blocks: state.phase === 'reader' ? state.article.blocks : EMPTY_BLOCKS,
    enabled: state.phase === 'reader',
  });

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /** One decision, made once: draw the story, or reveal the page. */
  const settle = useCallback(
    (html: string) => {
      clearTimer();
      setState((current) => {
        if (current.phase !== 'extracting') return current;
        if (!html) return { phase: 'web' };
        const article = extractDeviceArticle(html, url);
        return article.readable ? { phase: 'reader', article } : { phase: 'web' };
      });
    },
    [url, clearTimer],
  );

  useEffect(() => {
    timer.current = setTimeout(() => settle(''), EXTRACT_TIMEOUT_MS);
    return clearTimer;
  }, [settle, clearTimer]);

  const webview = useMemo(
    () => (
      <AdBlockingWebView
        blockAds
        source={{ uri: url }}
        injectedJavaScript={HIDE_ADS_JS + EXTRACT_PAGE_JS}
        javaScriptEnabled
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data) as { html?: string };
            settle(payload.html ?? '');
          } catch {
            settle('');
          }
        }}
        // A page that cannot load at all is shown as-is with the honest note; there
        // is nothing better to offer and no server copy exists for these three.
        onError={() => settle('')}
        onHttpError={() => settle('')}
        style={styles.webview}
      />
    ),
    [url, settle],
  );

  if (state.phase === 'reader') {
    return (
      <ReaderView
        article={state.article}
        title={title}
        t={t}
        onClose={onClose}
        onExternal={onExternal}
        speech={speech}
      />
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.surface }]}>
      <Header title={title} t={t} onClose={onClose} onExternal={onExternal} />
      <View style={styles.webviewWrap}>
        {webview}
        {state.phase === 'extracting' ? (
          <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: t.surface }]}>
            <ActivityIndicator size="large" color={t.accent} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The app's reader design, for a page read on the device. */
function ReaderView({
  article,
  title,
  t,
  onClose,
  onExternal,
  speech,
}: {
  article: DeviceArticle;
  title: string;
  t: Theme;
  onClose: () => void;
  onExternal?: () => void;
  speech: ReturnType<typeof useArticleSpeech>;
}) {
  return (
    <View style={[styles.root, { backgroundColor: t.surface }]}>
      <Header
        title={title}
        t={t}
        onClose={onClose}
        onExternal={onExternal}
        reader
        speech={speech}
      />
      <SpeechNotice speech={speech} t={t} />
      <ScrollView contentContainerStyle={styles.scrollBody}>
        {article.title ? (
          <Text style={[styles.title, { color: t.textPrimary }]}>{article.title}</Text>
        ) : null}
        {article.blocks.map((block, i) => {
          if (block.type === 'heading') {
            return (
              <Text key={`h-${i}`} style={[styles.heading, { color: t.textPrimary }]}>
                {block.text}
              </Text>
            );
          }
          if (block.type === 'image') {
            return (
              <View key={`i-${i}`} style={styles.imageWrap}>
                <Image source={{ uri: block.url }} style={styles.image} resizeMode="cover" />
                {block.caption ? (
                  <Text style={[styles.caption, { color: t.textDim }]}>{block.caption}</Text>
                ) : null}
              </View>
            );
          }
          return (
            <Text key={`p-${i}`} style={[styles.paragraph, { color: t.textPrimary }]}>
              {block.text}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Header({
  title,
  t,
  onClose,
  onExternal,
  reader = false,
  speech,
}: {
  title: string;
  t: Theme;
  onClose: () => void;
  onExternal?: () => void;
  reader?: boolean;
  /** Present only on the reader view, where there is text to read aloud. */
  speech?: ReturnType<typeof useArticleSpeech>;
}) {
  return (
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
        {reader ? 'وضع القراءة' : title}
      </Text>
      {onExternal ? (
        <View style={styles.headerActions}>
          {/* Listen sits beside open-in-browser, where the user marked it (#56). */}
          {reader && speech ? <ListenButton speech={speech} t={t} /> : null}
          <TouchableOpacity
            onPress={onExternal}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="فتح في المتصفح"
          >
            <Ionicons name="open-outline" size={19} color={t.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.back} />
      )}
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
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'Cairo_700Bold', fontSize: 14 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  webviewWrap: { flex: 1 },
  webview: { flex: 1 },
  cover: { alignItems: 'center', justifyContent: 'center' },
  scrollBody: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 32 },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 21, lineHeight: 33, marginBottom: 14 },
  heading: { fontFamily: 'Cairo_700Bold', fontSize: 17, lineHeight: 27, marginTop: 14, marginBottom: 6 },
  paragraph: { fontFamily: 'Cairo_400Regular', fontSize: 15, lineHeight: 27, marginBottom: 12 },
  imageWrap: { marginVertical: 10 },
  image: { width: '100%', height: 190, borderRadius: 12 },
  caption: { fontFamily: 'Cairo_400Regular', fontSize: 11, marginTop: 6 },
});
