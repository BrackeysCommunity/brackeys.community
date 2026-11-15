import {
  BitmapText,
  Container,
  type Renderer,
  RendererType,
  Text,
  type TextStyleOptions,
} from "pixi.js";

import type { TextFont, TextVisual } from "../context";
import { richSource } from "../game/behaviors/text";
import { RTL_CHAR } from "../project/kinds/strings";
import type { Sha256 } from "../project/types";
import { readFlag } from "../reduced-motion";
import { parseRichText, type RichLine, type RichSpan } from "../text/rich";
import { keyedText, type StringTableData, type TextDirection } from "../text/strings";

/** Where text finds its loaded faces: the asset loader is one. */
export type FontSource = {
  /**
   * The installed `BitmapText` family of the BMFont whose `.fnt` hashes to
   * `hash`, drawn from `pages` (page texture hashes, in page order),
   * installed once; null until the font and all its pages have loaded.
   */
  bitmapFamily(hash: Sha256, pages: readonly Sha256[]): string | null;
  /** The CSS family a loaded web font was registered under, by its content hash or asset id; null until it loads. */
  webFamily(ref: string): string | null;
  /** Fires with each hash as it loads; returns unsubscribe. */
  onLoad(cb: (hash: Sha256) => void): () => void;
};

/** The face text draws in while its own font loads, and where it has none. */
export const DEFAULT_TEXT_FACE = ["system-ui", "sans-serif"];

export type RichTextOptions = {
  /** The locale's table: what a `key` text resolves through and a fontless text's face; null shows keys bracketed. */
  table?: StringTableData | null;
  /** True holds `shake` and `wave` still. */
  reducedMotion?: boolean | (() => boolean);
};

/** A text visual's lines, face and direction once its key, if any, is resolved through `table`. */
export function resolveText(
  visual: TextVisual,
  table: StringTableData | null,
): { lines: readonly RichLine[]; font: TextFont | null; direction: TextDirection } {
  const font = visual.font ?? table?.font ?? null;
  if ("lines" in visual) return { lines: visual.lines, font, direction: visual.direction };
  const source = keyedText(table?.strings, visual.key);
  return {
    lines: parseRichText(richSource(source, visual.rich === true), visual.vars).lines,
    font,
    direction: table?.direction ?? visual.direction,
  };
}

const LTR_CHAR = /[\p{L}\p{N}]/u;

type Strong = "ltr" | "rtl" | null;

function strongOf(text: string): Strong {
  let rtl = false;
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) rtl = true;
    else if (LTR_CHAR.test(ch)) return "ltr";
  }
  return rtl ? "rtl" : null;
}

/**
 * `text` with each pure right-to-left run in visual order: a run starts and
 * ends with a right-to-left character and holds only those and neutrals
 * (spaces, punctuation), and is reversed by code point. No shaping, so
 * joined scripts such as Arabic need a web font.
 */
export function reverseRtlRuns(text: string): string {
  const chars = Array.from(text);
  let out = "";
  let i = 0;
  while (i < chars.length) {
    if (!RTL_CHAR.test(chars[i]!)) {
      out += chars[i++];
      continue;
    }
    let end = i;
    for (let j = i + 1; j < chars.length; j++) {
      const ch = chars[j]!;
      if (RTL_CHAR.test(ch)) end = j;
      else if (LTR_CHAR.test(ch)) break;
    }
    out += chars
      .slice(i, end + 1)
      .reverse()
      .join("");
    i = end + 1;
  }
  return out;
}

/**
 * Visual order for a line's pieces: in a left-to-right line each run of
 * right-to-left pieces reverses; in a right-to-left line the whole line
 * does, and its left-to-right runs turn back. A neutral piece takes its
 * neighbours' direction when they agree, else the line's.
 */
export function visualOrder<T>(
  pieces: readonly T[],
  strong: (piece: T) => Strong,
  direction: TextDirection,
): T[] {
  const dirs = pieces.map(strong);
  const resolved = dirs.map((d, i) => {
    if (d) return d;
    let before: Strong = null;
    for (let j = i - 1; j >= 0 && !before; j--) before = dirs[j]!;
    let after: Strong = null;
    for (let j = i + 1; j < dirs.length && !after; j++) after = dirs[j]!;
    return before && before === after ? before : direction;
  });
  const flip = direction === "rtl" ? "ltr" : "rtl";
  const order = pieces.map((_, i) => i);
  if (direction === "rtl") order.reverse();
  const out: T[] = [];
  let run: number[] = [];
  const flush = () => {
    out.push(...run.reverse().map((i) => pieces[i]!));
    run = [];
  };
  for (const i of order) {
    if (resolved[i] === flip) {
      run.push(i);
      continue;
    }
    flush();
    out.push(pieces[i]!);
  }
  flush();
  return out;
}

