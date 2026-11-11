import {
  createGridStepper,
  defineGame,
  findPath,
  type Cell,
  type EngineContext,
  type GridStepper,
} from "@jams/engine/game";
import type { ExpandedScene, Pt } from "@jams/engine/scene";
import { z } from "zod";

export type WalkerSnapshot = { cell: Cell | null; walks: number; home: boolean };

const markerAt = (scene: ExpandedScene, tag: string) =>
  scene.entities.find(
    (e) => e.type === "marker" && (e.tags as string[] | undefined)?.includes(tag),
  );

/** A turn game with no physics: each `walk` command paths the hero over the grid, cell by cell. */
export const walkerGame = defineGame<WalkerSnapshot>({
  id: "walker",
  types: [],
  actions: [],
  time: { kind: "turns", rate: 30 },
  world: { physics: "none", grid: { kind: "square", cell: [32, 32] } },
  commands: {
    walk: {
      description: "Walk the hero to a cell along the shortest open path.",
      args: z.strictObject({ to: z.tuple([z.number().int(), z.number().int()]) }),
    },
  },
  play: {
    results: ["won"],
    outcome: ({ snapshot }) => (snapshot.home ? { result: "won" } : null),
  },
  createRuntime(ctx: EngineContext) {
    let goal: Pt | null = null;
    let stepper: GridStepper | null = null;
    let route: Cell[] = [];
    let walks = 0;

    const home = () => {
      if (!stepper || !goal || !ctx.grid) return false;
      const [c, r] = ctx.grid.geometry.cellAt(goal);
      const [hc, hr] = stepper.cell();
      return c === hc && r === hr && !stepper.moving();
    };

    return {
      onLoad(scene) {
        const hero = markerAt(scene, "hero");
        goal = (markerAt(scene, "goal")?.at as Pt | undefined) ?? null;
        route = [];
        walks = 0;
        stepper =
          hero && ctx.grid
            ? createGridStepper(ctx, hero.id, {
                start: ctx.grid.geometry.cellAt(hero.at as Pt),
                msPerStep: 150,
              })
            : null;
      },
      beforeStep(dtMs, _actions, commands) {
        const grid = ctx.grid;
        if (!grid || !stepper) return;
        stepper.update(dtMs);
        for (const command of commands) {
          if (command.name !== "walk") continue;
          const { to } = command.args as { to: [number, number] };
          const path = findPath(grid.geometry, stepper.cell(), to, {
            passable: (c) => grid.passable(c),
          });
          route = path?.cells.slice(1) ?? [];
          walks++;
        }
        const next = route[0];
        if (next && !stepper.moving() && stepper.step(next)) route.shift();
      },
      // While true, the clock keeps ticking at `time.rate` with no input.
      busy: () => route.length > 0 || (stepper?.moving() ?? false),
      snapshot: () => ({ cell: stepper?.cell() ?? null, walks, home: home() }),
    };
  },
});
