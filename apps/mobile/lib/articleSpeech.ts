// Driving Android's own text-to-speech for the reader (#56).
//
// WHY A HOOK
// ----------
// The button, the sheet's close handler and the screen's unmount all need to agree on
// one thing: whether this article is being read aloud right now. Keeping that in one
// hook means "tap to stop", "close the sheet" and "leave the screen" can never leave
// the engine talking in the background — which is the failure a reader would notice
// most.
//
// The engine is `expo-speech`, which is Android's built-in TextToSpeech: free, no
// server, no network. Its output is queued here a segment at a time; `Speech.speak`
// queues internally, so the article is handed over sentence by sentence rather than
// as one long string the engine would cut.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Speech from 'expo-speech';
import {
  ENGINE_LANGUAGE,
  MISSING_VOICE_MESSAGE,
  SILENT_ENGINE_MESSAGE,
  articleToSpeech,
  pickArabicVoice,
} from './speech';
import type { SpeechSegment, SpeakableBlock } from './speech';

/**
 * Arabic (Egypt), the voice the app's readers expect. It picks the VOICE; the engine
 * itself is always given the bare `ar` (see ENGINE_LANGUAGE for why `ar-EG` went silent).
 */
export const SPEECH_LANGUAGE = 'ar-EG';

/**
 * How long the engine may hold the article without saying a word before the reader is
 * told. A healthy engine starts in well under a second; past this it is not coming.
 */
export const START_TIMEOUT_MS = 8000;

export type SpeechPhase = 'idle' | 'starting' | 'speaking' | 'unsupported';

export interface ArticleSpeech {
  phase: SpeechPhase;
  /** A one-line Arabic note for the reader, or null. */
  notice: string | null;
  /** Start reading from the top, or stop if already reading. */
  toggle: () => void;
  /** Stop and release the engine. Safe to call when nothing is playing. */
  stop: () => void;
}

/**
 * Read one article aloud, on this device.
 *
 * `enabled` is false on any surface without a header button, so nothing is ever
 * queued there.
 */
export function useArticleSpeech({
  title,
  blocks,
  enabled = true,
  language = SPEECH_LANGUAGE,
}: {
  title: string | null;
  blocks: SpeakableBlock[];
  enabled?: boolean;
  language?: string;
}): ArticleSpeech {
  const [phase, setPhase] = useState<SpeechPhase>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  // One run at a time: a second tap must not queue a second article over the first.
  const runRef = useRef(0);
  const mounted = useRef(true);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWatchdog = () => {
    if (watchdog.current) {
      clearTimeout(watchdog.current);
      watchdog.current = null;
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearWatchdog();
      // Leaving the screen must not leave the phone talking (#56).
      Speech.stop().catch(() => {});
    };
  }, []);

  const stop = useCallback(() => {
    // Bumping the run invalidates any queued continuation from the old call.
    runRef.current += 1;
    clearWatchdog();
    Speech.stop().catch(() => {});
    setPhase('idle');
  }, []);

  const toggle = useCallback(() => {
    if (!enabled) return;
    if (phase === 'speaking' || phase === 'starting') {
      stop();
      return;
    }
    const segments = articleToSpeech(title, blocks);
    if (segments.length === 0) {
      setPhase('idle');
      setNotice('مفيش نص في الخبر ده يتقري.');
      return;
    }
    const run = (runRef.current += 1);
    setNotice(null);
    setPhase('starting');
    void (async () => {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        if (run !== runRef.current || !mounted.current) return;
        // No Arabic voice means the engine would read the article in the phone's
        // default language, which is worse than saying so plainly.
        const voice = pickArabicVoice(voices, language);
        if (!voice) {
          setPhase('unsupported');
          setNotice(MISSING_VOICE_MESSAGE);
          return;
        }
        // Clear anything already queued, then hand the article over segment by segment.
        await Speech.stop();
        if (run !== runRef.current || !mounted.current) return;
        setPhase('speaking');
        // A silent engine used to leave the stop icon up forever with no sound, which
        // reads as "the button does nothing". If it has not started in time, say so.
        clearWatchdog();
        watchdog.current = setTimeout(() => {
          watchdog.current = null;
          if (run !== runRef.current || !mounted.current) return;
          runRef.current += 1;
          Speech.stop().catch(() => {});
          setPhase('idle');
          setNotice(SILENT_ENGINE_MESSAGE);
        }, START_TIMEOUT_MS);
        speakAll(segments, run, () => runRef.current, {
          language: ENGINE_LANGUAGE,
          voice: voice.identifier,
          onStart: () => {
            if (run === runRef.current) clearWatchdog();
          },
          onDone: () => {
            if (run === runRef.current && mounted.current) {
              clearWatchdog();
              setPhase('idle');
            }
          },
          onError: () => {
            if (run === runRef.current && mounted.current) {
              clearWatchdog();
              runRef.current += 1;
              Speech.stop().catch(() => {});
              setPhase('idle');
              setNotice(SILENT_ENGINE_MESSAGE);
            }
          },
        });
      } catch {
        if (run === runRef.current && mounted.current) {
          setPhase('idle');
          setNotice(MISSING_VOICE_MESSAGE);
        }
      }
    })();
  }, [enabled, phase, stop, title, blocks, language]);

  return { phase, notice, toggle, stop };
}

/**
 * Queue every segment.
 *
 * `Speech.speak` appends to the engine's queue, so the whole article is handed over at
 * once and the engine reads it in order. Each call is guarded with the run id so a
 * stale article can never keep queueing after the reader pressed stop.
 */
export function speakAll(
  segments: SpeechSegment[],
  run: number,
  currentRun: () => number,
  options: {
    language: string;
    voice?: string;
    onStart?: () => void;
    onDone?: () => void;
    onError?: () => void;
  },
): void {
  segments.forEach((segment, index) => {
    if (currentRun() !== run) return;
    Speech.speak(segment.text, {
      language: options.language,
      ...(options.voice ? { voice: options.voice } : {}),
      // Slightly slower than default: Arabic news read at 1.0 is hard to follow, and
      // the same value the platform's own accessibility defaults use.
      rate: 0.95,
      pitch: 1.0,
      onStart: index === 0 ? options.onStart : undefined,
      onDone: index === segments.length - 1 ? options.onDone : undefined,
      onError: options.onError,
    });
  });
}

/** The two React Native Linking calls this needs, as a narrow shape for tests. */
export interface LinkingLike {
  sendIntent?: (action: string) => Promise<unknown>;
  openSettings?: (setting: string) => Promise<unknown>;
}

/** Opens Android's own text-to-speech settings, where the Arabic voice is installed. */
export async function openVoiceInstallSettings(Linking: LinkingLike): Promise<void> {
  // The official intent that shows "install voice data" for the current engine.
  const ACTION_INSTALL_TTS_DATA = 'android.speech.tts.engine.INSTALL_TTS_DATA';
  if (Linking.sendIntent) {
    try {
      await Linking.sendIntent(ACTION_INSTALL_TTS_DATA);
      return;
    } catch {
      /* fall through to the settings screen */
    }
  }
  if (Linking.openSettings) {
    await Linking.openSettings('tts_settings').catch(() => {});
  }
}
