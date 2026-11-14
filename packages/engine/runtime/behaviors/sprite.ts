import { drawSprite, type SceneView, type SpriteVisual, type ViewLayer } from "../../context";
import type { BehaviorBlock, BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import {
  SPRITE,
  spriteAssets,
  spriteGeometry,
  spriteOffset,
  type SpriteBlock,
} from "../../game/behaviors/sprite";
import type { LookChannel } from "../../game/behaviors/tween";
import { styleOf } from "../../game/style";
import type { EngineContext } from "../../game/types";
import { pxPerMetreOf } from "../../game/units";
import type { Pt, RuntimeEntity } from "../../scene/types";
import { entityHomeLayer } from "../../systems/bodies";
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
  /**
   * Draws `frame` of the block's atlas in place of the block's own `frame`,
   * keeping its pose; an update of the block keeps it, a detach drops it.
   * Ignored for an entity without a sprite.
   */
  setFrame(id: string, frame: string): void;
  /**
   * Draws the sprite with `look` over the block's alpha and tint and its
   * size scaled, merged into what earlier calls gave; an update of the
   * block keeps it, a detach drops it. Ignored for an entity without a sprite.
   */
  style(id: string, look: SpriteLook): void;
};

/** What a tween animates of a sprite: `scale` multiplies its drawn size. */
export type SpriteLook = { [C in LookChannel]?: number };

const WHITE = 0xffffff;

/** The view id an entity's sprite draws under. */
export const spriteViewId = (entityId: string): string => `${entityId}#${SPRITE.name}`;

type Attached = {
  entity: RuntimeEntity;
  block: SpriteBlock;
  layer: ViewLayer;
  /** The frame `setFrame` gave, drawn in place of the block's. */
  frame: string | undefined;
  /** What `style` gave, drawn over the block's look. */
  look: SpriteLook;
  /** The block's offset as it writes it. */
  offset: Pt;
  turn: boolean;
  /** The pose-index pose the sprite was last posed from. */
  applied: Readonly<Pose> | null;
};

const samePose = (a: Readonly<Pose>, b: Readonly<Pose>) =>
  a.x === b.x && a.y === b.y && a.rot === b.rot;

const materialOf = (ctx: EngineContext, e: RuntimeEntity) =>
  typeof e.material === "string" ? ctx.registry.materials.get(e.material) : undefined;

/** A block's tint: its own, else the entity's material's, else none. */
const blockTint = (ctx: EngineContext, e: RuntimeEntity, block: Partial<SpriteBlock>) =>
  block.tint ?? materialOf(ctx, e)?.tint;

/**
 * The look `e`'s sprite block draws with before any `style`: its alpha
 * (default 1), its tint (default white) and scale 1. What a tween of a
 * visual channel starts from when it gives no `from`.
 */
export function spriteLook(ctx: EngineContext, e: RuntimeEntity): Required<SpriteLook> {
  const block = (e.behaviors?.[SPRITE.name] ?? {}) as Partial<SpriteBlock>;
  return { alpha: block.alpha ?? 1, tint: blockTint(ctx, e, block) ?? WHITE, scale: 1 };
}

/**
 * The visual a block draws for `e`, its flips toggled by the entity's
 * transform. Tint and blend are the block's, else the entity's material's
 * (`registry.materials`, so a project material without physics lends
 * none), else unset; `look` goes over its alpha and tint and scales its size.
 */
function visualOf(
  ctx: EngineContext,
  e: RuntimeEntity,
  block: SpriteBlock,
  look: SpriteLook,
): SpriteVisual {
  const flipped = e.transform?.flip ?? false;
  const flipX = (block.flipX ?? false) !== flipped;
  const flipY = block.flipY ?? false;
  const project = ctx.project;
  const { info, texture } = spriteAssets(
    project ? (id, frame) => project.asset(id, frame) : undefined,
    block,
  );
  const pxPerMetre = pxPerMetreOf(ctx.registry);
  let geometry = spriteGeometry({ ...block, flipX, flipY }, info, pxPerMetre);
  if (look.scale !== undefined && look.scale !== 1) {
    const size: [number, number] = [geometry.size[0] * look.scale, geometry.size[1] * look.scale];
    geometry = spriteGeometry({ ...block, flipX, flipY, size }, info, pxPerMetre);
  }
  const material = typeof e.material === "string" ? e.material : undefined;
  const materialDef = materialOf(ctx, e);
  const tint = look.tint ?? blockTint(ctx, e, block);
  const alpha = look.alpha ?? block.alpha;
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
    ...(alpha !== undefined ? { alpha } : {}),
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
 * sized in metres (a frame's px over the game's px per metre by default),
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

  function draw(id: string, a: Attached): void {
    const block = a.frame === undefined ? a.block : { ...a.block, frame: a.frame };
    drawSprite(view, spriteViewId(id), visualOf(ctx, a.entity, block, a.look), a.layer);
  }

  function show(id: string, block: SpriteBlock, entity: RuntimeEntity): void {
    const a: Attached = {
      entity,
      block,
      layer: entityHomeLayer(ctx, id, entity),
      frame: attached.get(id)?.frame,
      look: attached.get(id)?.look ?? {},
      offset: spriteGeometry(block).offset,
      turn: block.turn !== false,
      applied: null,
    };
    draw(id, a);
    view.depth?.(spriteViewId(id), entity.z ?? 0);
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
    setFrame(id, frame) {
      const a = attached.get(id);
      if (!a || a.frame === frame) return;
      a.frame = frame;
      draw(id, a);
    },
    style(id, look) {
      const a = attached.get(id);
      if (!a) return;
      const next = { ...a.look, ...look };
      if (next.alpha === a.look.alpha && next.tint === a.look.tint && next.scale === a.look.scale)
        return;
      a.look = next;
      draw(id, a);
    },
    clear() {
      for (const id of [...attached.keys()]) hide(id);
    },
    size: () => attached.size,
  };
  return system as SpriteSystem;
};
