import {
  CONTACT_END,
  CONTACT_START,
  createPool,
  defineEntityType,
  defineGame,
  pointField,
  type EngineContext,
  type Pool,
} from "@jams/engine/game";
import { runPlaytest, type RapierModule } from "@jams/engine/headless";
import type { SceneDefinition } from "@jams/engine/scene";

export type ShuttleSnapshot = {
  /** Every contact start and end so far: `start west`, `end west`, … */
  bumps: string[];
  /** Sparks ever spawned; the pool hands disabled ones out again first. */
  sparks: number;
  /** Bumps that found both sparks still lit, so the pool's `max` gave none. */
  refused: number;
  /** Sparks lit right now, and the wall nearest the shuttle. */
  lit: number;
  nearest: string | undefined;
  /** Entities whose extent reaches into the yard's west half. */
  west: readonly string[];
};

const spark = defineEntityType({
  type: "spark",
  description: "A flash where the shuttle hits a buffer.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it flashes.") },
});

/** A shuttle runs between two buffers; each bump lights a spark from a pool of two. */
export const shuttleGame = defineGame<ShuttleSnapshot>({
  id: "shuttle",
  types: [spark],
  actions: [],
  world: { gravity: [0, 0] },
  createRuntime(ctx: EngineContext) {
    let bumps: string[] = [];
    let sparks = 0;
    let refused = 0;
    let pool: Pool | null = null;
    return {
      onLoad() {
        bumps = [];
        sparks = 0;
        refused = 0;
        // Watches, subscriptions and pools all end with the load: make them here.
        ctx.contacts.watch("shuttle", { type: "solid" });
        pool = createPool(ctx, {
          max: 2,
          spawn: () => {
            sparks++;
            const e = ctx.spawn({
              type: "spark",
              at: [0, 0],
              // `then: "disable"` hands the spark back to the pool when it runs out.
              behaviors: { lifetime: { ticks: 100, then: "disable" } },
            });
            return e.id;
          },
        });
        ctx.events.on(CONTACT_START, (e) => {
          bumps.push(`start ${e.other}`);
          const id = pool?.acquire();
          if (id) ctx.poses.set(id, e.at.x, e.at.y, 0, { snap: true });
          else refused++;
        });
        ctx.events.on(CONTACT_END, (e) => void bumps.push(`end ${e.other}`));
      },
      onUnload() {
        pool = null;
      },
      snapshot() {
        const at = ctx.poses.get("shuttle");
        return {
          bumps: [...bumps],
          sparks,
          refused,
          lit: ctx.query.count({ type: "spark" }),
          nearest: at ? ctx.query.nearest({ x: at.x, y: at.y }, { type: "solid" }) : undefined,
          west: ctx.query.inArea({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
        };
      },
    };
  },
});

const yard = (physics: "rapier" | "none"): SceneDefinition => ({
  v: 3,
  game: "shuttle",
  name: "yard",
  bounds: [0, 0, 200, 100],
  settings: { physics },
  entities: [
    { id: "west", type: "solid", shape: ["box", 6, 50, 6, 30] },
    { id: "east", type: "solid", shape: ["box", 194, 50, 6, 30] },
    {
      id: "shuttle",
      type: "follower",
      shape: ["circle", 0, 0, 8],
      // Each end runs 4 px into a buffer, so the shuttle touches it there.
      path: {
        pts: [
          [16, 50],
          [184, 50],
        ],
        mode: "ping_pong",
        speed: 240,
      },
    },
  ],
});

/** Five seconds of shuttling, with Rapier or on the engine's own geometry. */
export function shuttle(rapier: RapierModule | null) {
  const run = runPlaytest<ShuttleSnapshot>({
    rapier,
    game: shuttleGame,
    scene: yard(rapier ? "rapier" : "none"),
    script: { v: 1, steps: [{ wait: 300 }] },
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return run.final!;
}
