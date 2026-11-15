/**
 * The `text` behavior's schema, and the rules its system, the views and the
 * schematic renders share: how a text reads its markup, the face it draws
 * in and where its box sits. Zod, game/, project/ and scene/ only: the
 * parsing and measuring live in `text/`. The system lives in
 * `runtime/behaviors/text.ts` and draws through the view's `text` member.
 */
import { z } from "zod";

import type { TextFont } from "../../context";
import { FONT_KIND, type FontMeta } from "../../project/kinds/font";
import { RTL_CHAR, STRING_KEY_PATTERN } from "../../project/kinds/strings";
import type { AssetId, Sha256 } from "../../project/types";
import type { ShapeObj } from "../../scene/types";
import type { TextDirection } from "../../text/strings";
import { defineBehavior, handleType } from "../behaviors";
import { rgbSchema } from "../color";
import { assetField } from "../fields";
import { escapeRich, type RichLine, type TextVars } from "../rich-text";
import type { FieldEnv } from "../types";

/** The font size, px at zoom 1, when a block gives none. */
export const TEXT_SIZE_DEFAULT = 16;
export const TEXT_COLOR_DEFAULT = 0xffffff;
/** Where the pose sits in a box whose block names no `anchor`: its centre. */
const TEXT_ANCHOR_DEFAULT: readonly [number, number] = [0.5, 0.5];

const unit = z.number().min(0).max(1);

const textFields = (env: FieldEnv) => ({
  text: z
    .string()
    .max(2_000)
    .optional()
    .describe("Literal text; rich markup when rich is set.")
    .meta({ group: "text" }),
  key: z
    .string()
    .regex(STRING_KEY_PATTERN)
    .optional()
    .describe("A string-table key; wins over text.")
    .meta({ group: "text", widget: "string-key" }),
  font: assetField(
    env,
    [FONT_KIND],
    "Default: the project's font for the locale.",
    "Font",
  ).optional(),
  size: z
    .number()
    .positive()
    .max(512)
    .optional()
    .describe(`Font size, px at zoom 1; default ${TEXT_SIZE_DEFAULT}.`)
    .meta({ unit: "px", default: TEXT_SIZE_DEFAULT, group: "look" }),
  color: rgbSchema
    .optional()
    .describe("0xRRGGBB; default white.")
    .meta({ widget: "color", group: "look" }),
  align: z
    .enum(["left", "center", "right"])
    .optional()
    .describe("How lines line up; default center.")
    .meta({ default: "center", group: "look" }),
  anchor: z
    .tuple([
      unit.describe("x: 0 the box's left edge, 1 its right."),
      unit.describe("y: 0 the box's top, 1 its bottom."),
    ])
    .optional()
    .describe("Where the pose sits in the text's box, 0–1; default the centre.")
    .meta({ default: TEXT_ANCHOR_DEFAULT, group: "placement", step: 0.05, decimals: 2 }),
  wrap: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Wrap width, px at zoom 1; omitted, lines break only where the text does.")
    .meta({ unit: "px", group: "placement" }),
  rich: z
    .boolean()
    .optional()
    .describe("Read [b], [color=…], [icon=…] and the other tags; default false.")
    .meta({ default: false, group: "text" }),
  outline: z
    .strictObject({
      width: z.number().positive().describe("Width, px at zoom 1.").meta({ unit: "px" }),
      color: rgbSchema.describe("0xRRGGBB.").meta({ widget: "color" }),
    })
    .optional()
    .describe("A stroke around each glyph.")
    .meta({ group: "look" }),
  vars: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional()
    .describe("Values for {name} placeholders.")
    .meta({ group: "text" }),
});

/** A `text` block as an entity carries it. */
export type TextBlock = z.infer<z.ZodObject<ReturnType<typeof textFields>>>;

/** Changes what one entity's text shows, until the block changes. */
export type TextHandle = {
  /** Shows literal text in place of the block's. */
  set(text: string): void;
  /** Shows a string key's text, filled from `vars`. */
  setKey(key: string, vars?: Readonly<Record<string, string | number>>): void;
};

export const TEXT = defineBehavior({
  name: "text",
  handle: handleType<TextHandle>(),
  description:
    "Draws text at the entity: a literal or a string key, in a bitmap, MSDF or web font, drawn only.",
  visualOnly: true,
  fields: textFields,
  inspector: { category: "visual", label: "Text", order: ["text", "key", "font", "size"] },
});

/** What a `set` or `setKey` shows in place of the block's own text. */
export type TextShown = { text: string } | { key: string; vars?: TextVars };

/**
 * The markup `parseRichText` reads for a text: with `rich`, the text
 * itself; else with every `[` and `\` escaped, so `{name}` placeholders
 * still fill and every other character shows as written.
 */
export const richSource = (source: string, rich: boolean): string =>
  rich ? source : escapeRich(source, "{");

/** The direction of a text's first letter: right to left for a right-to-left script's. */
export function textDirection(lines: readonly RichLine[]): TextDirection {
  for (const line of lines)
    for (const span of line) {
      const letter = /\p{L}/u.exec(span.text)?.[0];
      if (letter !== undefined) return RTL_CHAR.test(letter) ? "rtl" : "ltr";
    }
  return "ltr";
}

/** What `textFontOf` reads of an asset; `AssetInfo` fits. */
export type FontAssetInfo = {
  kind: string;
  sha256?: Sha256;
  /** A font's meta. */
  font?: FontMeta;
  /** A bitmap font's page textures, by id. */
  pages?: readonly AssetId[];
};

/**
 * The face a font asset draws in: a BMFont by its .fnt's hash and its
 * pages' hashes, a web font by its content hash, which the view's loader
 * resolves to the family it registered. Null for no id, an asset that isn't
 * a font, or one whose meta or files aren't known yet.
 */
export function textFontOf(
  asset: ((id: AssetId) => FontAssetInfo | null | undefined) | undefined,
  id: AssetId | undefined,
): TextFont | null {
  if (!asset || id === undefined) return null;
  const info = asset(id);
  if (info?.kind !== FONT_KIND || !info.font) return null;
  if (info.font.format === "bmfont") {
    if (info.sha256 === undefined || !info.pages?.length) return null;
    const pages: Sha256[] = [];
    for (const page of info.pages) {
      const hash = asset(page)?.sha256;
      if (hash === undefined) return null;
      pages.push(hash);
    }
    return { kind: "bitmap", hash: info.sha256, pages, meta: info.font };
  }
  return info.sha256 === undefined ? null : { kind: "web", family: info.sha256 };
}

/** The metrics `measureText` reads for a face: a BMFont's meta; none for a web font, which it estimates. */
export const measureFont = (font: TextFont | null): FontMeta | null =>
  font?.kind === "bitmap" ? font.meta : null;

/**
 * A measured text's box around its pose, placed by `anchor` (default the
 * centre), unturned: its px over `pxPerUnit`, the game's px per metre for a
 * pose in metres, 1 for one in world px.
 */
export function textBoxShape(
  size: { width: number; height: number },
  anchor: readonly [number, number] | undefined,
  pxPerUnit: number,
): Extract<ShapeObj, { type: "box" }> {
  const w = size.width / pxPerUnit;
  const h = size.height / pxPerUnit;
  const [ax, ay] = anchor ?? TEXT_ANCHOR_DEFAULT;
  return { type: "box", cx: (0.5 - ax) * w, cy: (0.5 - ay) * h, hw: w / 2, hh: h / 2, rotDeg: 0 };
}
