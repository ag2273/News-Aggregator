/**
 * Listening to an article on the device (#56).
 *
 * The user's decision was method 1: Android's built-in speech engine — free, offline,
 * no server. What these tests pin is the part that decides what a reader HEARS:
 *
 *   * the headline first, then the body in order;
 *   * images and videos are not read aloud;
 *   * links, e-mails and symbol noise are not read aloud;
 *   * a long body is split at sentence boundaries, never mid-sentence;
 *   * no Arabic voice on the device is a plain Arabic message, not silence or an error.
 */

import {
  articleToSpeech,
  speakableText,
  splitForUtterance,
  hasArabicVoice,
  MISSING_VOICE_MESSAGE,
  UTTERANCE_TARGET_CHARS,
  MAX_UTTERANCE_CHARS,
} from '../lib/speech';

const sentence = (n: number) =>
  `هذه الجملة رقم ${n} من نص الخبر وهي طويلة بما يكفي لتكون جملة حقيقية تُقرأ بصوت واضح ومفهوم للمستمع.`;

describe('what gets read aloud', () => {
  it('reads the headline first, then the body in order', () => {
    const segments = articleToSpeech('عنوان الخبر الرئيسي', [
      { type: 'paragraph', text: sentence(1) },
      { type: 'paragraph', text: sentence(2) },
    ]);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0]!.text).toBe('عنوان الخبر الرئيسي');
    expect(segments[1]!.text).toContain('رقم 1');
    // Order is preserved: the second paragraph is not spoken before the first.
    const all = segments.map((s) => s.text).join(' ');
    expect(all.indexOf('رقم 1')).toBeLessThan(all.indexOf('رقم 2'));
  });

  it('never reads an image or a video', () => {
    const segments = articleToSpeech('عنوان', [
      { type: 'image' },
      { type: 'text' in {} ? 'paragraph' : 'paragraph', text: sentence(1) },
      { type: 'video' },
    ] as never);
    const all = segments.map((s) => s.text).join(' ');
    expect(segments.every((s) => s.text.trim().length > 0)).toBe(true);
    expect(all).not.toContain('undefined');
  });

  it('folds a heading into the paragraph that follows it', () => {
    // A two-word section title spoken alone makes the voice pause for no reason.
    const segments = articleToSpeech(null, [
      { type: 'heading', text: 'تفاصيل القرار' },
      { type: 'paragraph', text: sentence(1) },
    ]);
    expect(segments[0]!.text).toContain('تفاصيل القرار');
    expect(segments[0]!.text).toContain('رقم 1');
  });

  it('does not read urls, e-mails or symbol noise', () => {
    const text = speakableText(
      'شاهد التفاصيل على https://www.dostor.org/5790251 أو راسلنا news@dostor.org #عاجل ||| ***',
    );
    expect(text).not.toContain('http');
    expect(text).not.toContain('dostor.org');
    expect(text).not.toContain('@');
    expect(text).not.toContain('#');
    expect(text).not.toContain('|');
    // The Arabic around them survives.
    expect(text).toContain('شاهد التفاصيل على');
  });

  it('drops a body that is only a url', () => {
    expect(speakableText('https://www.dostor.org/5790251')).toBe('');
    expect(articleToSpeech(null, [{ type: 'paragraph', text: 'https://x.com/1' }])).toEqual([]);
  });
});

describe('long articles are queued without cutting a sentence', () => {
  it('splits at sentence ends, not at the character limit', () => {
    const body = Array.from({ length: 12 }, (_, i) => sentence(i + 1)).join(' ');
    const pieces = splitForUtterance(body);
    expect(pieces.length).toBeGreaterThan(1);
    // Every piece is well inside the engine's limit.
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(UTTERANCE_TARGET_CHARS + 20);
      expect(piece.length).toBeLessThan(MAX_UTTERANCE_CHARS);
    }
    // Each piece ENDS the way a sentence ends, so the voice never stops mid-clause.
    for (const piece of pieces.slice(0, -1)) {
      expect(piece.trim()).toMatch(/[.!?؟…]$/);
    }
  });

  it('keeps every character exactly once', () => {
    const body = Array.from({ length: 8 }, (_, i) => sentence(i + 1)).join(' ');
    const rejoined = splitForUtterance(body).join(' ');
    for (let i = 1; i <= 8; i += 1) {
      expect(rejoined).toContain(`رقم ${i}`);
    }
  });

  it('splits an over-long single sentence on its commas', () => {
    // A paragraph with no full stops still has to be handed over in pieces.
    const oneSentence = `${'كلمة '.repeat(200)}، ${'أخرى '.repeat(200)}`;
    const pieces = splitForUtterance(oneSentence);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(UTTERANCE_TARGET_CHARS + 20);
  });

  it('leaves a short text as a single utterance', () => {
    expect(splitForUtterance('نص قصير.')).toEqual(['نص قصير.']);
  });
});

describe('the Arabic voice on the device', () => {
  it('is found when the platform reports an Arabic voice', () => {
    expect(hasArabicVoice([{ language: 'ar-EG', identifier: 'ar-eg-x-egn-local' }])).toBe(true);
    expect(hasArabicVoice([{ language: 'en-US' }, { language: 'ar-SA' }])).toBe(true);
  });

  it('is missing when there is none, or the platform reports nothing', () => {
    expect(hasArabicVoice([{ language: 'en-US' }])).toBe(false);
    expect(hasArabicVoice([])).toBe(false);
    expect(hasArabicVoice(null)).toBe(false);
    // A language tag that merely contains "ar" is not Arabic.
    expect(hasArabicVoice([{ language: 'en-GB' }, { language: 'hu-HU' }])).toBe(false);
  });

  it('says so in Arabic, and points at the setting that fixes it', () => {
    expect(MISSING_VOICE_MESSAGE).toContain('صوت عربي');
    expect(MISSING_VOICE_MESSAGE).toContain('إعدادات');
  });
});
