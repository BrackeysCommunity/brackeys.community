import { z } from "zod";

import { ID_PATTERN } from "../../game/fields";
import { parseBmfont } from "../inspect/bmfont";
import { hasAscii } from "../inspect/bytes";
import { fontCoverage, readFontFormat, type WebFontFormat } from "../inspect/font";
import { siblingPath } from "../inspect/paths";
import { guardedInspect, importFailed } from "../inspect/result";
import { utf8Text } from "../inspect/text";
import type { RefSite } from "../refs";
import type { AssetEntry, AssetId, AssetPath } from "../types";
import { defineAssetKind, folderOf } from "./define";

export const FONT_KIND = "font";

export type FontFormat = "bmfont" | WebFontFormat;
export type FontMeta = {
  format: FontFormat;
  lineHeight?: number;
  pages?: AssetPath[];
  /** BMFont only: the face's size, advances by code point and kerning pairs, for exact headless measuring. */
  size?: number;
  advances?: Readonly<Record<string, number>>;
  kerning?: readonly (readonly [first: number, second: number, amount: number])[];
  distanceField?: { type: "msdf" | "sdf"; range: number };
  /** Code point ranges the face covers; absent when they couldn't be read. */
  coverage?: readonly (readonly [from: number, to: number])[];
};
export type FontSettings = { pages?: AssetId[] };

export const fontSettingsSchema: z.ZodType<FontSettings> = z
  .strictObject({
    pages: z
      .array(z.string().regex(ID_PATTERN))
      .optional()
      .describe(
        "A bitmap font's page textures in page order, by asset id; filled on import when every page file the .fnt names is a texture beside it.",
      ),
  })
  .describe("Font import settings; every field is optional.");

const codePoint = z.number().int().min(0).max(0x10ffff);

export const fontMetaSchema: z.ZodType<FontMeta> = z
  .strictObject({
    format: z
      .enum(["bmfont", "woff2", "woff", "ttf", "otf"])
      .describe("A BMFont (.fnt, text or XML) or the container a font file's header names."),
    lineHeight: z.number().int().positive().optional().describe("A bitmap font's line height, px."),
    pages: z
      .array(z.string())
      .optional()
      .describe("A bitmap font's page files as project paths, in page order."),
    size: z.number().positive().optional().describe("A bitmap font's face size, px."),
    advances: z
      .record(z.string().regex(/^\d+$/), z.number())
      .optional()
      .describe("A bitmap font's horizontal advance by decimal code point, px."),
    kerning: z
      .array(z.tuple([codePoint, codePoint, z.number()]))
      .optional()
      .describe(
        "A bitmap font's kerning pairs as [first, second, amount px], by first then second.",
      ),
    distanceField: z
      .strictObject({
        type: z.enum(["msdf", "sdf"]).describe("Multi-channel or single-channel signed distance."),
        range: z.number().positive().describe("The field's distance range, px."),
      })
      .optional()
      .describe("A distance-field bitmap font's field, drawn scalable."),
    coverage: z
      .array(z.tuple([codePoint, codePoint]))
      .optional()
      .describe(
        "Inclusive code point ranges the font has glyphs for, ascending; absent when they couldn't be read.",
      ),
  })
  .describe("What the font's header, character map or BMFont text gives; outlines are never read.");

const binaryBmfont = (bytes: Uint8Array) => hasAscii(bytes, 0, "BMF");

/**
 * A font: a text or XML BMFont (.fnt), whose page images are texture assets
 * named by `import.pages`, or a WOFF2, WOFF, TrueType or OpenType file.
 */
export const fontKind = defineAssetKind({
  kind: FONT_KIND,
  title: "Font",
  description:
    "A font: a bitmap font (.fnt with its page images) or a WOFF2, WOFF, TTF or OTF file.",
  match: { suffixes: [".fnt", ".woff2", ".woff", ".ttf", ".otf"] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "blob",
  contentTypes: ["text/plain", "font/woff2", "font/woff", "font/ttf", "font/otf"],
  maxBytes: 4 * 1024 * 1024,
  metaVersion: 2,
  settings: fontSettingsSchema,
  meta: fontMetaSchema,
  inspect: guardedInspect(
    FONT_KIND,
    { settings: fontSettingsSchema, meta: fontMetaSchema },
    (bytes, settings, env) => {
      const format = readFontFormat(bytes);
      if (format) {
        const coverage = fontCoverage(bytes, format, env.decompress);
        return { ok: true, meta: coverage ? { format, coverage } : { format } };
      }
      if (binaryBmfont(bytes))
        return importFailed(FONT_KIND, env, "it's a binary BMFont; export it as text or XML");
      const text = utf8Text(bytes);
      const font = text === null ? null : parseBmfont(text);
      if (!font)
        return importFailed(
          FONT_KIND,
          env,
          "its header isn't a WOFF2, WOFF, TTF or OTF font, nor a text or XML BMFont with a `common` line and pages",
        );
      const pages: AssetPath[] = [];
      for (const file of font.pages) {
        const path = siblingPath(env.path, file);
        if (path === null) return importFailed(FONT_KIND, env, `its page "${file}" names no file`);
        pages.push(path);
      }
      const meta: FontMeta = { format: "bmfont", ...font, pages };
      if (settings.pages !== undefined) return { ok: true, meta };
      const ids = pages.map((path) => env.idAt(path));
      if (!ids.every((id): id is AssetId => id !== undefined)) return { ok: true, meta };
      return { ok: true, meta, import: { pages: ids } };
    },
  ),
  refs: (entry: AssetEntry): RefSite[] => {
    const pages = entry.import?.pages;
    if (!Array.isArray(pages)) return [];
    return pages.flatMap((id, i) =>
      typeof id === "string" ? [{ pointer: `/import/pages/${i}`, id, kinds: ["texture"] }] : [],
    );
  },
});
