/**
 * Android "double back to exit" for the home screen.
 *
 * Android convention: on the root screen, back should not silently close the app.
 * The first press explains how to leave; a second press within the window exits.
 *
 * Rules (from the spec):
 *  - only on the home screen, and only while nothing overlays it;
 *  - if a sheet, reader, picker or modal is open, back closes that first and no
 *    message is shown;
 *  - outside the window the state resets, so the next press explains again;
 *  - iOS is a no-op (there is no hardware back).
 *
 * The handler is registered with useFocusEffect, so it is active only while home
 * is focused and removed on blur — no leaks and no interference with other tabs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** How long a first press stays "armed". */
export const EXIT_WINDOW_MS = 2000;

export const EXIT_MESSAGE = 'اسحب للرجوع مرة كمان للخروج';

export interface DoubleBackOptions {
  /** True when something (sheet, reader, picker, modal) currently overlays home. */
  isOverlayOpen: boolean;
  /** Called when the second press should exit. Defaults to BackHandler.exitApp. */
  exit?: () => void;
  now?: () => number;
  platform?: string;
}

export interface DoubleBackState {
  /** True while the "press again" message should be visible. */
  showHint: boolean;
}

/**
 * Pure decision for one back press — the whole rule, testable without React.
 *
 * Returns whether to exit, and whether the hint should currently show.
 */
export function decideBack(
  firstPressAt: number | null,
  now: number,
  isOverlayOpen: boolean,
  windowMs: number = EXIT_WINDOW_MS,
): { exit: boolean; arm: number | null; showHint: boolean } {
  // Something is open: the caller lets that close; never exit, never nag.
  if (isOverlayOpen) return { exit: false, arm: null, showHint: false };

  const withinWindow = firstPressAt !== null && now - firstPressAt <= windowMs;
  if (withinWindow) return { exit: true, arm: null, showHint: false };
  return { exit: false, arm: now, showHint: true };
}

/**
 * Registers the home-screen back handler.
 * `enabled` lets a screen opt out entirely (iOS, or a non-root screen).
 */
export function useDoubleBackToExit({
  isOverlayOpen,
  exit,
  now = Date.now,
  platform = Platform.OS,
}: DoubleBackOptions): DoubleBackState {
  const firstPressAt = useRef<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHint = useCallback(() => {
    if (hintTimer.current) {
      clearTimeout(hintTimer.current);
      hintTimer.current = null;
    }
    setShowHint(false);
  }, []);

  useEffect(() => () => clearHint(), [clearHint]);

  useFocusEffect(
    useCallback(() => {
      // iOS has no hardware back; registering anything here would be dead code.
      if (platform !== 'android') return undefined;

      const onBack = (): boolean => {
        const decision = decideBack(firstPressAt.current, now(), isOverlayOpen);
        if (decision.exit) {
          firstPressAt.current = null;
          clearHint();
          (exit ?? BackHandler.exitApp)();
          return true;
        }
        firstPressAt.current = decision.arm;
        if (decision.showHint) {
          setShowHint(true);
          if (hintTimer.current) clearTimeout(hintTimer.current);
          hintTimer.current = setTimeout(() => setShowHint(false), EXIT_WINDOW_MS);
        }
        // Always consume the press: we handled it.
        return true;
      };

      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => {
        sub.remove();
        // Leaving the screen disarms, so returning later starts fresh.
        firstPressAt.current = null;
        clearHint();
      };
    }, [clearHint, exit, isOverlayOpen, now, platform]),
  );

  return { showHint };
}
