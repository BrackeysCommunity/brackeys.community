/**
 * What the card's fonts can actually draw. `ogFonts()` loads the latin
 * subsets of Rubik and JetBrains Mono, and Satori draws a box for every
 * code point outside them — a fullwidth-Latin display name came out as a
 * row of tofu. The ranges are Google Fonts' `latin` unicode-range.
 */
const LATIN_RANGES =
  "\\u0020-\\u00ff\\u0131\\u0152\\u0153\\u02bb\\u02bc\\u02c6\\u02da\\u02dc\\u0304\\u0308\\u0329" +
  "\\u2000-\\u206f\\u20ac\\u2122\\u2191\\u2193\\u2212\\u2215\\ufeff\\ufffd";

const DRAWABLE = new RegExp(`^[${LATIN_RANGES}]*$`, "u");
const UNDRAWABLE = new RegExp(`[^${LATIN_RANGES}]`, "gu");

/** NFKC folds fullwidth Latin (ＡＢＣ), ligatures and compatibility forms to what the font has. */
export function foldToLatin(text: string): string {
  return text.normalize("NFKC");
}

export function isDrawable(text: string): boolean {
  return DRAWABLE.test(text);
}

/**
 * A person's or team's name for a card: folded, and dropped when the fold
 * still leaves glyphs the font lacks. A card that omits a name reads
 * better than one full of boxes — and every caller has something to say
 * instead.
 */
export function ogName<F = null>(
  name: string | null | undefined,
  fallback: F = null as F,
): string | F {
  if (!name) return fallback;
  const folded = foldToLatin(name).replace(/\s+/g, " ").trim();
  return folded && isDrawable(folded) ? folded : fallback;
}

/**
 * Running text for a card: folded, with whatever is still undrawable
 * removed rather than boxed. An emoji in a tagline goes; the words stay.
 */
export function ogText(text: string): string {
  return foldToLatin(text).replace(UNDRAWABLE, "").replace(/\s+/g, " ").trim();
}
