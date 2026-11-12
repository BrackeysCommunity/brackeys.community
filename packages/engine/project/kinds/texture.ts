import { z } from "zod";

import type { ImageSize } from "../inspect/bytes";
import { readGifSize } from "../inspect/gif";
import { readJpegSize } from "../inspect/jpeg";
import { readPngSize } from "../inspect/png";
import { guardedInspect, importFailed } from "../inspect/result";
import { readWebpSize } from "../inspect/webp";
import { defineAssetKind, folderOf } from "./define";

export const TEXTURE_KIND = "texture";

export type TextureFormat = "png" | "jpeg" | "webp" | "gif";
export type TextureMeta = { format: TextureFormat; width: number; height: number };
export type TextureSettings = {
  filter?: "nearest" | "linear";
  pivot?: [number, number];
  nineSlice?: [number, number, number, number];
};

const READERS: readonly [TextureFormat, (bytes: Uint8Array) => ImageSize | null][] = [
  ["png", readPngSize],
  ["jpeg", readJpegSize],
  ["webp", readWebpSize],
  ["gif", readGifSize],
];

const inset = z.number().int().min(0);
const size = (description: string) => z.number().int().positive().describe(description);

export const textureSettingsSchema: z.ZodType<TextureSettings> = z
  .strictObject({
    filter: z
      .enum(["nearest", "linear"])
      .optional()
      .describe(
        'How the image scales: "nearest" keeps pixels crisp (the default), "linear" smooths.',
      ),
    pivot: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("The origin as fractions of the size, [x, y]; [0.5, 0.5] (the centre) by default."),
    nineSlice: z
      .tuple([inset, inset, inset, inset])
      .optional()
      .describe("Nine-slice insets in pixels, [left, top, right, bottom]; none by default."),
  })
  .describe("Texture import settings; every field is optional.");

export const textureMetaSchema: z.ZodType<TextureMeta> = z
  .strictObject({
    format: z.enum(["png", "jpeg", "webp", "gif"]).describe("The image format its header names."),
    width: size("Width in pixels."),
    height: size("Height in pixels."),
  })
  .describe("What the image's header gives.");

/** An image: PNG, JPEG, WebP or GIF, sized from its header. */
export const textureKind = defineAssetKind({
  kind: TEXTURE_KIND,
  title: "Texture",
  description: "An image (PNG, JPEG, WebP or GIF) for sprites, tiles and backgrounds.",
  match: { suffixes: [".png", ".jpg", ".jpeg", ".webp", ".gif"] },
  defaultFolder: (_env, near) => folderOf(near),
  storage: "blob",
  contentTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  maxBytes: 8 * 1024 * 1024,
  settings: textureSettingsSchema,
  meta: textureMetaSchema,
  inspect: guardedInspect(
    TEXTURE_KIND,
    { settings: textureSettingsSchema, meta: textureMetaSchema },
    (bytes, _settings, env) => {
      for (const [format, read] of READERS) {
        const found = read(bytes);
        if (found) return { ok: true, meta: { format, ...found } };
      }
      return importFailed(
        TEXTURE_KIND,
        env,
        "its header isn't a PNG, JPEG, WebP or GIF with a size",
      );
    },
  ),
});
