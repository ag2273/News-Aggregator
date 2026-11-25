// Small text helpers for the on-device reader (#55).

/** Count Arabic letters, the only signal that a block is real prose. */
export function arabicLength(text: string): number {
  const m = text.match(/[\u0600-\u06FF]/g);
  return m ? m.length : 0;
}
