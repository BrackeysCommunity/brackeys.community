import {
  defineEntityType,
  defineGame,
  ENTITY_DESTROYED,
  pointField,
  type EngineContext,
} from "@jams/engine/game";
import type { Prefab, SceneDefinition } from "@jams/engine/scene";
import { z } from "zod";

export const DRY = "fountain:dry";
/** Drops each spout lets fall before the fountain runs dry. */
export const DROPS = 8;

export type FountainSnapshot = {
  /** Drops destroyed so far: each `lifetime` ran out. */
  fell: number;
  live: number;
  /** The sum of every drop's sideways jitter, so a seed's draws show in the digest. */
  jitter: number;
  dry: boolean;
};

const spout = defineEntityType({
  type: "spout",
  description: "Where drops fall from.",
  base: "marker",
  fields: { at: pointField("The spout's mouth, absolute world px.") },
});

const drop = defineEntityType({
  type: "drop",
  description: "A drop of water; game code spawns it, a scene can't place it.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it is.") },
});

/** Every spout drips a drop each quarter second; each drop lasts a second; then the fountain runs dry. */
export const fountainGame = defineGame<FountainSnapshot>({
  id: "fountain",
  types: [spout, drop],
  actions: [],
  world: { physics: "none" },
  commands: {
    spill: {
      description: "Spill one drop under the first spout, with this id when given.",
      args: z.strictObject({ id: z.string().optional() }),
    },
    pour: {
      description: "Place a prefab of spouts above the basin.",
      args: z.strictObject({ prefab: z.string() }),
    },
  },
  play: {
    results: ["dry"],
    outcome: ({ snapshot }) => (snapshot.dry && snapshot.live === 0 ? { result: "dry" } : null),
  },
  createRuntime(ctx: EngineContext) {
    let snap: FountainSnapshot = { fell: 0, live: 0, jitter: 0, dry: false };
    // A fork per purpose: drawing more for one never shifts the other's numbers.
    let drift = ctx.random.fork("drift");

    const fall = (from: string, id?: string) => {
      const pose = ctx.poses.get(from);
      if (!pose) return;
      const dx = drift.range(-6, 6);
      snap.jitter += dx;
      ctx.spawn({
        type: "drop",
        ...(id ? { id } : {}),
        at: [pose.x + dx, pose.y + 8],
        behaviors: { lifetime: { ms: 1000 } },
      });
    };

    return {
      onLoad() {
        snap = { fell: 0, live: 0, jitter: 0, dry: false };
        drift = ctx.random.fork("drift");
        ctx.events.on(ENTITY_DESTROYED, (e) => {
          if ((e.data as { type?: string } | undefined)?.type === "drop") snap.fell++;
        });
        ctx.events.on(DRY, () => void (snap.dry = true));
        ctx.timers.every({ ms: 250 }, () => ctx.query.byType("spout").forEach((s) => fall(s)), {
          times: DROPS,
        });
        // The emit form: a plain event, so a snapshot of pending timers could save it.
        ctx.timers.after({ ms: 250 * DROPS + 1000 }, { emit: DRY, data: { drops: DROPS } });
      },
      beforeStep(_dtMs, _actions, commands) {
        for (const c of commands) {
          if (c.name === "spill") {
            const first = ctx.query.byType("spout")[0];
            if (first) fall(first, (c.args as { id?: string }).id);
          }
          if (c.name === "pour") {
            const { prefab } = c.args as { prefab: string };
            ctx.instantiate(prefab, [ctx.bounds[2] / 2, 16]);
          }
        }
      },
      snapshot: () => ({ ...snap, live: ctx.query.count({ type: "drop" }) }),
    };
  },
});

/** A basin with one spout over it. */
export const basin: SceneDefinition = {
  v: 3,
  game: "fountain",
  name: "basin",
  bounds: [0, 0, 160, 120],
  entities: [{ id: "spout", type: "spout", at: [80, 40] }],
};

/** Two spouts side by side, for `pour`. */
export const twinSpout: Prefab = {
  kind: "prefab",
  v: 3,
  game: "fountain",
  id: "twin-spout",
  entities: [
    { id: "left", type: "spout", at: [-24, 0] },
    { id: "right", type: "spout", at: [24, 0] },
  ],
};
