import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Theme } from '../constants/colors';
import { fetchReaderArticle, type ReaderArticle, type ReaderBlock } from '../lib/api';
import { isDeviceFirstUrl } from '../lib/adBlockHosts';
import { fetchReaderWithRetry } from '../lib/readerResilience';
import { useArticleSpeech } from '../lib/articleSpeech';
import { ListenButton, SpeechNotice } from './ListenButton';
import { DeviceArticlePane } from './DeviceArticlePane';
import { WebViewPane } from './WebViewPane';

/**
 * Reading an article at its source, without the source's ads (#51).
 *
 * Order of attempts, and why:
 *
 *   1. **Reader view.** The server extracts the article (Mozilla Readability — the
 *      same extractor the digest has used in production) and sends it as blocks, so
 *      the body is drawn in the app's own design with no ad slot anywhere.
 *   2. **The source page, with ads blocked.** Extraction genuinely fails on some
 *      pages — a paywall, a bot wall, a gallery with no body. Then the page itself
 *      is the honest fallback, opened in the in-app WebView with a request filter
 *      and a hide-ads stylesheet, so the reader still sees the story.
 *
 * The rule the user set: reader first, blocked browser second. Nothing here
 * fabricates a body — an unreadable article goes to the browser rather than showing
 * a half-empty page dressed up as the story.
 */
/** Stable empty body, so the speech hook is not re-declared every render. */
const EMPTY_BLOCKS: never[] = [];

/**
 * The URL the browser fallback should open.
 *
 * Our feeds store Google-News redirect links, and Google's own article page renders
 * inside our WebView as an "invalid redirect" error instead of the story (#54). So
 * the server-resolved publisher URL wins whenever there is one; the Google link is
 * kept only as the last resort, where the server-side cleaner can still resolve it.
 */
