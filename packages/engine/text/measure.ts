import type { FontMeta } from "../project/kinds/font";
import type { RichLine } from "./rich";

/** Width per character, in ems, where no glyph metrics are known. */
const ESTIMATE_ADVANCE = 0.55;
/** Line height, in ems, where the font gives none. */
export const LINE_HEIGHT_EM = 1.2;
const SPACE = 0x20;

/** One run laid out on a line: its width, and the kerning against the item before it, which a line's first item drops. */
export type WrapItem = { space: boolean; width: number; kern?: number };

/** One glyph or icon laid out on a line. */
type Item = WrapItem & { kern: number; height: number };

/**
 * Exact for BMFont meta (advances, kerning), an estimate otherwise.
 *
 * `size` and `wrap` are px at zoom 1; a span's own `size` wins. A line's
 * width is its advances plus kerning. With `wrap`, lines break greedily at
 * spaces, the spaces at a break are dropped, and a word wider than `wrap`
 * overflows on a line of its own. A glyph the face lacks and an inline icon
 * are estimated (an icon as one em square), which makes the result inexact.
 */
export function measureText(
  lines: readonly RichLine[],
  font: FontMeta | null,
  size: number,
  wrap?: number,
): { width: number; height: number; exact: boolean } {
  const advances = font?.format === "bmfont" ? font.advances : undefined;
  const faceSize = font?.size ?? font?.lineHeight;
  const bitmap = advances !== undefined && faceSize !== undefined && faceSize > 0;
  let exact = bitmap;

  const kerning = new Map<number, number>();
  if (bitmap)
    for (const [first, second, amount] of font?.kerning ?? [])
      kerning.set(first * 0x110000 + second, amount);
  const lineHeightAt = (px: number): number =>
    bitmap ? ((font?.lineHeight ?? faceSize) * px) / faceSize : LINE_HEIGHT_EM * px;

  let width = 0;
  let height = 0;
  const addLine = (items: readonly Item[], from: number, to: number, base: number): void => {
    let w = 0;
    let h = from < to ? 0 : lineHeightAt(base);
    for (let k = from; k < to; k++) {
      const item = items[k]!;
      w += item.width + (k > from ? item.kern : 0);
      h = Math.max(h, item.height);
    }
    width = Math.max(width, w);
    height += h;
  };

  for (const line of lines) {
    const items: Item[] = [];
    let prev: { code: number; px: number } | null = null;
    for (const span of line) {
      const px = span.size ?? size;
      if (span.icon) {
        exact = false;
        items.push({ space: false, width: px, kern: 0, height: lineHeightAt(px) });
        prev = null;
        continue;
      }
      for (const char of span.text) {
        const code = char.codePointAt(0)!;
        const known = bitmap ? advances[String(code)] : undefined;
        if (known === undefined) exact = false;
        const scale = bitmap ? px / faceSize : 0;
        const kern =
          prev && prev.px === px ? (kerning.get(prev.code * 0x110000 + code) ?? 0) * scale : 0;
        items.push({
          space: code === SPACE,
          width: known === undefined ? ESTIMATE_ADVANCE * px : known * scale,
          kern,
          height: lineHeightAt(px),
        });
        prev = { code, px };
      }
    }
    if (wrap === undefined) {
      addLine(items, 0, items.length, size);
      continue;
    }
    breakLine(items, wrap, (from, to) => addLine(items, from, to, size));
  }
  return { width, height, exact };
}

/**
 * Greedy word wrap at spaces, the rule measured and drawn text share: the
 * spaces at a break are dropped and a word wider than `wrap` overflows on a
 * line of its own. Calls `emit` with each visual line's item range.
 */
export function breakLine(
  items: readonly WrapItem[],
  wrap: number,
  emit: (from: number, to: number) => void,
): void {
  let start = 0;
  let end = 0;
  let w = 0;
  let k = 0;
  while (k < items.length) {
    let wordFrom = k;
    while (wordFrom < items.length && items[wordFrom]!.space) wordFrom++;
    let wordTo = wordFrom;
    while (wordTo < items.length && !items[wordTo]!.space) wordTo++;
    let added = 0;
    for (let j = end; j < wordTo; j++)
      added += items[j]!.width + (j > start ? (items[j]!.kern ?? 0) : 0);
    if (end > start && w + added > wrap) {
      if (wordFrom === wordTo) break;
      emit(start, end);
      start = end = k = wordFrom;
      w = 0;
      continue;
    }
    w += added;
    end = k = wordTo;
  }
  emit(start, end);
}
