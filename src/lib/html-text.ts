/** Elements whose *contents* are not prose and must not survive the
 * text reduction — a regex tag-strip would otherwise turn a script body
 * into visible copy. */
const NON_PROSE_ELEMENTS = /<(script|style|noscript|template|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Tags that end a line of prose. Everything else is inline. */
const BLOCK_BOUNDARY = /<\/?(p|div|br|li|ul|ol|tr|h[1-6]|blockquote|pre|section|article)\b[^>]*>/gi;

/** Stands in for a block boundary while the tags are being stripped. A
 * control character can't occur in scraped prose. */
const PARAGRAPH_SENTINEL = "\u0000";

const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/g, " "],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#0?39;|&apos;/g, "'"],
  [/&#x27;/gi, "'"],
  // Ampersand last: decoding it first would let `&amp;lt;` become `<`.
  [/&amp;/g, "&"],
];

/**
 * Paragraph-preserving plain-text reduction of an HTML body.
 *
 * Not a sanitizer — the output is rendered as React text children (or a
 * `<meta>` attribute), both of which escape. It exists because the places
 * that need the prose without the markup (RichHtml's server render and
 * page meta descriptions) run where DOMPurify can't.
 */
export function htmlToParagraphs(html: string | null | undefined): string[] {
  if (!html) return [];
  return (
    html
      .replace(NON_PROSE_ELEMENTS, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // A sentinel rather than "\n": raw newlines in the source are just
      // whitespace in HTML (scraped bodies are full of source indentation),
      // so splitting on them would break a paragraph at every source line.
      .replace(BLOCK_BOUNDARY, PARAGRAPH_SENTINEL)
      .replace(/<[^>]*>/g, "")
      .split(PARAGRAPH_SENTINEL)
      .map((line) => {
        let out = line;
        for (const [pattern, replacement] of ENTITIES) out = out.replace(pattern, replacement);
        return out.replace(/\s+/g, " ").trim();
      })
      .filter((line) => line.length > 0)
  );
}

/**
 * One-line plain-text reduction, clipped to `maxLength` on a word
 * boundary. For `<meta name="description">` and OG tags.
 */
export function htmlToPlainText(
  html: string | null | undefined,
  maxLength = 200,
): string | undefined {
  const text = htmlToParagraphs(html).join(" ");
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  // Only break on a space if one falls reasonably close to the limit —
  // otherwise a long unbroken token would gut the description.
  const body = lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}…`;
}
