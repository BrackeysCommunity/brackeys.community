import type { ViewLayer } from "../../context";
import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { EmitterBlock } from "../../game/behaviors/emitter";
import { spriteOffset } from "../../game/behaviors/sprite";
import type { EngineContext } from "../../game/types";
import { EMITTER_KIND, type EmitterFile } from "../../project/kinds/emitter";
import type { RuntimeEntity } from "../../scene/types";
import { entityHomeLayer } from "../../systems/bodies";
import { lerpPose, type Pose } from "../poses";

type Attached = { entity: RuntimeEntity; block: EmitterBlock; layer: ViewLayer };

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
 * the project has emits nothing.
 */
export const createEmitterSystem: BehaviorSystemFactory = (ctx) => {
  if (ctx.view === null)
    throw new Error("the emitter system draws through a view; headless runs build none");
  const view = ctx.view;
  const attached = new Map<string, Attached>();
  /** Each entity's pose as the last rendered frame placed it. */
  const framed = new Map<string, Pose>();

  function at(id: string): Pose | undefined {
    const a = attached.get(id);
    const pose = framed.get(id) ?? ctx.poses.get(id);
    if (!a || !pose) return undefined;
    const offset = a.block.offset;
    if (!offset) return pose;
    const [dx, dy] = spriteOffset([offset[0], offset[1]], a.entity.transform, pose.rot);
    return { x: pose.x + dx, y: pose.y + dy, rot: pose.rot };
  }

  function start(id: string, a: Attached): void {
    const layer = view.particles?.();
    if (!layer) return;
    const preset = emitterPreset(ctx, a.block.preset);
    if (!preset || a.block.emitting === false) {
      layer.remove(id);
      return;
    }
    const rate = a.block.rate;
    layer.emitter(id, rate === undefined ? preset : { ...preset, rate }, () => at(id), a.layer);
  }

  function show(id: string, block: EmitterBlock, entity: RuntimeEntity): void {
    const a: Attached = { entity, block, layer: entityHomeLayer(ctx, id, entity) };
    attached.set(id, a);
    start(id, a);
  }

  function hide(id: string): void {
    if (!attached.delete(id)) return;
    framed.delete(id);
    view.particles?.()?.remove(id);
  }

  const system: BehaviorSystem<EmitterBlock> = {
    attach: show,
    update: (id, block, _prev, entity) => show(id, block, entity),
    detach: hide,
    render(alpha) {
      for (const id of attached.keys()) {
        const cur = ctx.poses.get(id);
        if (!cur) continue;
        framed.set(id, lerpPose(ctx.poses.prev(id) ?? cur, cur, alpha));
      }
    },
    reset() {
      for (const [id, a] of attached) start(id, a);
    },
    clear() {
      for (const id of [...attached.keys()]) hide(id);
    },
    size: () => attached.size,
  };
  return system as BehaviorSystem;
};
