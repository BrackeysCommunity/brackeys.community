import { ATLAS_KIND, atlasMetaSchema, atlasSettingsSchema } from "./kinds/atlas";
import { TEXTURE_KIND, textureMetaSchema, textureSettingsSchema } from "./kinds/texture";
import type { AssetEntry, AssetId, AssetKindName, ProjectView, Sha256 } from "./types";

/** What headless code and the editor know of an asset without decoding or fetching it. */
export type AssetInfo = {
  id: AssetId;
  kind: AssetKindName;
  sha256?: Sha256;
  bytes?: number;
  /** Pixel size: a texture's, or with `frame`, the frame's. */
  size?: [w: number, h: number];
  pivot?: [x: number, y: number];
  nineSlice?: [number, number, number, number];
  filter?: "nearest" | "linear";
  /** An atlas: its frame names in file order, its tags, its texture's id. */
  frames?: readonly string[];
  tags?: readonly { name: string; from: number; to: number; direction: string }[];
  /** An atlas: each frame's durationMs, in `frames` order; null where the export gives none. */
  durations?: readonly (number | null)[];
  texture?: AssetId;
  /** An atlas frame's rectangle in its texture, px; only with `frame`. */
  rect?: { x: number; y: number; w: number; h: number };
};

type FrameInfo = Pick<AssetInfo, "size" | "pivot" | "rect">;

/** An entry's info, and an atlas's frames' sizes and pivots by name. */
export type EntryInfo = { info: AssetInfo; frames: ReadonlyMap<string, FrameInfo> };

/**
 * One entry's info from its meta and import settings. Meta or settings
 * that don't fit the kind's schema add nothing beyond the entry's own
 * fields; a kind without frames has none.
 */
export function entryInfo(entry: AssetEntry): EntryInfo {
  const info: AssetInfo = {
    id: entry.id,
    kind: entry.kind,
    ...(entry.sha256 !== undefined ? { sha256: entry.sha256 } : {}),
    ...(entry.bytes !== undefined ? { bytes: entry.bytes } : {}),
  };
  const frames = new Map<string, FrameInfo>();
  if (entry.kind === TEXTURE_KIND) {
    const meta = textureMetaSchema.safeParse(entry.meta);
    const settings = textureSettingsSchema.safeParse(entry.import ?? {});
    if (meta.success) info.size = [meta.data.width, meta.data.height];
    if (settings.success) {
      const { pivot, nineSlice, filter } = settings.data;
      if (pivot) info.pivot = [pivot[0], pivot[1]];
      if (nineSlice) info.nineSlice = [nineSlice[0], nineSlice[1], nineSlice[2], nineSlice[3]];
      if (filter) info.filter = filter;
    }
    return { info, frames };
  }
  if (entry.kind === ATLAS_KIND) {
    const meta = atlasMetaSchema.safeParse(entry.meta);
    const settings = atlasSettingsSchema.safeParse(entry.import ?? {});
    if (meta.success) {
      info.frames = [...meta.data.order];
      info.durations = meta.data.order.map((name) =>
        Object.hasOwn(meta.data.frames, name) ? (meta.data.frames[name]?.durationMs ?? null) : null,
      );
      info.tags = meta.data.tags.map(({ name, from, to, direction }) => ({
        name,
        from,
        to,
        direction,
      }));
      for (const name of meta.data.order) {
        if (!Object.hasOwn(meta.data.frames, name)) continue;
        const f = meta.data.frames[name]!;
        frames.set(name, {
          size: [f.w, f.h],
          rect: { x: f.x, y: f.y, w: f.w, h: f.h },
          ...(f.pivot ? { pivot: [f.pivot[0], f.pivot[1]] as [number, number] } : {}),
        });
      }
    }
    if (settings.success && settings.data.texture !== undefined)
      info.texture = settings.data.texture;
    return { info, frames };
  }
  return { info, frames };
}

/**
 * `id`'s info from its live entry: kind, hash and size in bytes; a
 * texture's pixel size and its import pivot, nine-slice and filter; an
 * atlas's frame names in file order, tags and texture id. With `frame`, an
 * atlas's info with that frame's pixel size, rectangle and pivot (frames without their
 * own carry the atlas's `pivotDefault`). Null for an id with no live asset
 * and for a frame the asset doesn't have.
 */
export function assetInfo(view: ProjectView, id: AssetId, frame?: string): AssetInfo | null {
  const entry = view.byId.get(id);
  if (!entry) return null;
  const { info, frames } = entryInfo(entry);
  if (frame === undefined) return info;
  const own = frames.get(frame);
  return own ? { ...info, ...own } : null;
}
