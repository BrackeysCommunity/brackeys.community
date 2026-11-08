import { z } from "zod";

import { ID_PATTERN } from "../../game/fields";
import { parseAsepriteJson } from "../inspect/aseprite";
import { atlasImage, atlasTool, type AtlasSheet } from "../inspect/atlas";
import { siblingPath } from "../inspect/paths";
import { guardedInspect, importFailed } from "../inspect/result";
import { utf8Json } from "../inspect/text";
import { parseTexturePackerJson } from "../inspect/texturepacker";
import type { RefSite } from "../refs";
import type { AssetEntry, AssetId } from "../types";
import { defineAssetKind, folderOf, isPlainObject } from "./define";

export const ATLAS_KIND = "atlas";
export const ATLAS_SUFFIX = ".atlas.json";

export type AtlasTool = "aseprite" | "texturepacker";
export type AtlasMeta = AtlasSheet & { tool: AtlasTool };
export type AtlasSettings = { texture?: AssetId; pivotDefault?: [number, number] };

const int = z.number().int().min(0);
const pair = z.tuple([z.number(), z.number()]);

export const atlasSettingsSchema: z.ZodType<AtlasSettings> = z
  .strictObject({
    texture: z
      .string()
      .regex(ID_PATTERN)
      .optional()
      .describe("The texture asset the frames cut; filled on import from the JSON's `meta.image`."),
    pivotDefault: pair
      .optional()
      .describe("The pivot, as fractions of a frame, of frames that don't give their own."),
  })
  .describe("Atlas import settings; every field is optional.");

const frameSchema = z.strictObject({
  x: int,
  y: int,
  w: int,
  h: int,
  pivot: pair.optional().describe("The frame's origin as fractions of its size."),
  durationMs: z.number().min(0).optional().describe("How long the frame shows in an animation."),
});

export const atlasMetaSchema: z.ZodType<AtlasMeta> = z
  .strictObject({
    tool: z.enum(["aseprite", "texturepacker"]).describe("The tool that exported the JSON."),
    frames: z.record(z.string(), frameSchema).describe("Frame rectangles in the texture, by name."),
    tags: z
      .array(
        z.strictObject({
          name: z.string(),
          from: int,
          to: int,
          direction: z.enum(["forward", "reverse", "pingpong"]),
        }),
      )
      .describe("Animations: ranges of `order`."),
    slices: z
      .array(
        z.strictObject({
          name: z.string(),
          frame: z.string(),
          x: int,
          y: int,
          w: int,
          h: int,
          center: z.tuple([int, int, int, int]).optional(),
        }),
      )
      .describe("Named rectangles inside a frame; `center` is a nine-slice middle, [x, y, w, h]."),
    order: z.array(z.string()).describe("Frame names in file order."),
  })
  .describe("What the atlas JSON gives.");

/**
 * The tool an export's `meta.app` names, which is how an import tells an
 * Aseprite or TexturePacker JSON not named `.atlas.json` from any other
 * JSON: an object with `frames`, no top-level `kind`, and an `app` at
 * aseprite.org or codeandweb.com/texturepacker. Null otherwise.
 */
export function atlasExportApp(json: unknown): AtlasTool | null {
  if (!isPlainObject(json) || json.kind !== undefined || atlasTool(json) === null) return null;
  const app = isPlainObject(json.meta) ? json.meta.app : undefined;
  if (typeof app !== "string") return null;
  const lower = app.toLowerCase();
  if (lower.includes("aseprite.org")) return "aseprite";
  if (lower.includes("codeandweb.com/texturepacker")) return "texturepacker";
  return null;
}

function withPivot(sheet: AtlasSheet, pivot: [number, number] | undefined): AtlasSheet {
  if (!pivot) return sheet;
  // fromEntries, so a frame named "__proto__" stays a frame.
  const frames = Object.fromEntries(
    Object.entries(sheet.frames).map(([name, frame]) => [
      name,
      frame.pivot ? frame : { ...frame, pivot: [pivot[0], pivot[1]] as [number, number] },
    ]),
  );
  return { ...sheet, frames };
}

/**
 * A sprite atlas: an Aseprite or TexturePacker JSON export, told apart by
 * `meta.app`. Its frames, tags and slices are meta; the image it cuts is the
 * texture asset `import.texture` names.
 */
export const atlasKind = defineAssetKind({
  kind: ATLAS_KIND,
  title: "Atlas",
  description:
    "A sprite atlas: the JSON an Aseprite or TexturePacker export writes beside its image.",
  match: { suffixes: [ATLAS_SUFFIX] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "blob",
  contentTypes: ["application/json"],
  maxBytes: 2 * 1024 * 1024,
  settings: atlasSettingsSchema,
  meta: atlasMetaSchema,
  inspect: guardedInspect(
    ATLAS_KIND,
    { settings: atlasSettingsSchema, meta: atlasMetaSchema },
    (bytes, settings, env) => {
      const json = utf8Json(bytes);
      if (!json.ok) return importFailed(ATLAS_KIND, env, json.reason);
      const tool = atlasTool(json.value);
      if (!tool) return importFailed(ATLAS_KIND, env, "it has no `frames`");
      const sheet =
        tool === "aseprite" ? parseAsepriteJson(json.value) : parseTexturePackerJson(json.value);
      if (!sheet)
        return importFailed(
          ATLAS_KIND,
          env,
          `it isn't a ${tool === "aseprite" ? "Aseprite" : "TexturePacker"} JSON export the engine reads (rotated frames, or tags and slices naming missing frames, are refused)`,
        );
      const meta: AtlasMeta = { tool, ...withPivot(sheet, settings.pivotDefault) };
      if (settings.texture !== undefined) return { ok: true, meta };
      const image = atlasImage(json.value);
      const path = image === null ? null : siblingPath(env.path, image);
      const texture = path === null ? undefined : env.idAt(path);
      return texture === undefined ? { ok: true, meta } : { ok: true, meta, import: { texture } };
    },
  ),
  refs: (entry: AssetEntry): RefSite[] =>
    typeof entry.import?.texture === "string"
      ? [{ pointer: "/import/texture", id: entry.import.texture, kinds: ["texture"] }]
      : [],
});
