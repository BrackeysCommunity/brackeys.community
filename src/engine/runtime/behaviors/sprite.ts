import { DRAW_LAYERS, drawSprite, type SceneView, type SpriteVisual } from "../../context";
import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import { SPRITE, spriteGeometry, type SpriteBlock } from "../../game/behaviors/sprite";
import { styleOf } from "../../game/style";
import type { EngineContext } from "../../game/types";
import type { AssetInfo } from "../../project/asset-info";
import { ATLAS_KIND } from "../../project/kinds/atlas";
import { parseBulkId } from "../../scene/bulk-ref";
import { defaultLayer } from "../../scene/layers";
import { applyVec, dihedral } from "../../scene/transform";
import type { Pt, RuntimeEntity } from "../../scene/types";
import { spawnPose, type Pose } from "../poses";

/** The view id an entity's sprite draws under. */
export const spriteViewId = (entityId: string): string => `${entityId}#${SPRITE.name}`;

type Attached = {
  entity: RuntimeEntity;
  /** The block's offset with the entity's flip applied, before any turn. */
  offset: Pt;
  turn: boolean;
  /** The pose-index pose the sprite was last posed from. */
  applied: Readonly<Pose> | null;
};

const samePose = (a: Readonly<Pose>, b: Readonly<Pose>) =>
  a.x === b.x && a.y === b.y && a.rot === b.rot;

/** The scene layer's draw order for `e`: its `layer`, else its type's default. */
function drawOrder(ctx: EngineContext, e: RuntimeEntity): number {
  const { layers, types } = ctx.registry;
  const fallback = defaultLayer(types.get(e.type), parseBulkId(e.id) !== null, layers);
  const layer =
    layers.find((l) => l.name === (e.layer ?? fallback)) ?? layers.find((l) => l.name === fallback);
  return layer?.draw ?? DRAW_LAYERS.body;
}

/**
 * The asset the block draws and the texture it cuts: a texture is both; an
 * atlas's frame info and its texture's. An atlas without a known frame
 * draws no texture.
 */
function assetsOf(
  ctx: EngineContext,
  block: SpriteBlock,
): { info?: AssetInfo; texture?: AssetInfo } {
  const project = ctx.project;
  if (!project || block.asset === undefined) return {};
  const own = project.asset(block.asset);
  if (!own) return {};
  if (own.kind !== ATLAS_KIND) return { info: own, texture: own };
  const info = block.frame === undefined ? undefined : project.asset(block.asset, block.frame);
  const texture = own.texture === undefined ? undefined : project.asset(own.texture);
  return info ? { info, ...(texture ? { texture } : {}) } : {};
}

/**
 * The visual a block draws for `e`, its flips toggled by the entity's
 * transform. Tint and blend are the block's, else the entity's material's
 * (`registry.materials`, so a project material without physics lends
 * none), else unset.
 */
function visualOf(ctx: EngineContext, e: RuntimeEntity, block: SpriteBlock): SpriteVisual {
  const flipped = e.transform?.flip ?? false;
  const flipX = (block.flipX ?? false) !== flipped;
  const flipY = block.flipY ?? false;
  const { info, texture } = assetsOf(ctx, block);
  const geometry = spriteGeometry({ ...block, flipX, flipY }, info);
  const material = typeof e.material === "string" ? e.material : undefined;
  const materialDef = material === undefined ? undefined : ctx.registry.materials.get(material);
  const tint = block.tint ?? materialDef?.tint;
  const blend = block.blend ?? materialDef?.blend;
  const nineSlice = block.nineSlice ?? (info === texture ? info?.nineSlice : undefined);
  const type = ctx.registry.types.get(e.type);
  const style = (type && styleOf(ctx, type, material)) ?? {};
  return {
    texture: texture?.sha256 ?? null,
    ...(geometry.frame ? { frame: geometry.frame } : {}),
    size: geometry.size,
    anchor: geometry.anchor,
    ...(tint !== undefined ? { tint } : {}),
    ...(block.alpha !== undefined ? { alpha: block.alpha } : {}),
    ...(flipX ? { flipX } : {}),
    ...(flipY ? { flipY } : {}),
    ...(blend !== undefined ? { blend } : {}),
    ...(block.tile ? { tile: true } : {}),
    ...(nineSlice ? { nineSlice: [nineSlice[0], nineSlice[1], nineSlice[2], nineSlice[3]] } : {}),
    sampling: texture?.filter ?? ctx.sampling,
    fallback: { shape: geometry.box, style },
  };
}

/** Rotates `v` by `rot` radians, clockwise on screen. */
function rotate(v: Pt, rot: number): Pt {
  if (rot === 0) return v;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

/**
 * The sprite system: one sprite per entity carrying a `sprite` block,
 * drawn on its layer's draw order and posed at its pose-index pose plus
 * the offset. The offset is mirrored by the entity's flip and turned by
 * the pose's angle, or with `turn: false` by the entity's quarter turns
 * only, the sprite itself then unturned. Visual-only: built only with a
 * view, and it writes nothing but the view.
 */
export const createSpriteSystem: BehaviorSystemFactory = (ctx) => {
  if (ctx.view === null)
    throw new Error("the sprite system draws through a view; headless runs build none");
  const view: SceneView = ctx.view;
  const attached = new Map<string, Attached>();

  function place(id: string, a: Attached, pose: Readonly<Pose>, snap: boolean): void {
    const [dx, dy] = a.turn
      ? rotate(a.offset, pose.rot)
      : applyVec(dihedral({ rot: a.entity.transform?.turn ?? 0, flip: false }, [0, 0]), a.offset);
    view.pose(spriteViewId(id), pose.x + dx, pose.y + dy, a.turn ? pose.rot : 0, snap);
    a.applied = pose;
  }

  function show(id: string, block: SpriteBlock, entity: RuntimeEntity): void {
    const sid = spriteViewId(id);
    drawSprite(view, sid, visualOf(ctx, entity, block), drawOrder(ctx, entity));
    view.depth?.(sid, entity.z ?? 0);
    const offset = spriteGeometry(block).offset;
    const a: Attached = {
      entity,
      offset: entity.transform?.flip ? [-offset[0] + 0, offset[1]] : offset,
      turn: block.turn !== false,
      applied: null,
    };
    attached.set(id, a);
    place(id, a, ctx.poses.get(id) ?? spawnPose(entity, ctx.registry), true);
  }

  function hide(id: string): void {
    if (!attached.delete(id)) return;
    view.remove(spriteViewId(id));
  }

  const system: BehaviorSystem<SpriteBlock> = {
    attach: (id, block, entity) => show(id, block, entity),
    update: (id, block, _prev, entity) => show(id, block, entity),
    detach: hide,
    step() {
      for (const [id, a] of attached) {
        const pose = ctx.poses.get(id);
        if (!pose || (a.applied && samePose(pose, a.applied))) continue;
        const prev = ctx.poses.prev(id);
        place(id, a, pose, prev !== undefined && samePose(prev, pose));
      }
    },
    clear() {
      for (const id of [...attached.keys()]) hide(id);
    },
    size: () => attached.size,
  };
  return system as BehaviorSystem;
};
