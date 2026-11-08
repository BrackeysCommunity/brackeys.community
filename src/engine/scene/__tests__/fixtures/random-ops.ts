import { z } from "zod";

import { testGame } from "../../../__tests__/fixtures/test-game";
import { BEHAVIORS_FIELD } from "../../../game/behaviors";
import { createRegistry, defineEntityType, defineGame } from "../../../game/define";
import { pointField, shapeField, tagsField } from "../../../game/fields";
import type { Registry } from "../../../game/types";
import { prefabLibrary } from "../../prefab";
import { geometryFields } from "../../schema";
import type {
  CellEdit,
  CellRect,
  PrefabLibrary,
  PrefabParam,
  SceneDefinition,
  SceneOp,
} from "../../types";

/**
 * Registries, scenes and a seeded op generator shared by the property tests
 * of `applyOps` and of the live doc that applies the same batches.
 */

export const engine = createRegistry();

/** A game with a box-only shape bulk type, a point bulk type, a ref field, a material and a setting. */
export const fake = createRegistry(
  defineGame({
    id: "fake",
    types: [
      defineEntityType({
        type: "ledge",
        description: "A box-only platform.",
        base: "solid",
        fields: {
          shape: shapeField("Ledge box.", { types: ["box"], id: "LedgeShape", owner: "a ledge's" }),
        },
        bulk: { form: "shape", description: "Ledges, absolute px." },
      }),
      defineEntityType({
        type: "peg",
        description: "A point to hang from.",
        base: "marker",
        fields: { at: pointField("Peg position."), tags: tagsField("Labels.") },
        bulk: { form: "point", description: "Pegs, absolute px." },
      }),
      defineEntityType({
        type: "lever",
        description: "Starts a follower.",
        base: "marker",
        fields: {
          at: pointField("Lever position."),
          target: z.string().optional().describe("The follower or peg it works."),
        },
        refs: [{ field: "target", targets: ["follower", "peg"] }],
      }),
    ],
    materials: { ice: { friction: 0.05, restitution: 0, description: "Slippery." } },
    settings: { wind: z.number().optional().describe("Sideways push, px/s².") },
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

export type YardPrefabOptions = {
  /** Expose parameters: the gate's door `speed` and `pause`, the post's `top`. */
  params?: boolean;
};

const YARD_PARAMS: Record<string, Record<string, PrefabParam>> = {
  gate: {
    pause: { description: "Door pause, ms.", targets: ["door.path.pauseMs"] },
    speed: { description: "Door speed, px/s.", targets: ["door.path.speed"], default: 60 },
  },
  post: { top: { description: "Where the top sits.", targets: ["top.at"], default: [0, -40] } },
};

/** The prefabs the yards place: a gate (a follower door, a sensor, a bulk sill) and a post. */
export function yardPrefabs(game?: string, options: YardPrefabOptions = {}): PrefabLibrary {
  const home = game !== undefined ? { game } : {};
  const params = (id: string) =>
    options.params ? { params: structuredClone(YARD_PARAMS[id]) } : {};
  return prefabLibrary([
    {
      kind: "prefab",
      v: 3,
      ...home,
      id: "gate",
      ...params("gate"),
      entities: [
        {
          id: "door",
          type: "follower",
          shape: ["box", 0, 0, 10, 40],
          path: {
            pts: [
              [0, 0],
              [0, -80],
            ],
            mode: "ping_pong",
            speed: 60,
          },
        },
        { id: "trigger", type: "sensor", shape: ["box", 60, 20, 20, 20], tags: ["gate"] },
      ],
      bulk: { solid: [["box", 0, 50, 40, 6]] },
    },
    {
      kind: "prefab",
      v: 3,
      ...home,
      id: "post",
      ...params("post"),
      entities: [{ id: "top", type: "marker", at: [0, -40] }],
      bulk: { solid: [["box", 0, 0, 6, 40]] },
    },
  ]);
}

/** The engine fixture scene, as an inline def, with a group and two prefab instances. */
export function engineYard(): SceneDefinition {
  return {
    $schema: "../../scene/scene.schema.json",
    v: 3,
    name: "engine-yard",
    bounds: [0, 0, 2000, 1000],
    settings: { gravity: [0, 1200] },
    groups: { pens: { at: [0, 0] }, raised: { at: [40, -20], name: "Raised" } },
    instances: [
      { id: "gate-1", prefab: "gate", at: [1100, 900] },
      {
        id: "post-1",
        prefab: "post",
        at: [600, 900],
        group: "raised",
        overrides: { "top.at": [0, -60] },
      },
    ],
    solid: [
      ["box", 1000, 980, 1000, 20],
      ["box", 20, 500, 20, 500],
      ["box", 1980, 500, 20, 500],
    ],
    entities: [
      { id: "ledge", type: "solid", shape: ["box", 1400, 800, 120, 10], oneWay: true },
      { id: "avatar", type: "prop", shape: ["box", 300, 940, 20, 20], density: 1, restitution: 0 },
      { id: "crate", type: "prop", shape: ["circle", 1200, 940, 20], density: 2, restitution: 0.3 },
      {
        id: "lift",
        type: "follower",
        shape: ["box", 0, 0, 60, 8],
        path: {
          pts: [
            [1700, 900],
            [1700, 600],
          ],
          mode: "ping_pong",
          speed: 80,
          pauseMs: 400,
        },
      },
      { id: "zone", type: "sensor", shape: ["box", 900, 930, 40, 30], tags: ["goal"] },
      { id: "start", type: "marker", at: [300, 960], tags: ["spawn"], group: "pens" },
      { id: "readme", type: "note", at: [100, 100], text: "Engine fixture: primitives only." },
    ],
  };
}

/** The engine fixture plus the fake game's bulk arrays and a lever aimed at the lift. */
export function fakeYard(): SceneDefinition {
  const def = engineYard();
  return {
    ...def,
    game: "fake",
    "solid:ice": [
      ["box", 500, 700, 40, 8],
      ["box", 600, 600, 40, 8],
    ],
    ledge: [["box", 800, 500, 60, 6]],
    peg: [[300, 300]],
    entities: [...def.entities!, { id: "pull", type: "lever", at: [1600, 960], target: "lift" }],
  };
}

/** The test game's registry: its glow and spin behaviors, the lamp and plain markers, the paint grid type. */
export const testGameRegistry = createRegistry(testGame);

/** The engine fixture on the test game: a cell grid, an assets header, lamps with behaviors and two painted grids. */
export function testGameYard(): SceneDefinition {
  const def = engineYard();
  return {
    ...def,
    game: "test-game",
    settings: { ...def.settings, grid: { kind: "square", cell: [32, 32] } },
    assets: ["boom", "tiles"],
    entities: [
      ...def.entities!,
      {
        id: "lamp",
        type: "lamp",
        at: [400, 400],
        behaviors: { "test-game/glow": { intensity: 3 }, "test-game/spin": { speed: 45 } },
      },
      { id: "lamp-2", type: "lamp", at: [800, 400], group: "pens" },
      { id: "still", type: "plain", at: [900, 300] },
      { id: "floor", type: "paint", at: [0, 640], cells: { "0,0": ["1*4", "", "2"] } },
      { id: "wall", type: "paint", at: [1200, 0], z: 2, cells: { "1,0": ["3*8"] } },
    ],
  };
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The asset ids `useAssets` draws from. */
const ASSET_POOL = ["boom", "hud", "music", "sky", "tiles"];

/** A value a behavior field's schema takes: a number, a #rrggbb string, or a boolean. */
function behaviorValue(schema: unknown, int: (lo: number, hi: number) => number): unknown {
  let s = schema as { _zod: { def: { type: string; innerType?: unknown } } };
  while (s._zod.def.innerType !== undefined) s = s._zod.def.innerType as typeof s;
  switch (s._zod.def.type) {
    case "string":
      return `#${int(0, 0xffffff).toString(16).padStart(6, "0")}`;
    case "boolean":
      return int(0, 1) === 1;
    default:
      return int(0, 120);
  }
}

export type RandomOpOptions = {
  /** Also draw the v3 ops: `transform`, `setZ`, `useAssets`, `paintCells`, behavior `update`s and `setParam`. */
  v3?: boolean;
};

export function randomOp(
  reg: Registry,
  def: SceneDefinition,
  rand: () => number,
  prefabs: PrefabLibrary = yardPrefabs(),
  options: RandomOpOptions = {},
): SceneOp {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
  const pt = (): [number, number] => [int(0, 1900), int(0, 900)];
  const bulkRefs = reg.bulkKeys.flatMap(({ key }) =>
    ((def[key] ?? []) as unknown[]).map((_, i) => `~${key}:${i}`),
  );
  const ids = (def.entities ?? []).map((e) => e.id);
  const instances = (def.instances ?? []).map((i) => i.id);
  const refs = [...bulkRefs, ...ids, ...instances];
  const prefabIds = [...prefabs.keys()];
  const groupIds = Object.keys(def.groups ?? {});
  const any = () => pick(refs) ?? "missing";
  const by = (): [number, number] => [int(-64, 64), int(-64, 64)];
  const settings = Object.keys(reg.settings);

  const roll = options.v3 ? int(0, 27) : int(0, 21);
  if (roll > 21) {
    const entities = def.entities ?? [];
    switch (roll) {
      case 22: {
        const groupRoll = rand();
        const turn = pick([1, 2, 3, -1] as const)!;
        const flip = pick(["x", "y"] as const)!;
        return {
          op: "transform",
          ...(groupRoll < 0.6 || groupIds.length === 0
            ? { refs: [pick(instances) ?? "missing"] }
            : { groups: [pick(groupIds)!] }),
          ...(rand() < 0.5 ? { turn } : rand() < 0.5 ? { flip } : { turn, flip }),
          ...(rand() < 0.3 ? { about: pt() } : {}),
        };
      }
      case 23: {
        const targets = [...new Set([pick([...ids, ...instances]) ?? "missing", any()])];
        return rand() < 0.5
          ? { op: "setZ", refs: targets, z: int(-5, 5) }
          : { op: "setZ", refs: targets, by: int(-2, 2) };
      }
      case 24: {
        const used = def.assets ?? [];
        const remove = rand() < 0.4 && used.length > 0 ? [pick(used)!] : [];
        const add = ASSET_POOL.filter((id) => !remove.includes(id) && rand() < 0.3);
        return add.length === 0 && remove.length === 0
          ? { op: "useAssets", add: [pick(ASSET_POOL)!] }
          : {
              op: "useAssets",
              ...(add.length > 0 ? { add } : {}),
              ...(remove.length > 0 ? { remove } : {}),
            };
      }
      case 25: {
        const painted = entities.flatMap((e) => {
          const t = reg.types.get(e.type);
          const fields = t ? geometryFields(t).filter((f) => f.kind === "grid") : [];
          return fields.map((f) => [e.id, f.field] as const);
        });
        const target = pick(painted);
        if (!target) return { op: "setScene", set: { name: `yard-${int(0, 9)}` } };
        const cell = (): CellEdit => [int(0, 80), int(0, 40), int(0, 3)];
        const rect = (): CellRect => {
          const [c, r] = [int(0, 70), int(0, 35)];
          return [c, r, c + int(0, 8), r + int(0, 4), int(0, 3)];
        };
        return {
          op: "paintCells",
          ref: target[0],
          field: target[1],
          ...(rand() < 0.7 ? { cells: Array.from({ length: int(1, 6) }, cell) } : {}),
          ...(rand() < 0.4 ? { rects: [rect()] } : { cells: [cell()] }),
        };
      }
      case 27: {
        const ref = pick(instances) ?? "missing";
        const inst = def.instances?.find((x) => x.id === ref);
        const exposed = (inst && prefabs.get(inst.prefab)?.params) ?? {};
        const held = Object.keys(inst?.params ?? {});
        if (rand() < 0.25 && held.length > 0)
          return { op: "setParam", ref, name: pick(held)!, value: null };
        const name = pick(Object.keys(exposed)) ?? "speed";
        const value = Array.isArray(exposed[name]?.default)
          ? [int(-20, 20), int(-80, 0)]
          : int(20, 300);
        return { op: "setParam", ref, name, value };
      }
      default: {
        const hosts = entities.flatMap((e) =>
          reg.types.has(e.type)
            ? reg.behaviorRules(e.type).allowed.map((name) => [e, name] as const)
            : [],
        );
        const host = pick(hosts);
        if (!host) return { op: "setScene", set: { name: `yard-${int(0, 9)}` } };
        const [e, name] = host;
        const path = `${BEHAVIORS_FIELD}.${name}`;
        const shape = reg.behaviors.get(name)?.shape ?? {};
        const fields = Object.keys(shape);
        const required = reg.behaviorRules(e.type).required.has(name);
        const has = (e[BEHAVIORS_FIELD] as Record<string, unknown> | undefined)?.[name];
        const r = rand();
        if (r < 0.2 && has !== undefined && !required)
          return { op: "update", ref: e.id, unset: [path] };
        if (r < 0.3) return { op: "update", ref: e.id, set: { [path]: {} } };
        const field = pick(fields);
        if (field === undefined) return { op: "update", ref: e.id, set: { [path]: {} } };
        return rand() < 0.15 && has !== undefined
          ? { op: "update", ref: e.id, unset: [`${path}.${field}`] }
          : {
              op: "update",
              ref: e.id,
              set: { [`${path}.${field}`]: behaviorValue(shape[field], int) },
            };
      }
    }
  }

  switch (roll) {
    case 0:
      return {
        op: "add",
        entity: {
          type: "solid",
          shape: ["box", int(0, 1900), int(0, 900), int(1, 40), int(1, 20)],
        },
      };
    case 1:
      return rand() < 0.5
        ? { op: "add", entity: { type: "marker", at: pt() }, index: int(0, ids.length) }
        : {
            op: "add",
            entity: {
              type: "follower",
              shape: ["box", 0, 0, int(10, 60), 8],
              path: { pts: [pt(), pt()], mode: "loop", speed: int(20, 300) },
            },
          };
    case 2: {
      const info = pick(reg.bulkKeys)!;
      const length = ((def[info.key] ?? []) as unknown[]).length;
      return info.form === "point"
        ? { op: "addBulk", key: info.key, points: [pt()], index: int(0, length) }
        : {
            op: "addBulk",
            key: info.key,
            shapes: [["box", ...pt(), int(10, 60), 6]],
            index: int(0, length),
          };
    }
    case 3:
      return { op: "move", refs: [any(), any()], by: by() };
    case 4:
      return {
        op: "place",
        ref: any(),
        at: pt(),
        anchor: pick(["center", "top", "bottom", "left", "right"] as const),
      };
    case 5:
      return { op: "remove", refs: [any()] };
    case 6: {
      const follower = (def.entities ?? []).find((e) => e.type === "follower");
      return follower
        ? {
            op: "update",
            ref: follower.id,
            set: { "path.speed": int(20, 300) },
            unset: rand() < 0.5 ? ["path.pauseMs"] : [],
          }
        : { op: "setScene", set: { name: `yard-${int(0, 9)}` } };
    }
    case 7:
      return { op: "rename", from: pick(ids) ?? "missing", to: `r-${int(0, 99)}` };
    case 8:
      return { op: "promote", ref: pick(bulkRefs) ?? "~solid:0", id: `p-${int(0, 99)}` };
    case 9: {
      const demotable = (def.entities ?? []).filter((e) => e.id.startsWith("p-"));
      return { op: "demote", id: pick(demotable)?.id ?? "missing" };
    }
    case 10: {
      const key = pick(settings)!;
      return rand() < 0.3
        ? { op: "setSettings", unset: [key] }
        : {
            op: "setSettings",
            set: { [key]: key === "gravity" ? [0, int(0, 2000)] : int(-50, 50) },
          };
    }
    case 11:
      return { op: "setScene", set: { bounds: [-int(1, 9) * 100, -500, 4000, 1200] } };
    case 12:
      return rand() < 0.5 || instances.length === 0
        ? {
            op: "reorder",
            refs: [pick(ids) ?? "missing"],
            index: int(0, Math.max(0, ids.length - 1)),
          }
        : { op: "reorder", refs: [pick(instances)!], index: int(0, instances.length - 1) };
    case 13:
      return {
        op: "instantiate",
        instance: {
          prefab: pick(prefabIds) ?? "gate",
          at: pt(),
          ...(rand() < 0.3 && groupIds.length > 0 ? { group: pick(groupIds)! } : {}),
        },
        ...(rand() < 0.3 ? { index: int(0, instances.length) } : {}),
      };
    case 14: {
      const roll = rand();
      if (roll < 0.5) return { op: "setGroup", id: pick(groupIds) ?? "pens", at: by() };
      if (roll < 0.7)
        return { op: "setGroup", id: `g-${int(0, 9)}`, name: rand() < 0.5 ? "G" : null };
      return { op: "setGroup", id: pick(groupIds) ?? "missing", remove: true };
    }
    case 15: {
      const ref = pick(instances) ?? "missing";
      const inst = def.instances?.find((i) => i.id === ref);
      const set: Record<string, unknown> =
        inst?.prefab === "post"
          ? { "top.at": [int(-20, 20), int(-80, 0)] }
          : rand() < 0.5
            ? { "door.path.speed": int(20, 200) }
            : { "~solid:0.shape": ["box", int(-20, 20), 50, int(10, 60), 6] };
      return { op: "override", ref, set };
    }
    case 16: {
      const ref = pick(instances) ?? "missing";
      const keys = Object.keys(def.instances?.find((i) => i.id === ref)?.overrides ?? {});
      return rand() < 0.5 || keys.length === 0
        ? { op: "revertOverride", ref }
        : { op: "revertOverride", ref, paths: [pick(keys)!] };
    }
    case 17:
      return { op: "applyToPrefab", ref: pick(instances) ?? "missing" };
    case 18:
      return { op: "unpack", ref: pick(instances) ?? "missing" };
    case 19: {
      const picked = [
        ...new Set([pick(ids.filter((id) => id !== "readme")), pick(bulkRefs)]),
      ].filter((r): r is string => r !== undefined);
      return {
        op: "createPrefab",
        refs: picked.length > 0 ? picked : ["missing"],
        id: `pf-${int(0, 99)}`,
      };
    }
    case 20: {
      const id = pick(prefabIds) ?? "post";
      return rand() < 0.2 &&
        !instances.some((i) => def.instances?.find((x) => x.id === i)?.prefab === id)
        ? { op: "definePrefab", id, prefab: null }
        : {
            op: "definePrefab",
            id: rand() < 0.5 ? id : `pf-${int(0, 99)}`,
            prefab: {
              entities: [{ id: "top", type: "marker", at: [0, -int(10, 80)] }],
              bulk: { solid: [["box", 0, 0, int(2, 10), 40]] },
            },
          };
    }
    default:
      return { op: "setScene", set: { name: `yard-${int(0, 9)}` } };
  }
}
