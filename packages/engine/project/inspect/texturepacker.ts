import { type AtlasSheet, parseSheet } from "./atlas";

/**
 * A TexturePacker atlas's JSON (hash or array export, including the PixiJS
 * and Phaser flavours): frames with pivots, contiguous `animations` as tags,
 * and per-frame nine-slice borders as slices.
 */
export function parseTexturePackerJson(json: unknown): AtlasSheet | null {
  return parseSheet(json, { packer: true });
}
