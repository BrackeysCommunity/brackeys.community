import { DRAW_LAYERS, defineBehavior, defineGame, type BehaviorSystem } from "@jams/engine/game";
import { z } from "zod";

import { coinGame } from "./coin-game";

/** A ring drawn around the entity. Visual only: built with a view, never headless. */
export const halo = defineBehavior({
  name: "coin-game/halo",
  description: "A ring drawn around the entity.",
  visualOnly: true,
  fields: { radius: z.number().positive().default(0.24).describe("Ring radius, m; default 0.24.") },
  system(ctx): BehaviorSystem {
    const rings = new Set<string>();
    const ringOf = (id: string) => `${id}#halo`;
    return {
      attach(id, block) {
        rings.add(id);
        const r = Number(block.radius);
        const style = { stroke: 0xffd700, strokeWidth: 2 };
        ctx.view?.draw(ringOf(id), { type: "circle", cx: 0, cy: 0, r }, style, DRAW_LAYERS.overlay);
        // The runtime set the spawn pose before any behavior attached.
        const pose = ctx.poses.get(id);
        if (pose) ctx.view?.pose(ringOf(id), pose.x, pose.y, 0, true);
      },
      detach(id) {
        if (rings.delete(id)) ctx.view?.remove(ringOf(id));
      },
      // After the type systems' afterStep, so the poses are this tick's.
      step() {
        for (const id of rings) {
          const pose = ctx.poses.get(id);
          const prev = ctx.poses.prev(id);
          if (pose && (!prev || pose.x !== prev.x || pose.y !== prev.y))
            ctx.view?.pose(ringOf(id), pose.x, pose.y);
        }
      },
      clear() {
        for (const id of rings) ctx.view?.remove(ringOf(id));
        rings.clear();
      },
      size: () => rings.size,
    };
  },
});

export const haloGame = defineGame({
  ...coinGame,
  behaviors: [halo],
  createRuntime(ctx) {
    const inner = coinGame.createRuntime(ctx);
    return {
      ...inner,
      onLoad(scene) {
        inner.onLoad?.(scene);
        // Undefined headless: a visual-only behavior's system isn't built there.
        const rings = ctx.behavior(halo.name)?.size() ?? 0;
        if (rings > 0) console.log(`${rings} haloed entities`);
      },
    };
  },
});