/** How a span draws: an installed bitmap family, or CSS families in order. */
type Face = { kind: "bitmap"; family: string } | { kind: "web"; families: readonly string[] };

const DEFAULT_FACE: Face = { kind: "web", families: DEFAULT_TEXT_FACE };
const LINE_HEIGHT = 1.2;
const EMBED_RTL = String.fromCharCode(0x202b);
const POP_EMBED = String.fromCharCode(0x202c);

/** The face `font` draws in now, and whether it may still change as fonts load. */
function faceOf(
  font: TextFont | null,
  fonts: FontSource | null,
  canvas: boolean,
): { face: Face; waiting: boolean } {
  if (!font) return { face: DEFAULT_FACE, waiting: false };
  if (font.kind === "bitmap") {
    if (font.meta.distanceField && canvas) return { face: DEFAULT_FACE, waiting: false };
    const family = fonts?.bitmapFamily(font.hash, font.pages) ?? null;
    return family
      ? { face: { kind: "bitmap", family }, waiting: false }
      : { face: DEFAULT_FACE, waiting: fonts !== null };
  }
  const family = fonts?.webFamily(font.family) ?? null;
  if (family)
    return { face: { kind: "web", families: [family, ...DEFAULT_TEXT_FACE] }, waiting: false };
  return {
    face: { kind: "web", families: [font.family, ...DEFAULT_TEXT_FACE] },
    waiting: fonts !== null,
  };
}

type Piece = { span: RichSpan; text: string; space: boolean };
type Placed = { piece: Piece; display: Container | null; width: number; height: number };

/** A display for one run of text in `face`; RTL bitmap runs arrive already reversed. */
function textDisplay(
  text: string,
  span: RichSpan,
  face: Face,
  visual: TextVisual,
  direction: TextDirection,
  dx = 0,
  dy = 0,
  fill = span.color ?? visual.color,
): Container {
  const fontSize = span.size ?? visual.size;
  let display: Container;
  if (face.kind === "bitmap") {
    display = new BitmapText({ text, style: { fontFamily: face.family, fontSize, fill } });
  } else {
    const style: TextStyleOptions = {
      fontFamily: [...face.families],
      fontSize,
      fill,
      fontWeight: span.bold ? "bold" : "normal",
      fontStyle: span.italic ? "italic" : "normal",
      ...(visual.outline ? { stroke: { ...visual.outline } } : {}),
    };
    // Pixi's Text takes no direction: the embedding sets the canvas's base direction for the run.
    display = new Text({
      text: direction === "rtl" ? `${EMBED_RTL}${text}${POP_EMBED}` : text,
      style,
    });
  }
  display.position.set(dx, dy);
  return display;
}

/** Eight copies in the outline's colour behind the text: a bitmap face has no stroke of its own. */
function outlined(text: string, span: RichSpan, face: Face, visual: TextVisual): Container {
  const holder = new Container();
  const outline = visual.outline!;
  const w = outline.width;
  for (const [x, y] of [
    [-w, -w],
    [0, -w],
    [w, -w],
    [-w, 0],
    [w, 0],
    [-w, w],
    [0, w],
    [w, w],
  ] as const)
    holder.addChild(textDisplay(text, span, face, visual, "ltr", x, y, outline.color));
  holder.addChild(textDisplay(text, span, face, visual, "ltr"));
  return holder;
}

/** Per-glyph displays animated each rendered frame: a wave rolls along the run, a shake jitters each glyph. */
function animated(
  text: string,
  span: RichSpan,
  face: Face,
  visual: TextVisual,
  direction: TextDirection,
  reducedMotion: RichTextOptions["reducedMotion"],
): Container {
  const holder = new Container();
  const glyphs: Container[] = [];
  let x = 0;
  const chars = Array.from(text);
  // A bitmap run arrives reversed; a web run is in logical order, so its glyphs go right to left.
  if (face.kind === "web" && strongOf(text) === "rtl") chars.reverse();
  for (const ch of chars) {
    const glyph = draw(ch, span, face, visual, direction);
    glyph.position.x = x;
    x += glyph.width;
    holder.addChild(glyph);
    glyphs.push(glyph);
  }
  const amp = (span.size ?? visual.size) * (span.effect === "wave" ? 0.12 : 0.06);
  holder.onRender = () => {
    const still = readFlag(reducedMotion);
    const t = performance.now() / 1000;
    glyphs.forEach((glyph, i) => {
      if (still) glyph.position.y = 0;
      else if (span.effect === "wave") glyph.position.y = Math.sin(t * 6 - i * 0.6) * amp;
      else glyph.position.y = Math.sin(t * 47 + i * 12.9898) * Math.sin(t * 31 + i * 78.233) * amp;
    });
  };
  return holder;
}

