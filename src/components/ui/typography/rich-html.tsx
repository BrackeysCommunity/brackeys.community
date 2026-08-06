import DOMPurify from "dompurify";
import { useMemo } from "react";

import { useIsHydrated } from "@/lib/hooks/use-is-hydrated";
import { cn } from "@/lib/utils";

const PROSE_CLASSES = [
  "text-sm/relaxed text-foreground",
  "[&_em]:italic [&_strong]:font-bold",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-accent/80",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-card [&_pre]:p-3 [&_pre]:text-xs",
  "[&_pre_code]:border-none [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:mb-1",
  "[&_p]:mb-2 [&_p:last-child]:mb-0",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-bold",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-bold",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
  "[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded",
  "[&_iframe]:my-3 [&_iframe]:max-w-full",
].join(" ");

interface RichHtmlProps {
  /** Untrusted HTML — sanitized here, never by the caller. */
  html: string;
  className?: string;
}

/**
 * Renders a sanitized HTML string with the same typographic treatment as
 * `MarkedText`, so provider-supplied bodies (scraped jam descriptions)
 * read consistently with the markdown-driven surfaces elsewhere.
 *
 * Lives beside `MarkedText` rather than in the jams folder because the
 * jam detail modal and the jam detail page render the same `contentHtml`,
 * and a second copy of this class list is how those two would drift.
 * Sanitization is inside the component on purpose: there is no way to
 * pass unsanitized HTML through it.
 *
 * **Server render.** DOMPurify needs a real DOM — in Node the module
 * hands back a bare factory whose `sanitize` doesn't exist at all — so
 * the markup can only be sanitized on the client. The server (and the
 * first client render, which has to match it) gets the plain-text
 * reduction of the body instead, and the rich markup swaps in on mount.
 * That keeps the prose in the SSR payload for crawlers and no-JS readers
 * rather than shipping them an empty section, which is the whole point of
 * these pages being real routes.
 */
export function RichHtml({ html, className }: RichHtmlProps) {
  const canSanitize = useIsHydrated();

  const safe = useMemo(
    () => (canSanitize ? DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) : null),
    [canSanitize, html],
  );
  const paragraphs = useMemo(() => (safe == null ? htmlToParagraphs(html) : []), [safe, html]);

  if (safe == null) {
    return (
      <div className={cn(PROSE_CLASSES, className)}>
        {paragraphs.map((p, i) => (
          // Index keys: this list is a one-shot pre-hydration rendering of
          // an immutable string, never reordered.
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <p key={i}>{p}</p>
        ))}
      </div>
    );
  }

  return (
    <div className={cn(PROSE_CLASSES, className)} dangerouslySetInnerHTML={{ __html: safe }} />
  );
}

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
 * `<meta>` attribute), both of which escape. It exists because the two
 * places that need the prose without the markup (the server render above
 * and page meta descriptions) both run where DOMPurify can't.
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
