export const NAME_MAX_LENGTH = 24;

export type NameCheck = { ok: true; value: string } | { ok: false; value: string; error: string };

/** NFC, collapse runs of whitespace, trim. */
export function normalizeName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Length in user-perceived characters (grapheme clusters), so "é" or "நா" count as one where they should. */
export function nameLength(value: string): number {
  const Segmenter = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    let n = 0;
    for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) n++;
    return n;
  }
  return Array.from(value).length;
}

/**
 * Letters and combining marks from any script, digits, spaces and the punctuation
 * that appears in real names: apostrophes, hyphens, full stops, commas, brackets and
 * "/" (as in Malaysian "a/l", "a/p"). ZWJ/ZWNJ are allowed for Indic scripts.
 * Emoji, symbols and control characters are rejected.
 */
const ALLOWED = /^[\p{L}\p{M}\p{N} '’.,\-/()‌‍]+$/u;

export function validateName(raw: string): NameCheck {
  const value = normalizeName(raw);
  if (!value) return { ok: false, value, error: 'Please enter a name.' };
  const length = nameLength(value);
  if (length > NAME_MAX_LENGTH) {
    return { ok: false, value, error: `Names can be at most ${NAME_MAX_LENGTH} characters (this one has ${length}).` };
  }
  if (!ALLOWED.test(value)) {
    return { ok: false, value, error: "Use letters, numbers, spaces and . , ' - / ( ) only." };
  }
  if (!/\p{L}/u.test(value)) return { ok: false, value, error: 'A name needs at least one letter.' };
  return { ok: true, value };
}