function draw(
  text: string,
  span: RichSpan,
  face: Face,
  visual: TextVisual,
  direction: TextDirection,
): Container {
  if (face.kind === "bitmap" && visual.outline) return outlined(text, span, face, visual);
  return textDisplay(text, span, face, visual, direction);
}

/** A line's pieces: whole spans, or words and the spaces between them when the text wraps. */
function piecesOf(line: RichLine, wrap: boolean): Piece[] {
  const pieces: Piece[] = [];
  for (const span of line) {
    if (span.icon) {
      pieces.push({ span, text: "", space: false });
      continue;
    }
    const parts = wrap ? span.text.split(/(\s+)/).filter((p) => p !== "") : [span.text];
    for (const text of parts) pieces.push({ span, text, space: wrap && /^\s+$/.test(text) });
  }
  return pieces;
}

/** Lays `visual` out into `root`, replacing what it held. */
function build(
  root: Container,
  visual: TextVisual,
  lines: readonly RichLine[],
  face: Face,
  direction: TextDirection,
  reducedMotion: RichTextOptions["reducedMotion"],
): void {
  for (const child of root.removeChildren()) child.destroy({ children: true });
  const wrap = visual.wrap;
  const rows: Placed[][] = [];
  for (const line of lines) {
    let row: Placed[] = [];
    let x = 0;
    let wrapped = false;
    rows.push(row);
    for (const piece of piecesOf(line, wrap !== undefined)) {
      const px = piece.span.size ?? visual.size;
      if (piece.space && wrapped && row.length === 0) continue;
      let display: Container | null = null;
      let width = px;
      if (!piece.span.icon) {
        const text = face.kind === "bitmap" ? reverseRtlRuns(piece.text) : piece.text;
        display = piece.span.effect
          ? animated(text, piece.span, face, visual, direction, reducedMotion)
          : draw(text, piece.span, face, visual, direction);
        width = display.width;
      }
      if (wrap !== undefined && !piece.space && x > 0 && x + width > wrap) {
        while (row.length > 0 && row[row.length - 1]!.piece.space) {
          row.pop()!.display?.destroy({ children: true });
        }
        row = [];
        rows.push(row);
        x = 0;
        wrapped = true;
      }
      row.push({ piece, display, width, height: display?.height || px * LINE_HEIGHT });
      x += width;
    }
  }

  const widths = rows.map((row) => row.reduce((w, p) => w + p.width, 0));
  const boxWidth = Math.max(0, ...widths);
  const align = { left: 0, center: 0.5, right: 1 }[visual.align];
  let y = 0;
  rows.forEach((row, r) => {
    const height = Math.max(visual.size * LINE_HEIGHT, ...row.map((p) => p.height));
    let x = (boxWidth - widths[r]!) * align;
    for (const placed of visualOrder(row, (p) => strongOf(p.piece.text), direction)) {
      if (placed.display) {
        placed.display.position.x += x;
        placed.display.position.y += y + (height - placed.height);
        root.addChild(placed.display);
      }
      x += placed.width;
    }
    y += height;
  });
  root.pivot.set(boxWidth * visual.anchor[0], y * visual.anchor[1]);
}

/**
 * World-space text as Pixi draws it, in world px: a BMFont through
 * `BitmapText` (its distance field when the font has one, the default face
 * under the Canvas2D renderer, which can't draw one), a web font through
 * `Text`. Until its font loads it draws in the default face, and it redraws
 * itself when the font arrives. Destroying the container lets go of the
 * font source.
 */
export function createRichText(
  visual: TextVisual,
  fonts: FontSource | null,
  opts: RichTextOptions = {},
): Container {
  const root = new Container();
  const { lines, font, direction } = resolveText(visual, opts.table ?? null);
  let canvas = false;
  let unsubscribe: (() => void) | null = null;

  /** What the last layout drew: destroying the root removes its children before it says so. */
  let drawn: Container[] = [];

  const layout = (): void => {
    const { face, waiting } = faceOf(font, fonts, canvas);
    build(root, visual, lines, face, direction, opts.reducedMotion);
    drawn = [...root.children];
    if (waiting && !unsubscribe && fonts) unsubscribe = fonts.onLoad(() => layout());
    else if (!waiting && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
  layout();

  if (font?.kind === "bitmap" && font.meta.distanceField) {
    root.onRender = (renderer: Renderer) => {
      root.onRender = null;
      if (renderer.type !== RendererType.CANVAS) return;
      canvas = true;
      layout();
    };
  }
  root.once("destroyed", () => {
    unsubscribe?.();
    unsubscribe = null;
    for (const child of drawn) if (!child.destroyed) child.destroy({ children: true });
    drawn = [];
  });
  return root;
}
