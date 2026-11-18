/**
 * Keyboard geometry for the auth forms.
 *
 * Why not KeyboardAvoidingView: the Android build is edge-to-edge (prebuild sets
 * edgeToEdgeEnabled=true), so the window is no longer resized by the IME.
 * KeyboardAvoidingView derives its offset from `endCoordinates.screenY`, which
 * under edge-to-edge reports the screen bottom rather than the keyboard top, so
 * the offset collapses to 0 and the keyboard just covers the form.
 * `endCoordinates.height` is still the true IME height, so that is what this
 * hook uses.
 *
 * The padding is the *uncovered* part of the keyboard: if the window does get
 * resized (a non-edge-to-edge build, or a future Android release), the window
 * height shrinks by the same amount and the padding drops to zero instead of
 * pushing the form up twice.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  Keyboard,
  type LayoutChangeEvent,
  Platform,
  type ScrollViewInstance,
  useWindowDimensions,
} from 'react-native';

/** Current keyboard height in dp; 0 while it is hidden. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = Keyboard.addListener(showEvent, (event) => {
      setHeight(event.endCoordinates.height);
    });
    const onHide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  return height;
}

export interface FormKeyboardAwareness {
  scrollRef: RefObject<ScrollViewInstance | null>;
  /** Bottom padding for the scroll content, so the form clears the keyboard. */
  contentPaddingBottom: number;
  /** Attach to the wrapper View of each field, keyed by a stable id. */
  onFieldLayout: (key: string) => (event: LayoutChangeEvent) => void;
  /** Attach to each field's onFocus. */
  onFieldFocus: (key: string) => () => void;
}

/**
 * Keeps the focused field and the submit button above the keyboard: pads the
 * scroll content by the keyboard overlap and scrolls the focused field into
 * view when the keyboard opens.
 */
export function useFormKeyboardAwareness(basePadding = 20): FormKeyboardAwareness {
  const keyboardHeight = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const offsets = useRef<Record<string, number>>({});
  const focused = useRef<string | null>(null);
  // Window height measured while no keyboard is up.
  const restingHeight = useRef(windowHeight);

  // How much the window shrank because of the keyboard (0 under edge-to-edge).
  const shrink =
    keyboardHeight === 0 ? 0 : Math.max(0, restingHeight.current - windowHeight);

  useEffect(() => {
    if (keyboardHeight === 0) restingHeight.current = windowHeight;
  }, [keyboardHeight, windowHeight]);

  const overlap = Math.max(0, Math.min(keyboardHeight - shrink, keyboardHeight));

  const onFieldLayout = useCallback(
    (key: string) => (event: LayoutChangeEvent) => {
      offsets.current[key] = event.nativeEvent.layout.y;
    },
    [],
  );

  const onFieldFocus = useCallback(
    (key: string) => () => {
      focused.current = key;
    },
    [],
  );

  // Once the keyboard is up, bring the focused field to the top of what is left.
  useEffect(() => {
    if (keyboardHeight === 0) return;
    const key = focused.current;
    if (!key) return;
    const y = offsets.current[key];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, [keyboardHeight, overlap]);

  return {
    scrollRef,
    contentPaddingBottom: basePadding + overlap,
    onFieldLayout,
    onFieldFocus,
  };
}
