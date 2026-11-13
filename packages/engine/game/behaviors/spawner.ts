/**
 * The `spawner` behavior's schema: an entity that emits entities of a type
 * or instances of a prefab. Zod only; the system lives in
 * `runtime/behaviors/spawner.ts`.
 */
import { z } from "zod";

import { defineBehavior, type BehaviorSystem } from "../behaviors";
import { assetField, ID_PATTERN } from "../fields";
import type { FieldEnv } from "../types";

const spawnerFields = (env: FieldEnv) => ({
  type: z
    .string()
    .regex(ID_PATTERN)
    .optional()
    .describe("The entity type it spawns, spawn-only types included; give this or `prefab`.")
    .meta({ title: "Type", group: "spawn", widget: "type" }),
  fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "The fields each spawn of `type` gets, as a scene entity of that type writes them (a shape type's `shape`); its shapes, points and paths are relative to the spawn point. Without a shape, point or path, a spawn stands at the spawn point by its `at`.",
    )
    .meta({ title: "Fields", group: "spawn" }),
  prefab: assetField(env, "prefab", "The prefab it places; give this or `type`.")
    .optional()
    .meta({ title: "Prefab", group: "spawn" }),
  rate: z
    .number()
    .min(0)
    .default(1)
    .describe("Spawns a second while active and under the cap. Default 1.")
    .meta({ title: "Rate", unit: "/s", group: "spawn" }),
  cap: z
    .number()
    .int()
    .min(0)
    .default(10)
    .describe("The most of its spawns alive at once. Default 10.")
    .meta({ title: "Cap", group: "spawn" }),
  burst: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("How many it spawns at once when it starts, within the cap. Default 0.")
    .meta({ title: "Burst", group: "spawn" }),
  lifeMs: z
    .number()
    .positive()
    .optional()
    .describe("Each spawn goes this long after it appears, ms; omitted, spawns stay.")
    .meta({ title: "Lifetime", unit: "ms", group: "spawn" }),
  spread: z
    .number()
    .min(0)
    .default(0)
    .describe(
      "Spawns appear at a random point within this radius of the entity's pose, m; 0 at the pose. Default 0.",
    )
    .meta({ title: "Spread", unit: "m", group: "placement" }),
  velocity: z
    .tuple([
      z.number().describe("x, m/s.").meta({ unit: "m/s" }),
      z.number().describe("y, m/s; y is down.").meta({ unit: "m/s" }),
    ])
    .optional()
    .describe("The velocity a spawn with a dynamic body starts with, m/s; turns with the entity.")
    .meta({ title: "Velocity", unit: "m/s", kind: "vector", group: "placement" }),
  active: z
    .boolean()
    .default(true)
    .describe("Whether it spawns; false holds it, and a block update starts it. Default true.")
    .meta({ title: "Active", group: "spawn" }),
});

/** A `spawner` block as an entity carries it, defaults applied. */
export type SpawnerBlock = z.infer<z.ZodObject<ReturnType<typeof spawnerFields>>>;

export type SpawnerSystem = BehaviorSystem<SpawnerBlock> & {
  /** The runtime ids of its spawns still alive, oldest first; an instance counts once, by its id. */
  live(entityId: string): readonly string[];
};

/** What a spawn's id, type and sublevel come from: the spawner, never its `fields`. */
const SPAWN_OWN_KEYS = Object.freeze(["id", "type", "sublevel"] as const);

export const SPAWNER = defineBehavior({
  name: "spawner",
  description:
    "Spawns entities of a type, or instances of a prefab, at a rate up to a cap of live ones; raises spawner:spawned for each.",
  fields: spawnerFields,
  inspector: {
    category: "world",
    label: "Spawner",
    order: [
      "type",
      "fields",
      "prefab",
      "rate",
      "cap",
      "burst",
      "lifeMs",
      "spread",
      "velocity",
      "active",
    ],
  },
  template: { type: "marker" },
  refine(block) {
    const given = (block.type === undefined ? 0 : 1) + (block.prefab === undefined ? 0 : 1);
    if (given !== 1) return "spawner takes exactly one of `type` or `prefab`";
    if (block.fields === undefined) return undefined;
    if (block.type === undefined) return "spawner's `fields` go with `type`, not `prefab`";
    const own = SPAWN_OWN_KEYS.filter((k) => Object.hasOwn(block.fields as object, k));
    return own.length === 0
      ? undefined
      : `spawner's \`fields\` can't set ${own.map((k) => `\`${k}\``).join(", ")}: the spawner gives each spawn its own`;
  },
});
