import type { SpriteAssetLookup } from "../game/behaviors/sprite";
import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import type { AssetInfo } from "../project/asset-info";
import type { ATLAS_KIND } from "../project/kinds/atlas";
import type { TEXTURE_KIND } from "../project/kinds/texture";
import type { AssetEntry } from "../project/types";
import { parseBulkId } from "../scene/bulk-ref";
import { bulkKeysOf } from "../scene/expand";
import { FRAGMENT_KIND, type SceneFragment } from "../scene/fragment";
import { makeIssue } from "../scene/issues";
import { applyOps } from "../scene/ops";
import { resolveScene } from "../scene/resolve";
import {
  PREFAB_KIND,
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type EntityInput,
  type InstanceDef,
  type InstanceInput,
  type PrefabLibrary,
  type Pt,
  type SceneDefinition,
  type SceneIssue,
} from "../scene/types";
import type { ShapeObj } from "../scene/types";
import { snapToPixel } from "../scene/units";
import { pasteFragment, type PasteResult } from "./clipboard";
import { boundsCheck } from "./placement";
import { marksBounds, outlinesOfRef, type OutlineMarks } from "./tool-host";
import type { SnapSettings, ToolOverlay } from "./tools";

/** An asset dragged onto the canvas: a texture, an atlas frame (with `frame`) or a prefab. */
export type AssetDrop = { entry: AssetEntry; info: AssetInfo; frame?: string };

// Typed against the kinds' constants without importing their inspectors into the editor.
const TEXTURE: typeof TEXTURE_KIND = "texture";
const ATLAS: typeof ATLAS_KIND = "atlas";

/** The entity type a dropped picture becomes. */
const DECOR = "decor";

const isInstance = (input: EntityInput | InstanceInput): input is InstanceInput =>
  typeof (input as { prefab?: unknown }).prefab === "string";

function fragmentOfInput(input: EntityInput | InstanceInput): SceneFragment {
  const base = { kind: FRAGMENT_KIND, v: SCENE_FORMAT_VERSION } as const;
  if (isInstance(input)) {
    const instance = { ...input, id: input.id ?? `${input.prefab}-1` } as InstanceDef;
    return { ...base, entities: [], instances: [instance] };
  }
  const entity = { ...input, id: input.id ?? input.type } as EntityDef;
  return { ...base, entities: [entity] };
}

function engineDrop({ entry, frame }: AssetDrop): EntityInput | InstanceInput | null {
  if (entry.kind === TEXTURE)
    return { type: DECOR, at: [0, 0], behaviors: { sprite: { asset: entry.id } } };
  if (entry.kind === ATLAS && frame !== undefined)
    return { type: DECOR, at: [0, 0], behaviors: { sprite: { asset: entry.id, frame } } };
  if (entry.kind === PREFAB_KIND) return { prefab: entry.id, at: [0, 0] };
  return null;
}

/**
 * The fragment a dropped asset becomes, or null when the kind isn't
 * placeable: a texture a `decor` drawing it, an atlas frame a `decor`
 * drawing that frame, a prefab an instance of it. The game's
 * `editor.assetDrop` is asked first; its null falls back to these.
 */
export function dropFragment(drop: AssetDrop, registry: Registry): SceneFragment | null {
  const input = registry.game?.editor?.assetDrop?.(drop) ?? engineDrop(drop);
  return input ? fragmentOfInput(input) : null;
}

function notPlaceable({ entry, frame }: AssetDrop): SceneIssue {
  const name = entry.name ?? entry.id;
  if (entry.kind === ATLAS && frame === undefined)
    return makeIssue("asset-frame-unknown", {
      message: `${name} is an atlas: drag one of its frames onto the scene`,
      path: "",
      got: entry.id,
    });
  return makeIssue("asset-kind", {
    message: `${name} is a ${entry.kind}, which can't be placed in a scene`,
    path: "",
    got: entry.kind,
  });
}

/**
 * One batch that places a dropped asset: its fragment's box centred on
 * `at` and snapped as a paste is, ids that clash renamed. A drop that
 * isn't placeable gives `ok: false` with an `asset-kind` (or, for an atlas
 * without a frame, `asset-frame-unknown`) issue.
 */
