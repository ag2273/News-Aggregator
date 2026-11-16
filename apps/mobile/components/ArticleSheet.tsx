import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import type { Article } from '../lib/api';
import { ArticleReader } from './ArticleReader';
import { WebViewPane } from './WebViewPane';

interface ArticleSheetApi {
  open: (article: Article) => void;
  close: () => void;
}

const ArticleSheetContext = createContext<ArticleSheetApi | null>(null);

/** Access the in-place article sheet from any screen. */
export function useArticleSheet(): ArticleSheetApi {
  const ctx = useContext(ArticleSheetContext);
  if (!ctx) throw new Error('useArticleSheet must be used inside <ArticleSheetProvider>');
  return ctx;
}

/**
 * Presents an article over the current screen (slide-up modal) instead of
 * navigating to another route. "Read the full story" swaps the sheet content
 * for the in-app WebView, so the feed stays underneath the whole time.
 */
export function ArticleSheetProvider({ children }: { children: React.ReactNode }) {
  const t: Theme = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const { height } = useWindowDimensions();
  const [article, setArticle] = useState<Article | null>(null);
  const [visible, setVisible] = useState(false);
  const [showWeb, setShowWeb] = useState(false);
  // The sheet covers ~3/4 of the screen so the feed stays visible above it.
  const sheetHeight = Math.round(height * 0.75);

  const open = useCallback((next: Article) => {
    setArticle(next);
    setShowWeb(false);
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setShowWeb(false);
  }, []);

  const api = useMemo<ArticleSheetApi>(() => ({ open, close }), [open, close]);

  return (
    <ArticleSheetContext.Provider value={api}>
      {children}
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={styles.modalRoot}>
          {/* Tapping the visible strip of feed above the sheet dismisses it. */}
          <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="إغلاق" />
          <View
            style={[
              styles.sheet,
              { height: sheetHeight, backgroundColor: t.surface },
            ]}
          >
            {article && showWeb ? (
              <WebViewPane
                url={article.url}
                title={article.sourceName}
                t={t}
                onClose={() => setShowWeb(false)}
              />
            ) : article ? (
              <ArticleReader
                article={article}
                t={t}
                variant="sheet"
                onClose={close}
                onReadFull={() => setShowWeb(true)}
                onOpenSource={() => {
                  close();
                  router.push({ pathname: '/source/[id]', params: { id: article.sourceId } });
                }}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </ArticleSheetContext.Provider>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
  },
  sheet: {
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
});
