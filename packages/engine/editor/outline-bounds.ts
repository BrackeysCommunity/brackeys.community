import type { Registry } from "../game/types";
import type { GridCells } from "../scene/grid";
import { growOverGrid, type SpriteAssetLookup } from "../scene/render-geometry";
import { CHILD_SEPARATOR } from "../scene/resolve";
import { gridFieldsOf } from "../scene/schema";
import { aabb, aabbUnion } from "../scene/shape-geometry";
import type {
  Aabb,
  EntityDef,
  GridSettings,
  Pt,
  Ref,
  SceneDefinition,
  ShapeObj,
} from "../scene/types";
import { pathFollowPath } from "./gizmos/behavior-marks";
import { editSpriteBox, entityGeometry, geometryOfRef, type EditGeometry } from "./spatial-index";
import type { OverlayTone, ToolOverlay } from "./tools";

/** Outline marks as the overlay draws them. */
export type OutlineMarks = Required<Pick<ToolOverlay, "outlines" | "points">>;

export type OutlineLook = {
  registry: Registry;
  /** Asset info for sizing sprite boxes (`ProjectRuntimeView.asset`); without it a box is its block's size or 32×32. */
  asset?: SpriteAssetLookup;
  /** Whether a point entity carrying a sprite marks its point as well as the box; default true. */
  spritePoints?: boolean;
};

/** The look outlines are drawn and bounded with, sizing sprite boxes by `asset` when given. */
export const outlineLook = (registry: Registry, asset?: SpriteAssetLookup): OutlineLook => ({
  registry,
  ...(asset ? { asset } : {}),
});

const boxShape = (b: Aabb): ShapeObj => ({
  type: "box",
  cx: (b.minX + b.maxX) / 2,
  cy: (b.minY + b.maxY) / 2,
  hw: (b.maxX - b.minX) / 2,
  hh: (b.maxY - b.minY) / 2,
  rotDeg: 0,
});

const ptsBox = (pts: readonly Pt[]): Aabb | null =>
  pts.reduce<Aabb | null>((b, [x, y]) => {
    const p = { minX: x, minY: y, maxX: x, maxY: y };
    return b ? aabbUnion(b, p) : p;
  }, null);

/** The box over a grid entity's origin and filled cells, as the renderers bound it; null without cells. */
function gridBox(grid: GridSettings, at: Pt, e: EntityDef, registry: Registry): Aabb | null {
  const origin: Aabb = { minX: at[0], minY: at[1], maxX: at[0], maxY: at[1] };
  let box = origin;
  for (const field of gridFieldsOf(registry.types.get(e.type))) {
    const value = e[field];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    try {
      box = growOverGrid(box, grid, at, [{ value: value as GridCells }]);
    } catch {
      // A half-typed grid value outlines nothing rather than throwing.
    }
  }
  return box === origin ? null : box;
}

/**
 * One entity's or bulk row's marks as the scene draws it, posed by `g`:
 * its shape, its sprite's box, its grid cells' box, and without a shape its point.
 */
function geometryMarks(
  def: SceneDefinition,
  g: EditGeometry,
  type: string,
  entity: EntityDef | undefined,
  tone: OverlayTone,
  owner: Ref,
  out: OutlineMarks,
  look: OutlineLook,
): void {
  if (g.shape) out.outlines.push({ shape: g.shape, tone, ref: owner });
  const sprite = editSpriteBox(look.registry, type, g, entity?.behaviors, look.asset);
  if (sprite) out.outlines.push({ shape: sprite.shape, tone, ref: owner });
  const grid = def.settings?.grid;
  const cells =
    !g.shape && g.at && grid && entity ? gridBox(grid, g.at, entity, look.registry) : null;
  if (cells) out.outlines.push({ shape: boxShape(cells), tone, ref: owner });
  if (!g.shape && g.at && (!sprite || look.spritePoints !== false))
    out.points.push({ at: g.at, tone, ref: owner });
}

/** The entities `ref` names in `def`: the entity itself, or an instance's children. */
function entitiesOfRef(def: SceneDefinition, ref: Ref): EntityDef[] {
  const entities = def.entities ?? [];
  const own = entities.find((e) => e.id === ref);
  if (own) return [own];
  const prefix = `${ref}${CHILD_SEPARATOR}`;
  return entities.filter((e) => e.id.startsWith(prefix));
}

/** Whether `ref` names an instance (or a nested one) rather than an entity of `def`. */
export function isComposite(def: SceneDefinition, ref: Ref): boolean {
  const named = entitiesOfRef(def, ref);
  return named.length > 0 && named[0]!.id !== ref;
}

/**
 * Appends `ref`'s outlines in `def` (the resolved view, as previewed) to
 * `out`, each in its world pose: an entity's or bulk row's own geometry,
 * or for an instance, every child it resolves to. Sprite boxes are posed
 * from `def`'s geometry, so they follow a preview. Outlines carry `ref`.
 */
export function outlinesOfRef(
  def: SceneDefinition,
  ref: Ref,
  tone: OverlayTone,
  out: OutlineMarks,
  look: OutlineLook,
): void {
  const { registry } = look;
  const own = geometryOfRef(def, registry, ref);
  if (own) {
    const entity = own.bulk ? undefined : (def.entities ?? []).find((e) => e.id === ref);
    geometryMarks(def, own, own.type, entity, tone, ref, out, look);
    return;
  }
  for (const e of entitiesOfRef(def, ref)) {
    const t = registry.types.get(e.type);
    if (t) geometryMarks(def, entityGeometry(t, e), e.type, e, tone, ref, out, look);
  }
}

/**
 * The box around what `refs` outline in `def`, an instance's children for an
 * instance; `null` when none of them draws. Framing and revealing a selection
 * go by it, so they show what its outline shows.
 */
export function outlineBounds(
  def: SceneDefinition,
  refs: readonly Ref[],
  look: OutlineLook,
): Aabb | null {
  const marks: OutlineMarks = { outlines: [], points: [] };
  for (const ref of refs) outlinesOfRef(def, ref, "selected", marks, look);
  return marksBounds(marks.outlines, marks.points);
}

/**
 * The box framing `refs` goes to: their `outlineBounds` grown over the paths
 * their entities travel (a path field's and a `path-follow` block's
 * waypoints), so framing an entity on a path shows its whole route.
 */
export function frameBounds(
  def: SceneDefinition,
  refs: readonly Ref[],
  look: OutlineLook,
): Aabb | null {
  const { registry } = look;
  const route: Pt[] = [];
  for (const ref of refs) {
    for (const e of entitiesOfRef(def, ref)) {
      const t = registry.types.get(e.type);
      if (!t) continue;
      route.push(...(entityGeometry(t, e).pts ?? []));
      route.push(...(pathFollowPath(def, registry, e.id)?.pts ?? []));
    }
  }
  const box = outlineBounds(def, refs, look);
  const travelled = ptsBox(route);
  return box && travelled ? aabbUnion(box, travelled) : (box ?? travelled);
}

/** The box around a set of marks; `null` for none. */
export function marksBounds(
  outlines: OutlineMarks["outlines"],
  points: OutlineMarks["points"],
): Aabb | null {
  let box = ptsBox(points.map((p) => p.at));
  for (const o of outlines) box = box ? aabbUnion(box, aabb(o.shape)) : aabb(o.shape);
  return box;
}