export function dropBatch(
  drop: AssetDrop,
  at: Pt,
  opts: {
    def: SceneDefinition;
    registry: Registry;
    snap?: SnapSettings;
    /** The project's prefabs; a dropped prefab needs its own here. */
    prefabs?: PrefabLibrary;
  },
): PasteResult {
  const fragment = dropFragment(drop, opts.registry);
  if (!fragment) return { ok: false, issues: [notPlaceable(drop)] };
  const result = pasteFragment(fragment, {
    def: opts.def,
    registry: opts.registry,
    at,
    ...(opts.snap ? { snap: opts.snap } : {}),
    ...(opts.prefabs ? { prefabs: opts.prefabs } : {}),
  });
  if (!result.ok) return result;
  const label = `Place ${drop.frame ?? drop.entry.name ?? drop.entry.id}`;
  return { ...result, batch: { ...result.batch, label } };
}

export type DropOptions = Parameters<typeof dropBatch>[2];

/**
 * The asset's size (texture px, one world px each), or 32 px square, in
 * metres and centred on `at`: a drop with nothing else to show.
 */
function assetBox(drop: AssetDrop, at: Pt, pxPerMetre: number): ShapeObj {
  const [w, h] = drop.info.size ?? [32, 32];
  return {
    type: "box",
    cx: snapToPixel(at[0], pxPerMetre),
    cy: snapToPixel(at[1], pxPerMetre),
    hw: w / 2 / pxPerMetre,
    hh: h / 2 / pxPerMetre,
    rotDeg: 0,
  };
}

const refused = (drop: AssetDrop, at: Pt, reason: string, pxPerMetre: number): DropPreview => ({
  ghosts: [{ shape: assetBox(drop, at, pxPerMetre), valid: false, reason }],
});

/** World px around a drop of points only, so its invalid ghost has a size. */
const POINT_PAD_PX = 8;

/** What dropping an asset here would place, as overlay ghosts. */
export type DropPreview = Required<Pick<ToolOverlay, "ghosts">> & Pick<ToolOverlay, "points">;

/**
 * What `dropBatch` would place at `at`, drawn before the drop: what it
 * selects, outlined as the selection would be (`outlinesOfRef`), its
 * outlines as ghosts and the points of point entities without a sprite as
 * ghost points, snapped as the drop is. A drop that
 * would be refused, or that lands outside the scene's bounds, gives
 * invalid ghosts with the reason. `asset` sizes sprite boxes; without it
 * the dropped asset's own info does.
 */
export function dropPreview(
  drop: AssetDrop,
  at: Pt,
  opts: DropOptions & { asset?: SpriteAssetLookup },
): DropPreview {
  const ppm = pxPerMetreOf(opts.registry);
  const result = dropBatch(drop, at, opts);
  if (!result.ok)
    return refused(drop, at, result.issues[0]?.message ?? "This asset can't be placed", ppm);
  // Only what the batch adds is drawn, so it is applied to the scene without its entities.
  const { def, registry, prefabs } = opts;
  const bare: SceneDefinition = { ...def, entities: [] };
  delete bare.instances;
  delete bare.groups;
  const keep = new Set(result.select.flatMap((r) => parseBulkId(r)?.key ?? []));
  for (const key of bulkKeysOf(bare)) if (!keep.has(key)) delete bare[key];
  const applied = applyOps(bare, result.batch, registry, {
    validate: "none",
    ...(prefabs ? { prefabs } : {}),
  });
  if (!applied.ok) return refused(drop, at, applied.issue.message, ppm);
  const placed = resolveScene(applied.def, registry, applied.prefabs ?? prefabs);
  const asset: SpriteAssetLookup =
    opts.asset ?? ((id) => (id === drop.entry.id ? drop.info : undefined));
  const marks: OutlineMarks = { outlines: [], points: [] };
  for (const ref of result.select)
    outlinesOfRef(placed, ref, "ghost", marks, { registry, asset, spritePoints: false });
  const shapes = marks.outlines.map((o) => o.shape);
  const points = marks.points.map((p) => p.at);
  const box = marksBounds(marks.outlines, marks.points);
  if (!box) return { ghosts: [{ shape: assetBox(drop, at, ppm), valid: true }] };
  const check = boundsCheck(box, def);
  const tone = check.valid ? ("ghost" as const) : ("invalid" as const);
  if (shapes.length === 0 && !check.valid) {
    const { minX, minY, maxX, maxY } = box;
    const pad = POINT_PAD_PX / ppm;
    shapes.push({
      type: "box",
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      hw: (maxX - minX) / 2 + pad,
      hh: (maxY - minY) / 2 + pad,
      rotDeg: 0,
    });
  }
  return {
    ghosts: shapes.map((shape, i) => ({
      shape,
      valid: check.valid,
      // One reason for the whole drop, beside its first ghost.
      ...(check.reason && i === 0 ? { reason: check.reason } : {}),
    })),
    ...(points.length > 0 ? { points: points.map((p) => ({ at: p, tone })) } : {}),
  };
}
