import { cssHex } from "../game/color";
import type { AssetId } from "../project/types";
import type { RichLine, RichSpan } from "../text/rich";
import type { UiContext } from "./types";

type AssetUrlContext = Pick<UiContext, "assetUrl">;

/**
 * Draws asset `id` (an atlas frame when `frame` is given) as `el`'s CSS
 * background: the frame's rect at its own pixel size, scaled to `fit` px on
 * its longer side when given (pixelated when that enlarges it), or a whole
 * image fitted into the box. False, and no background, when the host has no URL.
 */
export function setAssetBackground(
  el: HTMLElement,
  ctx: AssetUrlContext,
  id: AssetId,
  frame?: string,
  fit?: number,
): boolean {
  const found = ctx.assetUrl(id, frame);
  if (!found) {
    el.style.backgroundImage = "";
    return false;
  }
  el.style.backgroundImage = `url(${JSON.stringify(found.url)})`;
  el.style.backgroundRepeat = "no-repeat";
  const { rect } = found;
  if (rect) {
    Object.assign(el.style, {
      width: `${rect.w}px`,
      height: `${rect.h}px`,
      backgroundPosition: `${-rect.x}px ${-rect.y}px`,
      backgroundSize: "auto",
    });
    const scale = fit === undefined ? 1 : fit / Math.max(rect.w, rect.h, 1);
    if (scale !== 1) el.style.transform = `scale(${scale})`;
    if (scale > 1) el.style.imageRendering = "pixelated";
  } else {
    Object.assign(el.style, { backgroundPosition: "center", backgroundSize: "contain" });
  }
  return true;
}

/** Splits text into what a reader sees as one character each, so a typewriter never cuts a cluster. */
function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** How many typewriter steps `lines` take: one per character, one per icon. */
export function richTextLength(lines: readonly RichLine[]): number {
  let n = 0;
  for (const line of lines)
    for (const span of line) n += span.icon ? 1 : graphemes(span.text).length;
  return n;
}

function styledSpan(doc: Document, span: RichSpan): HTMLSpanElement {
  const el = doc.createElement("span");
  if (span.bold) el.style.fontWeight = "bold";
  if (span.italic) el.style.fontStyle = "italic";
  if (span.color !== undefined) el.style.color = cssHex(span.color);
  if (span.size !== undefined) el.style.fontSize = `${span.size}px`;
  // A stylesheet may animate these; the engine draws them still.
  if (span.effect) el.dataset.jamsEffect = span.effect;
  return el;
}

function iconSpan(doc: Document, icon: NonNullable<RichSpan["icon"]>, ctx: AssetUrlContext) {
  const el = doc.createElement("span");
  el.dataset.jamsIcon = `${icon.asset}:${icon.frame}`;
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    display: "inline-block",
    width: "1em",
    height: "1em",
    verticalAlign: "middle",
  });
  setAssetBackground(el, ctx, icon.asset, icon.frame);
  return el;
}

/**
 * `renderRichText`, showing only the first `shown` characters (icons count
 * one): the rest keeps its place but is hidden, so the line never reflows
 * as it types.
 */
export function renderRichTextPartly(
  el: HTMLElement,
  lines: readonly RichLine[],
  ctx: AssetUrlContext,
  shown: number,
): void {
  const doc = el.ownerDocument;
  const nodes: Node[] = [];
  let left = shown;
  const hide = (node: HTMLElement) => {
    node.style.visibility = "hidden";
    return node;
  };
  lines.forEach((line, i) => {
    if (i > 0) nodes.push(doc.createElement("br"));
    for (const span of line) {
      const styled = styledSpan(doc, span);
      if (span.icon) {
        const icon = iconSpan(doc, span.icon, ctx);
        styled.append(left > 0 ? icon : hide(icon));
        left--;
      } else if (left === Infinity) {
        styled.textContent = span.text;
      } else {
        const chars = graphemes(span.text);
        const cut = Math.max(0, Math.min(chars.length, left));
        left -= chars.length;
        if (cut > 0) styled.append(chars.slice(0, cut).join(""));
        if (cut < chars.length) {
          const rest = hide(doc.createElement("span"));
          rest.textContent = chars.slice(cut).join("");
          styled.append(rest);
        }
      }
      nodes.push(styled);
    }
  });
  el.replaceChildren(...nodes);
}

/** Renders rich text as spans: bold, italic, colour, size, and icons as CSS backgrounds from `assetUrl`. */
export function renderRichText(
  el: HTMLElement,
  lines: readonly RichLine[],
  ctx: Pick<UiContext, "assetUrl">,
): void {
  renderRichTextPartly(el, lines, ctx, Infinity);
}
