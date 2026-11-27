// Turning an article into speakable utterances (#56).
//
// WHY THIS IS A MODULE AND NOT INSIDE THE COMPONENT
// ------------------------------------------------
// The rules here decide what the reader HEARS, and every one of them is a judgement
// call worth pinning in a test: the headline comes first, headings are spoken with
// their section, images are skipped, links and symbols are not read aloud, and a long
// body is split at sentence boundaries so the engine never cuts mid-sentence.
//
// The engine is Android's own text-to-speech (expo-speech), which is free and works
// offline once the Arabic voice is on the device. It has a hard input limit — 4000
// characters on Android — so the article is queued as several utterances and the
// engine plays them back to back.

/** The engine's stated limit on Android (`TextToSpeech.getMaxSpeechInputLength()`). */
export const MAX_UTTERANCE_CHARS = 4000;

/**
 * The size this app actually uses.
 *
 * Well under the engine's limit on purpose: a 4000-character utterance gives the
 * reader no natural pause at a paragraph break, and some engines mispronounce the
 * tail of a very long string. ~300 characters is two or three sentences, which is
 * where a news sentence lands.
 */
export const UTTERANCE_TARGET_CHARS = 300;

/** A piece of the article to speak, in order. */
export interface SpeechSegment {
  text: string;
}

/**
 * Remove what must never be read aloud.
 *
 * Measured on these outlets' reader blocks: a body can carry bare URLs, e-mail
 * addresses, the outlet's own "listen to the article" note repeated from the page,
 * and figure captions like "شعار شركة …" that are labels rather than prose. Reading
 * those aloud is what makes an article sound broken.
 */
export function speakableText(input: string): string {
  return input
    // URLs and bare domains: read as gibberish letter by letter.
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    // E-mail addresses.
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
    // Hashtags and handles.
    .replace(/[#@][\w\u0600-\u06FF_]+/g, ' ')
    // A run of symbols or Latin digits is not Arabic prose; keep the numbers but drop
    // the punctuation noise around them.
    .replace(/[|_=*<>{}[\]\\/^~`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split one long text into utterance-sized pieces WITHOUT cutting a sentence.
 *
 * Sentences are found on Arabic and Latin terminators, then packed greedily up to
 * `UTTERANCE_TARGET_CHARS`. A single sentence longer than that is split on commas, and
 * only a clause still too long after that is cut at the target — the last resort,
 * because a cut mid-clause is audible.
 */
export function splitForUtterance(
  text: string,
  target: number = UTTERANCE_TARGET_CHARS,
): string[] {
  const clean = speakableText(text);
  if (!clean) return [];
  if (clean.length <= target) return [clean];

  const sentences = clean
    .split(/(?<=[.!?؟\u06D4…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) out.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > target) {
      push();
      // Too long for one utterance even alone: break on commas first.
      for (const clause of sentence.split(/[،,;؛]\s*/)) {
        const piece = clause.trim();
        if (!piece) continue;
        if (piece.length > target) {
          push();
          for (let i = 0; i < piece.length; i += target) {
            out.push(piece.slice(i, i + target).trim());
          }
        } else if (current.length + piece.length + 2 > target) {
          push();
          current = piece;
        } else {
          current = current ? `${current}، ${piece}` : piece;
        }
      }
      continue;
    }
    if (current.length + sentence.length + 1 > target) {
      push();
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  push();
  return out.filter(Boolean);
}

/** The blocks the app has already extracted, without their markup. */
export interface SpeakableBlock {
  type: 'heading' | 'paragraph' | 'image' | 'video';
  text?: string;
}

/**
 * The whole article as ordered utterances: headline, then the body.
 *
 * The headline is spoken first because it is what the reader tapped to listen to.
 * A heading is folded into the following paragraph so the voice does not pause on a
 * two-word section title. Images and videos are skipped — there is nothing to say.
 */
export function articleToSpeech(
  title: string | null,
  blocks: SpeakableBlock[],
): SpeechSegment[] {
  const parts: string[] = [];

  const headline = title ? speakableText(title) : '';
  if (headline) parts.push(headline);

  let pendingHeading = '';
  for (const block of blocks) {
    if (block.type === 'image' || block.type === 'video') continue;
    const text = block.text ? speakableText(block.text) : '';
    if (!text) continue;
    if (block.type === 'heading') {
      // Held until a paragraph arrives; a trailing heading alone is still spoken.
      pendingHeading = pendingHeading ? `${pendingHeading}. ${text}` : text;
      continue;
    }
    parts.push(pendingHeading ? `${pendingHeading}. ${text}` : text);
    pendingHeading = '';
  }
  if (pendingHeading) parts.push(pendingHeading);

  return parts.flatMap((part) => splitForUtterance(part)).map((text) => ({ text }));
}

/**
 * The language tag handed to the engine: the bare language, never `ar-EG`.
 *
 * expo-speech on Android builds the locale with `Locale.Builder().setLanguage(tag)`,
 * which only accepts a language subtag. `ar-EG` throws there, the module swallows the
 * error and falls back to the PHONE's default language, so on a phone set to English the
 * Arabic article went to an English voice and came out as silence or noise. The region
 * is chosen through the voice instead (`pickArabicVoice`).
 */
export const ENGINE_LANGUAGE = 'ar';

/** One entry of the engine's voice list, as expo-speech reports it. */
export interface VoiceLike {
  identifier?: string;
  language?: string | null;
  quality?: string | null;
}

/**
 * The Arabic voice to speak with: Egyptian when the phone has it, then any Arabic.
 *
 * Naming the voice is what makes the engine read Arabic regardless of the phone's own
 * language. Among equals an installed ("local") voice beats a network one, because a
 * network voice is silent on a weak connection.
 */
export function pickArabicVoice(
  voices: VoiceLike[] | null | undefined,
  preferred: string = 'ar-EG',
): VoiceLike | null {
  const arabic = (voices ?? []).filter((v) => /^ar\b/i.test((v.language ?? '').trim()) && v.identifier);
  if (arabic.length === 0) return null;
  const score = (v: VoiceLike) => {
    const lang = (v.language ?? '').trim().toLowerCase().replace('_', '-');
    const id = (v.identifier ?? '').toLowerCase();
    let s = 0;
    if (lang === preferred.toLowerCase()) s += 4;
    if (/network/.test(id)) s -= 2;
    if (/local/.test(id)) s += 1;
    if ((v.quality ?? '').toLowerCase() === 'enhanced') s += 1;
    return s;
  };
  return [...arabic].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Is a voice for Arabic actually installed on this device? */
export function hasArabicVoice(
  voices: { language?: string | null; identifier?: string }[] | null | undefined,
): boolean {
  if (!voices || voices.length === 0) return false;
  return voices.some((voice) => /^ar\b/i.test((voice.language ?? '').trim()));
}

/** The Arabic message a reader gets when the voice is missing. Never an error page. */
/** The engine took the article but never started talking. */
export const SILENT_ENGINE_MESSAGE =
  'الصوت ما اشتغلش. اضغط استماع تاني، ولو فضل ساكت اقفل التطبيق وافتحه.';

export const MISSING_VOICE_MESSAGE =
  'مفيش صوت عربي منزّل على الجهاز. نزّله من إعدادات النطق في الجهاز، وبعدها اضغط استماع تاني.';
