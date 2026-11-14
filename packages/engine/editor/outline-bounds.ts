import { isCameraRegionType } from "../game/primitives";
import type { Registry } from "../game/types";
import type { GridCells } from "../scene/grid";
import { growOverGrid, type SpriteAssetLookup } from "../scene/render-geometry";
import { gridFieldsOf } from "../scene/schema";
import { aabb, aabbBox, aabbUnion, regionBox } from "../scene/shape-geometry";
import type { Aabb, EntityDef, GridSettings, Pt, Ref, SceneDefinition } from "../scene/types";
import { pathFollowPath } from "./gizmos/behavior-marks";
import { editTree, type EditSource, type EditTree } from "./gizmos/tree";
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
  /** The document behind the view, which says what sits under a parent the view can't show: an instance under a node. */
  source?: EditSource;
  /** The view's tree, kept for the last view asked about, so a frame's outlines read it once. */
  tree?: (def: SceneDefinition) => EditTree;
};

/**
 * The look outlines are drawn and bounded with, sizing sprite boxes by
 * `asset` when given and reading the tree with `source`, the document
 * behind the view.
 */
export function outlineLook(
  registry: Registry,
  asset?: SpriteAssetLookup,
  source?: EditSource,
): OutlineLook {
  let last: { def: SceneDefinition; tree: EditTree } | undefined;
  return {
    registry,
    ...(asset ? { asset } : {}),
    ...(source ? { source } : {}),
    tree(def) {
      if (last?.def !== def) last = { def, tree: editTree(def, source) };
      return last.tree;
    },
  };
}

const treeOf = (look: OutlineLook, def: SceneDefinition): EditTree =>
  look.tree?.(def) ?? editTree(def, look.source);

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
 * its shape (a camera region's framed box), its sprite's box, its grid
 * cells' box, and without a shape its point.
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
  if (g.shape) {
    const region = isCameraRegionType(look.registry.types.get(type));
    out.outlines.push({ shape: region ? regionBox(g.shape) : g.shape, tone, ref: owner });
  }
  const sprite = editSpriteBox(look.registry, type, g, entity?.behaviors, look.asset);
  if (sprite) out.outlines.push({ shape: sprite.shape, tone, ref: owner });
  const grid = def.settings?.grid;
  const cells =
    !g.shape && g.at && grid && entity ? gridBox(grid, g.at, entity, look.registry) : null;
  if (cells) out.outlines.push({ shape: aabbBox(cells), tone, ref: owner });
  if (!g.shape && g.at && (!sprite || look.spritePoints !== false))
    out.points.push({ at: g.at, tone, ref: owner });
}

/** The entities `ref` names in `def`: the entity itself, then what sits under it (an instance's children for an instance). */
function entitiesOfRef(def: SceneDefinition, ref: Ref, tree: EditTree): EntityDef[] {
  const entities = def.entities ?? [];
  const own = entities.find((e) => e.id === ref);
  const below = new Set(tree.below([ref]));
  const under = below.size > 0 ? entities.filter((e) => below.has(e.id) && e !== own) : [];
  return own ? [own, ...under] : under;
}

/**
 * Whether `ref` stands for more than its own outline: an instance, or a
 * node with something under it. The selection's box is drawn around it.
 */
export function isComposite(
  def: SceneDefinition,
  ref: Ref,
  look?: Pick<OutlineLook, "source" | "tree">,
): boolean {
  const tree = look?.tree?.(def) ?? editTree(def, look?.source);
  if (tree.isInstance(ref)) return tree.below([ref]).length > 0;
  const own = (def.entities ?? []).find((e) => e.id === ref);
  return own?.type === "node" && tree.below([ref]).length > 0;
}

/**
 * Appends `ref`'s outlines in `def` (the resolved view, as previewed) to
 * `out`, each in its world pose: an entity's or bulk row's own geometry,
 * then everything under it in the tree, which moves and turns with it (an
 * instance's children for an instance). Sprite boxes are posed from `def`'s
 * geometry, so they follow a preview. Outlines carry `ref`.
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
  const entities = entitiesOfRef(def, ref, treeOf(look, def));
  if (own) {
    const entity = own.bulk ? undefined : entities[0];
    geometryMarks(def, own, own.type, entity, tone, ref, out, look);
  }
  for (const e of own && !own.bulk ? entities.slice(1) : entities) {
    const t = registry.types.get(e.type);
    if (t) geometryMarks(def, entityGeometry(t, e), e.type, e, tone, ref, out, look);
  }
}

/**
 * The box around what `refs` outline in `def`, by the tree: each with what
 * sits under it, an instance's children for an instance; `null` when none
 * of them draws. Framing and revealing a selection
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
  const tree = treeOf(look, def);
  for (const ref of refs) {
    for (const e of entitiesOfRef(def, ref, tree)) {
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
