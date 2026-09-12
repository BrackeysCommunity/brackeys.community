import { marked, type Tokens } from "marked";

import { clipPlainText, htmlToParagraphs } from "@/lib/html-text";

type AnyToken = Tokens.Generic;

/**
 * Plain-text reduction of a markdown body, for `<meta>` descriptions and
 * OG card subtitles. The lexer is the same one `MarkedText` renders from,
 * so what survives here is what a reader sees: heading marks, emphasis,
 * link targets and code fences go; the words stay. Raw HTML is reduced
 * through `htmlToParagraphs` rather than dropped, for rows written before
 * the field was markdown.
 */
export function markdownToParagraphs(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  const out: string[] = [];
  for (const token of marked.lexer(markdown) as AnyToken[]) {
    const text = blockText(token);
    if (text) out.push(text);
  }
  return out;
}

export function markdownToPlainText(
  markdown: string | null | undefined,
  maxLength = 200,
): string | undefined {
  return clipPlainText(markdownToParagraphs(markdown).join(" "), maxLength);
}

function blockText(token: AnyToken): string | null {
  switch (token.type) {
    case "space":
    case "hr":
      return null;
    case "code":
      return null;
    case "html":
      return htmlToParagraphs((token as Tokens.HTML).text).join(" ") || null;
    case "list":
      return (
        (token as Tokens.List).items
          .map((item) => inlineText(item.tokens as AnyToken[]))
          .filter(Boolean)
          .join(" ") || null
      );
    case "table": {
      const table = token as Tokens.Table;
      const cells = [
        ...table.header.map((cell) => inlineText(cell.tokens as AnyToken[])),
        ...table.rows.flatMap((row) => row.map((cell) => inlineText(cell.tokens as AnyToken[]))),
      ];
      return cells.filter(Boolean).join(" ") || null;
    }
    default:
      return inlineText((token.tokens as AnyToken[] | undefined) ?? []) || null;
  }
}

function inlineText(tokens: AnyToken[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case "text":
        case "escape":
          return token.tokens ? inlineText(token.tokens as AnyToken[]) : decode(token.text);
        case "codespan":
          return decode((token as Tokens.Codespan).text);
        case "image":
          return "";
        case "html":
          return htmlToParagraphs((token as Tokens.HTML).text).join(" ");
        case "br":
          return " ";
        default:
          return token.tokens ? inlineText(token.tokens as AnyToken[]) : "";
      }
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
