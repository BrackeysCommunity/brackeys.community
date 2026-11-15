import { measureText, parseRichText, plainText } from "@jams/engine/game";
import type { FontMeta } from "@jams/engine/project";

/** A 5×7 pixel face as `assets import` records a BMFont: every glyph 6 px wide at size 10. */
const pixelFace: FontMeta = {
  format: "bmfont",
  size: 10,
  lineHeight: 12,
  advances: Object.fromEntries(
    [..."Shop open, coins!0123456789"].map((c) => [c.codePointAt(0)!, 6]),
  ),
};

/** Parses a shop sign's markup, and measures it in the pixel face and with no face at all. */
export function shopSign() {
  const source = "[b]Shop[/b] open\n[color=#ffd24a]{coins}[/color] coins [wave]![/wave]";
  const { lines, warnings } = parseRichText(source, { coins: 12 });
  return {
    spans: lines.map((line) => line.map((s) => s.text)),
    bold: lines[0]?.[0]?.bold === true,
    gold: lines[1]?.[0]?.color,
    plain: plainText(source, { coins: 12 }),
    warnings,
    unknown: parseRichText("[blink]Sale[/blink]").warnings.length,
    // Exact from the face's advances at its own size, and scaled at size 20.
    pixel: measureText(lines, pixelFace, 10),
    big: measureText(lines, pixelFace, 20),
    // A web font, or no font, is an estimate.
    estimated: !measureText(lines, null, 10).exact,
    wrapped: measureText(parseRichText("Shop open coins").lines, pixelFace, 10, 60).height,
  };
}
