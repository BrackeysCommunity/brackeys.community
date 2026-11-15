import type { FontMeta } from "../project/kinds/font";
import type { RichLine } from "./rich";

/** Width per character, in ems, where no glyph metrics are known. */
const ESTIMATE_ADVANCE = 0.55;
/** Line height, in ems, where the font gives none. */
const ESTIMATE_LINE_HEIGHT = 1.2;
const SPACE = 0x20;

/** The BMFont fields measuring reads: `advances` keyed by decimal code point, at the face's `size`. */
type Metrics = FontMeta & {
  size?: number;
  advances?: Readonly<Record<string, number>>;
  kerning?: readonly (readonly [first: number, second: number, amount: number])[];
};

/** One glyph or icon laid out on a line: its advance, and the kerning against the item before it. */
type Item = { space: boolean; advance: number; kern: number; height: number };

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
  const metrics: Metrics | null = font;
  const advances = metrics?.format === "bmfont" ? metrics.advances : undefined;
  const faceSize = metrics?.size ?? metrics?.lineHeight;
  const bitmap = advances !== undefined && faceSize !== undefined && faceSize > 0;
  let exact = bitmap;

  const kerning = new Map<number, number>();
  if (bitmap)
    for (const [first, second, amount] of metrics?.kerning ?? [])
      kerning.set(first * 0x110000 + second, amount);
  const lineHeightAt = (px: number): number =>
    bitmap ? ((metrics?.lineHeight ?? faceSize) * px) / faceSize : ESTIMATE_LINE_HEIGHT * px;

  let width = 0;
  let height = 0;
  const addLine = (items: readonly Item[], from: number, to: number, base: number): void => {
    let w = 0;
    let h = from < to ? 0 : lineHeightAt(base);
    for (let k = from; k < to; k++) {
      const item = items[k]!;
      w += item.advance + (k > from ? item.kern : 0);
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
        items.push({ space: false, advance: px, kern: 0, height: lineHeightAt(px) });
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
          advance: known === undefined ? ESTIMATE_ADVANCE * px : known * scale,
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

/** Greedy word wrap at spaces: calls `emit` with each visual line's item range. */
function breakLine(
  items: readonly Item[],
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
      added += items[j]!.advance + (j > start ? items[j]!.kern : 0);
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
