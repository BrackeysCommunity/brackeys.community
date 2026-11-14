import { DRAW_LAYERS, type ViewLayer } from "../../context";
import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { EmitterBlock } from "../../game/behaviors/emitter";
import { spriteOffset } from "../../game/behaviors/sprite";
import { EMITTER_KIND, type EmitterFile } from "../../project/kinds/emitter";
import { parseBulkId } from "../../scene/bulk-ref";
import { defaultLayer } from "../../scene/layers";
import type { RuntimeEntity } from "../../scene/types";
import { entityDrawLayer } from "../../systems/bodies";
import type { Pose } from "../poses";

type Attached = { entity: RuntimeEntity; block: EmitterBlock; layer: ViewLayer };

const TAU = Math.PI * 2;

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

  const layerOf = (id: string, entity: RuntimeEntity): ViewLayer => {
    const { layers, types } = ctx.registry;
    const home = defaultLayer(types.get(entity.type), parseBulkId(id) !== null, layers);
    return entityDrawLayer(
      ctx,
      entity,
      layers.find((l) => l.name === home)?.draw ?? DRAW_LAYERS.body,
    );
  };

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
    const preset = ctx.project?.doc?.<EmitterFile>(EMITTER_KIND, a.block.preset);
    if (!preset || a.block.emitting === false) {
      layer.remove(id);
      return;
    }
    const rate = a.block.rate;
    layer.emitter(id, rate === undefined ? preset : { ...preset, rate }, () => at(id), a.layer);
  }

  function show(id: string, block: EmitterBlock, entity: RuntimeEntity): void {
    const a: Attached = { entity, block, layer: layerOf(id, entity) };
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
        const prev = ctx.poses.prev(id) ?? cur;
        const turn = ((((cur.rot - prev.rot) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
        framed.set(id, {
          x: prev.x + (cur.x - prev.x) * alpha,
          y: prev.y + (cur.y - prev.y) * alpha,
          rot: prev.rot + turn * alpha,
        });
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
