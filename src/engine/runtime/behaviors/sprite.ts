import { DRAW_LAYERS, drawSprite, type SceneView, type SpriteVisual } from "../../context";
import type { BehaviorBlock, BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import {
  SPRITE,
  spriteAssets,
  spriteGeometry,
  spriteOffset,
  type SpriteBlock,
} from "../../game/behaviors/sprite";
import { styleOf } from "../../game/style";
import type { EngineContext } from "../../game/types";
import { parseBulkId } from "../../scene/bulk-ref";
import { defaultLayer } from "../../scene/layers";
import type { Pt, RuntimeEntity } from "../../scene/types";
import { entityDrawLayer } from "../../systems/bodies";
import type { Pose } from "../poses";
import { spawnPose } from "../spawn-pose";

/**
 * The sprite system has no `step`: the runtime calls `settle` after the
 * game's `afterStep`, so a pose any system wrote this tick, a game's
 * included, reaches the view before the tick is committed.
 */
export type SpriteSystem<B extends BehaviorBlock = BehaviorBlock> = BehaviorSystem<B> & {
  /** Re-poses every sprite whose entity's pose changed since it was last posed. */
  settle(): void;
};

/** The view id an entity's sprite draws under. */
export const spriteViewId = (entityId: string): string => `${entityId}#${SPRITE.name}`;

type Attached = {
  entity: RuntimeEntity;
  /** The block's offset as it writes it. */
  offset: Pt;
  turn: boolean;
  /** The pose-index pose the sprite was last posed from. */
  applied: Readonly<Pose> | null;
};

const samePose = (a: Readonly<Pose>, b: Readonly<Pose>) =>
  a.x === b.x && a.y === b.y && a.rot === b.rot;

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
  const project = ctx.project;
  const { info, texture } = spriteAssets(
    project ? (id, frame) => project.asset(id, frame) : undefined,
    block,
  );
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
    const [dx, dy] = spriteOffset(a.offset, a.entity.transform, a.turn ? pose.rot : null);
    view.pose(spriteViewId(id), pose.x + dx, pose.y + dy, a.turn ? pose.rot : 0, snap);
    a.applied = pose;
  }

  function show(id: string, block: SpriteBlock, entity: RuntimeEntity): void {
    const sid = spriteViewId(id);
    // An entity naming no layer, or an unknown one, draws on its type's default layer.
    const { layers, types } = ctx.registry;
    const home = defaultLayer(types.get(entity.type), parseBulkId(id) !== null, layers);
    const fallback = layers.find((l) => l.name === home)?.draw ?? DRAW_LAYERS.body;
    drawSprite(view, sid, visualOf(ctx, entity, block), entityDrawLayer(ctx, entity, fallback));
    view.depth?.(sid, entity.z ?? 0);
    const a: Attached = {
      entity,
      offset: spriteGeometry(block).offset,
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

  const system: SpriteSystem<SpriteBlock> = {
    attach: (id, block, entity) => show(id, block, entity),
    update: (id, block, _prev, entity) => show(id, block, entity),
    detach: hide,
    settle() {
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
  return system as SpriteSystem;
};
