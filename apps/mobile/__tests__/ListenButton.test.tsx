/**
 * The listen button and its lifecycle (#56).
 *
 * What a reader gets: one tap in the reader header starts the article, the icon shows
 * it is speaking, a second tap stops it, and closing the article stops it too. These
 * drive the REAL hook against a mocked engine, so "it stops when closed" is checked as
 * behaviour rather than by reading the cleanup function.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { palette } from '../constants/colors';

jest.mock('@react-native-firebase/crashlytics', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-firebase/app', () => ({ __esModule: true, default: () => null }));

// The engine, recorded instead of run: what matters is WHEN it is asked to speak and
// to stop, and with what. Jest hoists `jest.mock` above the imports, so the recorded
// state lives on a hoisted variable rather than a module-level const.
const engine = (globalThis as any).__speechEngine ??= {
  spoken: [] as { text: string; options: Record<string, unknown> }[],
  stopCalls: [] as number[],
  voices: [{ language: 'ar-EG', identifier: 'ar-eg-local' }] as { language: string; identifier: string }[],
  voicesThrows: false,
};
const spoken: { text: string; options: Record<string, unknown> }[] = engine.spoken;
const stopCalls: number[] = engine.stopCalls;

jest.mock('expo-speech', () => ({
  speak: (text: string, options: Record<string, unknown>) => {
    (globalThis as any).__speechEngine.spoken.push({ text, options });
  },
  stop: async () => {
    (globalThis as any).__speechEngine.stopCalls.push(Date.now());
  },
  getAvailableVoicesAsync: async () => {
    const e = (globalThis as any).__speechEngine;
    if (e.voicesThrows) throw new Error('engine unavailable');
    return e.voices;
  },
}));

import { useArticleSpeech } from '../lib/articleSpeech';
import { ListenButton, SpeechNotice } from '../components/ListenButton';

const t = palette.light;

const BODY = Array.from(
  { length: 4 },
  (_, i) =>
    `هذه الفقرة رقم ${i + 1} من الخبر وهي طويلة بما يكفي لتكون فقرة حقيقية تُقرأ بصوت عربي واضح ومفهوم للمستمع. `.repeat(2),
);

/** A reader header, isolated: the button plus whatever the hook exposes. */
function Harness({
  blocks = BODY,
  title = 'عنوان الخبر',
}: {
  blocks?: string[];
  title?: string | null;
}) {
  const speech = useArticleSpeech({
    title,
    blocks: blocks.map((text) => ({ type: 'paragraph' as const, text })),
  });
  return (
    <View>
      <ListenButton speech={speech} t={t} />
      <SpeechNotice speech={speech} t={t} />
      <Text testID="phase">{speech.phase}</Text>
    </View>
  );
}

const press = async () => {
  await act(async () => {
    fireEvent.press(screen.getByTestId('listen-button'));
  });
};

beforeEach(() => {
  engine.spoken.length = 0;
  engine.stopCalls.length = 0;
  engine.voices = [{ language: 'ar-EG', identifier: 'ar-eg-local' }];
  engine.voicesThrows = false;
});
afterEach(() => cleanup());

describe('the listen button', () => {
  it('starts reading the headline and then the body', async () => {
    render(<Harness />);
    await press();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('speaking'));

    // The headline is the first thing said, and the body follows it.
    expect(spoken[0]!.text).toBe('عنوان الخبر');
    expect(spoken.length).toBeGreaterThan(1);
    expect(spoken.map((s) => s.text).join(' ')).toContain('رقم 1');
    // Arabic, at a deliberately slower rate than the platform default.
    expect(spoken[0]!.options.language).toBe('ar-EG');
    expect(spoken[0]!.options.rate).toBeCloseTo(0.95);
  });

  it('shows it is speaking, and stops on the second tap', async () => {
    render(<Harness />);
    expect(screen.getByLabelText('استماع للخبر')).toBeTruthy();

    await press();
    await waitFor(() => expect(screen.getByLabelText('إيقاف الاستماع')).toBeTruthy());

    const before = spoken.length;
    await press();
    await waitFor(() => expect(screen.getByLabelText('استماع للخبر')).toBeTruthy());
    // Stopping asks the engine to stop, and queues nothing more.
    expect(stopCalls.length).toBeGreaterThan(0);
    expect(spoken.length).toBe(before);
  });

  it('stops when the article is closed, so the phone does not keep talking', async () => {
    // This is the case a reader notices most: leave the sheet, the voice must stop.
    const { unmount } = render(<Harness />);
    await press();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('speaking'));

    const beforeStop = stopCalls.length;
    await act(async () => {
      unmount();
    });
    expect(stopCalls.length).toBeGreaterThan(beforeStop);
  });

  it('says a plain Arabic message when no Arabic voice is installed', async () => {
    engine.voices = [{ language: 'en-US', identifier: 'en-us-local' }];
    render(<Harness />);
    await press();

    // Nothing is read in the wrong language…
    expect(spoken).toHaveLength(0);
    // …and the reader is told why, with the action that fixes it.
    await waitFor(() => expect(screen.getByText(/مفيش صوت عربي منزّل/)).toBeTruthy());
    expect(screen.getByTestId('install-voice-button')).toBeTruthy();
  });

  it('treats an engine that cannot list voices as a missing voice', async () => {
    engine.voicesThrows = true;
    render(<Harness />);
    await press();
    expect(spoken).toHaveLength(0);
    await waitFor(() => expect(screen.getByText(/مفيش صوت عربي منزّل/)).toBeTruthy());
  });

  it('says a short Arabic line instead of speaking when there is no text at all', async () => {
    // No headline and no body: the extractor found a page with nothing to say.
    render(<Harness title={null} blocks={[]} />);
    await press();
    expect(spoken).toHaveLength(0);
    await waitFor(() => expect(screen.getByText(/مفيش نص في الخبر ده/)).toBeTruthy());
  });

  it('still reads the headline when the body is empty', async () => {
    // A one-line brief is a real article: the headline is worth hearing.
    render(<Harness blocks={[]} />);
    await press();
    await waitFor(() => expect(spoken.length).toBeGreaterThan(0));
    expect(spoken[0]!.text).toBe('عنوان الخبر');
  });
});
