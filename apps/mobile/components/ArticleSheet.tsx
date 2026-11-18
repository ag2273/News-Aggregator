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
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { palette } from '../constants/colors';
import type { Theme } from '../constants/colors';
import type { Article } from '../lib/api';
import { sheetDismissOutcome } from '../lib/swipe';
import { ArticleReader } from './ArticleReader';
import { WebViewPane } from './WebViewPane';

const SPRING = { damping: 20, stiffness: 200 };

interface ArticleSheetApi {
  open: (article: Article) => void;
  close: () => void;
  /**
   * True while the sheet (or its full-article WebView) covers the screen.
   * Screens use this to defer to the sheet: the home screen must let back close
   * the sheet before it considers exiting the app.
   */
  isOpen: boolean;
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
  const [isAtTop, setIsAtTop] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const ty = useSharedValue(0);

  // The sheet covers ~3/4 of the screen so the feed stays visible above it.
  const sheetHeight = Math.round(height * 0.75);

  const open = useCallback(
    (next: Article) => {
      setIsAtTop(true);
      setIsDragging(false);
      setIsClosing(false);
      setArticle(next);
      setShowWeb(false);
      ty.value = sheetHeight + 40;
      setVisible(true);
      ty.value = withTiming(0, { duration: 250 });
    },
    [sheetHeight, ty],
  );

  const finishClose = useCallback(() => {
    setVisible(false);
    setShowWeb(false);
    setIsAtTop(true);
    setIsDragging(false);
    setIsClosing(false);
  }, []);

  const close = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    ty.value = withTiming(sheetHeight + 40, { duration: 220 }, (finished) => {
      'worklet';
      if (finished) runOnJS(finishClose)();
    });
  }, [finishClose, isClosing, sheetHeight, ty]);

  const api = useMemo<ArticleSheetApi>(
    () => ({ open, close, isOpen: visible || showWeb }),
    [open, close, visible, showWeb],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!showWeb && isAtTop && !isClosing)
        .activeOffsetY(10)
        .failOffsetY(-10)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          runOnJS(setIsDragging)(true);
        })
        .onUpdate((e) => {
          ty.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          const dismiss = sheetDismissOutcome(e.translationY, e.velocityY);
          if (dismiss) {
            runOnJS(setIsClosing)(true);
            ty.value = withTiming(sheetHeight + 40, { duration: 220 }, (finished) => {
              'worklet';
              if (finished) runOnJS(finishClose)();
            });
          } else {
            ty.value = withSpring(0, SPRING);
          }
        })
        .onFinalize(() => {
          runOnJS(setIsDragging)(false);
        }),
    [finishClose, isAtTop, isClosing, sheetHeight, showWeb, ty],
  );

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      ty.value,
      [0, sheetHeight + 40],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });

  return (
    <ArticleSheetContext.Provider value={api}>
      {children}
      <Modal
        visible={visible}
        animationType="none"
        transparent
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={close}
      >
        <GestureHandlerRootView style={styles.modalRoot}>
          {/* Tapping the visible strip of feed above the sheet dismisses it. */}
          <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="إغلاق" />
          </Animated.View>
          <GestureDetector gesture={pan}>
            <Animated.View
              style={[
                styles.sheet,
                { height: sheetHeight, backgroundColor: t.surface },
                sheetAnimatedStyle,
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
                  onScrollTopChange={setIsAtTop}
                  scrollEnabled={!isDragging && !isClosing}
                  onOpenSource={() => {
                    close();
                    router.push({ pathname: '/source/[id]', params: { id: article.sourceId } });
                  }}
                />
              ) : null}
            </Animated.View>
          </GestureDetector>
        </GestureHandlerRootView>
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
