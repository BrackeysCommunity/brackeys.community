import { z } from "zod";

import { ID_PATTERN } from "../../game/fields";
import { parseBmfont } from "../inspect/bmfont";
import { hasAscii } from "../inspect/bytes";
import { readFontFormat, type WebFontFormat } from "../inspect/font";
import { siblingPath } from "../inspect/paths";
import { guardedInspect, importFailed } from "../inspect/result";
import { utf8Text } from "../inspect/text";
import type { RefSite } from "../refs";
import type { AssetEntry, AssetId, AssetPath } from "../types";
import { defineAssetKind, folderOf } from "./define";

export const FONT_KIND = "font";

export type FontFormat = "bmfont" | WebFontFormat;
export type FontMeta = { format: FontFormat; lineHeight?: number; pages?: AssetPath[] };
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

export const fontMetaSchema: z.ZodType<FontMeta> = z
  .strictObject({
    format: z
      .enum(["bmfont", "woff2", "woff", "ttf", "otf"])
      .describe("A text BMFont (.fnt) or the container a font file's header names."),
    lineHeight: z.number().int().positive().optional().describe("A bitmap font's line height, px."),
    pages: z
      .array(z.string())
      .optional()
      .describe("A bitmap font's page files as project paths, in page order."),
  })
  .describe("What the font's header gives; glyphs are never read.");

const unsupportedBmfont = (bytes: Uint8Array): string | null => {
  if (hasAscii(bytes, 0, "BMF")) return "it's a binary BMFont; export it in the text format";
  const head = utf8Text(bytes.subarray(0, 64))?.trimStart() ?? "";
  if (head.startsWith("<")) return "it's an XML BMFont; export it in the text format";
  return null;
};

/**
 * A font: a text BMFont (.fnt), whose page images are texture assets named
 * by `import.pages`, or a WOFF2, WOFF, TrueType or OpenType file.
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
  settings: fontSettingsSchema,
  meta: fontMetaSchema,
  inspect: guardedInspect(
    FONT_KIND,
    { settings: fontSettingsSchema, meta: fontMetaSchema },
    (bytes, settings, env) => {
      const format = readFontFormat(bytes);
      if (format) return { ok: true, meta: { format } };
      const refused = unsupportedBmfont(bytes);
      if (refused) return importFailed(FONT_KIND, env, refused);
      const text = utf8Text(bytes);
      const font = text === null ? null : parseBmfont(text);
      if (!font)
        return importFailed(
          FONT_KIND,
          env,
          "its header isn't a WOFF2, WOFF, TTF or OTF font, nor a text BMFont with a `common` line and pages",
        );
      const pages: AssetPath[] = [];
      for (const file of font.pages) {
        const path = siblingPath(env.path, file);
        if (path === null) return importFailed(FONT_KIND, env, `its page "${file}" names no file`);
        pages.push(path);
      }
      const meta: FontMeta = { format: "bmfont", lineHeight: font.lineHeight, pages };
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
