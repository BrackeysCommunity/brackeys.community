import {
  defineEntityType,
  defineGame,
  pointField,
  type EngineContext,
  type GameDefinition,
  type SceneSystem,
} from "@jams/engine/game";
import type { Pt, RuntimeEntity, SceneIssue } from "@jams/engine/scene";
import { z } from "zod";

type Crate = RuntimeEntity<{ at: Pt; w: number }>;
type Runner = RuntimeEntity<{ at: Pt; speed: number }>;

export type LedgeSnapshot = { x: number; respawns: number; swaps: string[] };

/** Poses each entity where the scene puts it; the game's runtime moves them from there. */
const posed = <E extends RuntimeEntity<{ at: Pt }>>(ctx: EngineContext): SceneSystem<E> => {
  const ids = new Set<string>();
  return {
    spawn(e) {
      ids.add(e.id);
      ctx.poses.set(e.id, e.at[0], e.at[1], 0, { snap: true });
    },
    despawn: (id) => void ids.delete(id),
    clear: () => ids.clear(),
    size: () => ids.size,
  };
};

const runner = defineEntityType({
  type: "runner",
  description: "Runs right, hops every crate, and starts again from its spot past the right edge.",
  fields: {
    at: pointField("Where it starts."),
    speed: z.number().positive().default(2).describe("Metres a second."),
  },
  system: (ctx) => posed<Runner>(ctx),
});

const crate = defineEntityType({
  type: "crate",
  description: "A crate the runner hops; nothing may stand inside one.",
  fields: {
    at: pointField("Its centre."),
    w: z.number().positive().default(1).describe("Its width, m."),
  },
  system: (ctx) => posed<Crate>(ctx),
});

/** The crate whose span holds `x`. */
function crateAt(ctx: EngineContext, x: number): Crate | undefined {
  for (const id of ctx.query.select({ type: "crate" })) {
    const c = ctx.get(id) as Crate | undefined;
    if (c && Math.abs(x - c.at[0]) < c.w / 2) return c;
  }
  return undefined;
}

const beyond = (c: Crate) => c.at[0] + c.w / 2;

/** The ledge game; `freeOnSwap: false` leaves out the `onSwap` that lifts the runner out of a new crate. */
export function makeLedge({ freeOnSwap = true } = {}): GameDefinition<LedgeSnapshot> {
  return defineGame<LedgeSnapshot>({
    id: "ledge",
    types: [runner, crate],
    actions: [],
    world: { physics: "none" },
    live: {
      timings: ["next-load", "boundary", "now"],
      // Run by the swap check and Live in Play right after a swap, and again later.
      check(ctx) {
        const issues: SceneIssue[] = [];
        for (const id of ctx.query.select({ type: "runner" })) {
          const c = crateAt(ctx, ctx.poses.get(id)!.x);
          if (!c) continue;
          issues.push({
            severity: "error",
            code: "ledge/stuck",
            message: `${id} is inside ${c.id}`,
            entityIds: [id, c.id],
          });
        }
        return issues;
      },
    },
    createRuntime(ctx) {
      let respawns = 0;
      const swaps: string[] = [];
      const runners = () => ctx.query.select({ type: "runner" });
      return {
        beforeStep(dtMs) {
          for (const id of runners()) {
            const r = ctx.get(id) as Runner;
            const { y } = ctx.poses.get(id)!;
            let x = ctx.poses.get(id)!.x + (r.speed * dtMs) / 1000;
            let snap = false;
            if (x > ctx.bounds[2]) {
              x = r.at[0];
              snap = true;
              respawns++;
              // A respawn is a safe moment: a "boundary" update applies after this tick.
              ctx.live.boundary("respawn");
            }
            const c = crateAt(ctx, x);
            if (c) x = beyond(c);
            ctx.poses.set(id, x, y, 0, { snap });
          }
        },
        ...(freeOnSwap
          ? {
              onSwap(swap) {
                swaps.push(`${swap.timing} ${swap.strategy} +${swap.diff.added.join(",")}`);
                for (const id of runners()) {
                  const { x, y } = ctx.poses.get(id)!;
                  const c = crateAt(ctx, x);
                  if (c) ctx.poses.set(id, beyond(c), y, 0, { snap: true });
                }
              },
            }
          : {}),
        snapshot: () => ({
          x: ctx.poses.get(runners()[0] ?? "")?.x ?? 0,
          respawns,
          swaps: [...swaps],
        }),
      };
    },
  });
}

export const ledgeGame = makeLedge();