export function publisherUrl(resolved: string | null | undefined, original: string): string {
  const candidate = (resolved ?? '').trim();
  if (/^https?:\/\//i.test(candidate) && !isGoogleNewsLink(candidate)) return candidate;
  return original;
}

/** Is this a Google-News article link rather than the publisher's own page? */
export function isGoogleNewsLink(url: string): boolean {
  return /^https?:\/\/news\.google\.com\//i.test(url.trim());
}

export function ArticleReadPane({
  url,
  articleId,
  title,
  t,
  onClose,
}: {
  url: string;
  articleId?: string;
  title: string;
  t: Theme;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'reader'; article: ReaderArticle }
    | { phase: 'web'; cleaned: boolean; reason?: string; target?: string }
  >({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // One bounded retry (#60). The user's own log showed the same article attempted
    // three times, each dying at the 20s deadline — the reader tapped again and paid
    // another 20s. A blip is worth one retry; a dead server is not worth a loop.
    fetchReaderWithRetry(articleId ?? null, url, { fetchReader: fetchReaderArticle })
      .then((article) => {
        if (cancelled) return;
        // `readable` is the server's verdict that it produced a body worth showing.
        if (article && article.readable && article.blocks.length) {
          setState({ phase: 'reader', article });
          return;
        }
        // The browser fallback must open the PUBLISHER's page. Our feed stores
        // `news.google.com` redirect links, and opening one of those shows Google's
        // "invalid redirect" error instead of the story — the reported bug (#54).
        setState({ phase: 'web', cleaned: true, target: publisherUrl(article?.resolvedUrl, url) });
      })
      .catch(() => {
        // The extract request itself failed. Still try the cleaned page: the two
        // come from the same server, but a failure here may be this request only.
        if (!cancelled) setState({ phase: 'web', cleaned: true, target: publisherUrl(null, url) });
      });
    return () => {
      cancelled = true;
    };
  }, [articleId, url]);

  const target = state.phase === 'web' ? state.target ?? publisherUrl(null, url) : url;

  // Read-aloud on this device (#56). Declared before the early returns because hooks
  // cannot be conditional; `enabled` keeps it inert on every phase but the reader.
  const speech = useArticleSpeech({
    title: state.phase === 'reader' ? state.article.title : null,
    blocks: state.phase === 'reader' ? state.article.blocks : EMPTY_BLOCKS,
    enabled: state.phase === 'reader',
  });

  const openExternally = useCallback(() => {
    // The one action the app cannot do for the reader: leave for their browser.
    Linking.openURL(target).catch(() => {});
  }, [target]);

  if (state.phase === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: t.surface }]}>
        <ActivityIndicator size="large" color={t.accent} />
      </View>
    );
  }

  // Nothing to open. Our feed stores Google-News redirect links, and when the server
  // could not work out which publisher page the link points at there is no page we
  // can show: Google's own shell renders as an "invalid redirect" error, which is
  // exactly what the reader reported (#54). Say so instead of showing that.
  if (state.phase === 'web' && isGoogleNewsLink(target)) {
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
        <View style={styles.center}>
          <Text style={[styles.unavailable, { color: t.textSecondary }]}>
            مش قادرين نفتح الخبر ده دلوقتي. جرّب تاني بعد شوية.
          </Text>
        </View>
      </View>
    );
  }

  if (state.phase === 'web') {
    // The three publishers our server cannot reach at all (#55). Their page is read
    // on the DEVICE: extracted into the reader design, or — when that is thin —
    // shown in the WebView with its ad requests refused natively. Measured: a plain
    // `fetch` from the device is refused by all three, a navigation is not.
    if (isDeviceFirstUrl(target)) {
      return (
        <DeviceArticlePane
          url={target}
          title={title}
          t={t}
          onClose={onClose}
          onExternal={openExternally}
        />
      );
    }
    // Every other publisher: the server-side cleaned page, loaded by WebViewPane.
    return (
      <WebViewPane
        url={state.target ?? publisherUrl(null, url)}
        title={title}
        t={t}
        onClose={onClose}
        blockAds
        fallbackNote="وضع القراءة مش متاح للخبر ده، فبنعرض الصفحة من غير إعلانات."
        unreachableNote="الصفحة بتفتح من المصدر مباشرة، فممكن تظهر إعلانات."
      />
    );
  }

  const { article } = state;
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
          وضع القراءة
        </Text>
        {/* Listen sits beside open-in-browser, where the user marked it (#56). */}
        <View style={styles.headerActions}>
          <ListenButton speech={speech} t={t} />
          <TouchableOpacity
            onPress={openExternally}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="فتح في المتصفح"
          >
            <Ionicons name="open-outline" size={19} color={t.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
      <SpeechNotice speech={speech} t={t} />

      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Text style={[styles.source, { color: t.textSecondary }]} numberOfLines={1}>
          {title}
        </Text>
        {article.title ? (
          <Text style={[styles.title, { color: t.textPrimary }]}>{article.title}</Text>
        ) : null}
        {article.blocks.map((block, i) => (
          <Block key={`${block.type}-${i}`} block={block} t={t} />
        ))}
        <TouchableOpacity
          style={[styles.sourceLink, { borderColor: t.borderLight }]}
          onPress={openExternally}
          accessibilityRole="button"
        >
          <Ionicons name="open-outline" size={15} color={t.accent} />
          <Text style={[styles.sourceLinkText, { color: t.accent }]}>اقرا الخبر على موقع المصدر</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/**
 * One block of the article.
 *
 * A video is offered as a link, not an embedded player: the app has no video
 * player dependency, and an embedded `<iframe>` player would need the source page's
 * scripts — which is the thing the reader view exists to avoid. A link opens it
 * where it actually plays.
 */
function Block({ block, t }: { block: ReaderBlock; t: Theme }) {
  if (block.type === 'heading') {
    return <Text style={[styles.heading, { color: t.textPrimary }]}>{block.text}</Text>;
  }
  if (block.type === 'image') {
    return (
      <View style={styles.imageWrap}>
        <Image source={{ uri: block.url }} style={styles.image} resizeMode="cover" />
        {block.caption ? (
          <Text style={[styles.caption, { color: t.textDim }]}>{block.caption}</Text>
        ) : null}
      </View>
    );
  }
  if (block.type === 'video') {
    return (
      <TouchableOpacity
        style={[styles.videoRow, { borderColor: t.borderLight, backgroundColor: t.badgePlate }]}
        onPress={() => Linking.openURL(block.url).catch(() => {})}
        accessibilityRole="button"
        accessibilityLabel="فتح الفيديو"
      >
        <Ionicons name="play-circle-outline" size={22} color={t.accent} />
        <Text style={[styles.videoText, { color: t.textPrimary }]}>فيديو داخل الخبر — افتحه للمشاهدة</Text>
      </TouchableOpacity>
    );
  }
  return <Text style={[styles.paragraph, { color: t.textPrimary }]}>{block.text}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  scrollBody: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 32 },
  source: { fontFamily: 'Cairo_400Regular', fontSize: 11, marginBottom: 10 },
  title: { fontFamily: 'Cairo_700Bold', fontSize: 21, lineHeight: 33, marginBottom: 14 },
  heading: { fontFamily: 'Cairo_700Bold', fontSize: 17, lineHeight: 27, marginTop: 14, marginBottom: 6 },
  // 1.85 line height is the readable value for Arabic at this size: the script's
  // ascenders and descenders collide below about 1.7.
  paragraph: { fontFamily: 'Cairo_400Regular', fontSize: 15, lineHeight: 27, marginBottom: 12 },
  imageWrap: { marginVertical: 10 },
  image: { width: '100%', height: 190, borderRadius: 12 },
  caption: { fontFamily: 'Cairo_400Regular', fontSize: 11, marginTop: 6 },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginVertical: 10,
  },
  videoText: { flex: 1, fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  sourceLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 18,
  },
  sourceLinkText: { fontFamily: 'Cairo_600SemiBold', fontSize: 13 },
  unavailable: {
    fontFamily: 'Cairo_400Regular',
    fontSize: 14,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: 28,
  },
});
