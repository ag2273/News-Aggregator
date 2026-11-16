import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, View, useColorScheme } from 'react-native';
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
  const [article, setArticle] = useState<Article | null>(null);
  const [visible, setVisible] = useState(false);
  const [showWeb, setShowWeb] = useState(false);

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
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={[styles.modalRoot, { backgroundColor: t.surface }]}>
          {article && showWeb ? (
            <WebViewPane url={article.url} title={article.sourceName} t={t} onClose={() => setShowWeb(false)} />
          ) : article ? (
            <ArticleReader
              article={article}
              t={t}
              onClose={close}
              onReadFull={() => setShowWeb(true)}
              onOpenSource={() => {
                close();
                router.push({ pathname: '/source/[id]', params: { id: article.sourceId } });
              }}
            />
          ) : null}
        </View>
      </Modal>
    </ArticleSheetContext.Provider>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
});
