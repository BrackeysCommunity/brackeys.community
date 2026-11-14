import type { ViewLayer } from "../../context";
import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { EmitterBlock } from "../../game/behaviors/emitter";
import { spriteOffset } from "../../game/behaviors/sprite";
import type { EngineContext, Style } from "../../game/types";
import { EMITTER_KIND, type EmitterFile } from "../../project/kinds/emitter";
import { editorLayerOf } from "../../scene/layers";
import type { RuntimeEntity, ShapeObj } from "../../scene/types";
import { entityHomeLayer } from "../../systems/bodies";
import { lerpPose, type Pose } from "../poses";
import { spawnPose } from "../spawn-pose";

type Attached = {
  entity: RuntimeEntity;
  block: EmitterBlock;
  layer: ViewLayer;
  /** The preset doc it last started from: another one restarts it. */
  started?: EmitterFile | undefined;
};

/** The view id of the glyph marking an emitter while editing. */
export const emitterGlyphId = (entityId: string): string => `${entityId}#emitter`;

/** A four-pointed spark, metres around the emitter's point. */
const GLYPH: ShapeObj = {
  type: "poly",
  pts: Array.from({ length: 8 }, (_, i) => {
    const r = i % 2 === 0 ? 0.22 : 0.07;
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
  }),
};
const GLYPH_STYLE: Style = { stroke: 0xff66cc, alpha: 0.9, strokeWidth: 2 };

/** The project's `emitter` preset `id`; undefined when there's no project or no such preset. */
export const emitterPreset = (
  ctx: Pick<EngineContext, "project">,
  id: string,
): EmitterFile | undefined => ctx.project?.doc?.<EmitterFile>(EMITTER_KIND, id);

/**
 * The `emitter` behavior's system: visual only, built with a view and never
 * headless. Each entity carrying the block runs an emitter on the view's
 * particle layer from its preset (`ctx.project.doc("emitter", …)`), on the
 * entity's draw layer, at its pose plus the block's offset, interpolated
 * between the last two ticks on each rendered frame. `emitting: false`
 * stops it, its particles living out their life; a block without a preset
 * the project has emits nothing. A block update restarts it only when its
 * preset (the id or the doc) changes or it starts emitting again; a new
 * `rate`, `offset` or layer carries on from where it was. While editing,
 * a spark glyph on the registry's editor-only layer marks the point it
 * emits from, whatever its preset; a registry without that layer draws none.
 */
export const createEmitterSystem: BehaviorSystemFactory = (ctx) => {
  if (ctx.view === null)
    throw new Error("the emitter system draws through a view; headless runs build none");
  const view = ctx.view;
  /** Where the glyphs draw; a view that can't order visuals can't hide them in Play, so it draws none. */
  const glyphLayer = view.depth ? editorLayerOf(ctx.registry.layers) : undefined;
  const attached = new Map<string, Attached>();
  /** Each entity's pose as the last rendered frame placed it. */
  const framed = new Map<string, Pose>();

  function offsetFrom(a: Attached, pose: Pose): Pose {
    const offset = a.block.offset;
    if (!offset) return pose;
    const [dx, dy] = spriteOffset([offset[0], offset[1]], a.entity.transform, pose.rot);
    return { x: pose.x + dx, y: pose.y + dy, rot: pose.rot };
  }

  function at(id: string): Pose | undefined {
    const a = attached.get(id);
    const pose = framed.get(id) ?? ctx.poses.get(id);
    return a && pose ? offsetFrom(a, pose) : undefined;
  }

  function placeGlyph(id: string, a: Attached): void {
    if (glyphLayer === undefined) return;
    const p = at(id) ?? offsetFrom(a, spawnPose(a.entity, ctx.registry));
    view.pose(emitterGlyphId(id), p.x, p.y, p.rot, true);
  }

  /** Runs `a`'s emitter: from its start when `restart` or its preset changed, else retuned as it runs. */
  function start(id: string, a: Attached, restart: boolean): void {
    const layer = view.particles?.();
    if (!layer) return;
    const preset = emitterPreset(ctx, a.block.preset);
    const fresh = restart || preset !== a.started;
    a.started = preset;
    if (!preset || a.block.emitting === false) {
      layer.remove(id);
      return;
    }
    const rate = a.block.rate;
    const tuned = rate === undefined ? preset : { ...preset, rate };
    if (!fresh && layer.retune(id, tuned, a.layer)) return;
    layer.emitter(id, tuned, () => at(id), a.layer);
  }

  function show(id: string, block: EmitterBlock, entity: RuntimeEntity, restart: boolean): void {
    const a: Attached = {
      entity,
      block,
      layer: entityHomeLayer(ctx, id, entity),
      started: attached.get(id)?.started,
    };
    attached.set(id, a);
    if (glyphLayer !== undefined) {
      view.draw(emitterGlyphId(id), GLYPH, GLYPH_STYLE, glyphLayer);
      view.depth?.(emitterGlyphId(id), entity.z ?? 0);
      placeGlyph(id, a);
    }
    start(id, a, restart);
  }

  function hide(id: string): void {
    if (!attached.delete(id)) return;
    framed.delete(id);
    view.particles?.()?.remove(id);
    if (glyphLayer !== undefined) view.remove(emitterGlyphId(id));
  }

  const system: BehaviorSystem<EmitterBlock> = {
    attach: (id, block, entity) => show(id, block, entity, true),
    update: (id, block, _prev, entity) => show(id, block, entity, false),
    detach: hide,
    render(alpha) {
      for (const [id, a] of attached) {
        const cur = ctx.poses.get(id);
        if (!cur) continue;
        framed.set(id, lerpPose(ctx.poses.prev(id) ?? cur, cur, alpha));
        placeGlyph(id, a);
      }
    },
    reset() {
      for (const [id, a] of attached) start(id, a, true);
    },
    clear() {
      for (const id of [...attached.keys()]) hide(id);
    },
    size: () => attached.size,
  };
  return system as BehaviorSystem;
};
