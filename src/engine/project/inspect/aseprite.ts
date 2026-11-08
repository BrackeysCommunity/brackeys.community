import { type AtlasSheet, parseSheet } from "./atlas";

/** An Aseprite sheet's JSON (hash or array export): frames with durations, frame tags and slice keys. */
export function parseAsepriteJson(json: unknown): AtlasSheet | null {
  return parseSheet(json, { packer: false });
}
