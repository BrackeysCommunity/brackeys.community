// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { GLOW, SPIN, testGame } from "../../__tests__/fixtures/test-game";
import { BEHAVIOR_NAME_PATTERN, defineBehavior, type BehaviorDef } from "../../game/behaviors";
import {
  createRegistry,
  defineEntityType,
  defineGame,
  ENGINE_BEHAVIORS,
  RegistryError,
} from "../../game/define";
import { pointField } from "../../game/fields";
import type { EntityTypeDef, GameDefinition } from "../../game/types";
import { expandScene } from "../expand";
import { formatScene } from "../format";
import { sceneJsonSchema } from "../json-schema";
import { parseScene, parseSceneOrThrow } from "../parse";
import { fieldKind } from "../schema";
import type { EntityDef, SceneDefinition } from "../types";
import { validateScene } from "../validate";

const tint = defineBehavior({
  name: "fake/tint",
  description: "A tint.",
  fields: {
    color: z.string().default("#ffffff").describe("Color."),
    alpha: z.number().min(0).max(1).default(1).describe("Opacity."),
    label: z.string().optional().describe("Optional."),
  },
});

const wobble = defineBehavior({
  name: "fake/wobble",
  description: "Wobbles; needs a tint.",
  fields: { amount: z.number().describe("No default.") },
  requires: ["fake/tint"],
});

const kinds = defineBehavior({
  name: "fake/kinds",
  description: "A field built from the registry.",
  fields: (env) => ({ material: z.enum(env.materials as [string, ...string[]]).optional() }),
});

const marker = (type: string, behaviors?: EntityTypeDef["behaviors"]) =>
  defineEntityType({
    type,
    description: `A ${type}.`,
    base: "marker",
    fields: { at: pointField("Where.") },
    ...(behaviors ? { behaviors } : {}),
  });

function game(over: Partial<GameDefinition> = {}): GameDefinition {
  return defineGame({
    id: "fake",
    types: [marker("post")],
    behaviors: [tint, wobble, kinds],
    actions: [],
    materials: { mud: { friction: 2, restitution: 0, description: "Sticky." } },
    createRuntime: () => ({ snapshot: () => null }),
    ...over,
  });
}

const problems = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (err) {
    if (err instanceof RegistryError) return err.problems;
    throw err;
  }
  return [];
};

const refused = (over: Partial<GameDefinition>) => problems(() => createRegistry(game(over)));

/** The engine's behaviors, in registration order. */
const STANDARD = [
  "sprite",
  "occupant",
  "lifetime",
  "collider",
  "body",
  "player-input",
  "path-follow",
  "force-area",
  "character-top-down",
  "character-side-view",
  "nav-agent",
  "joint",
  "spawner",
  "camera-target",
  "anim",
  "tween",
  "emitter",
];

describe("behavior registration", () => {
  it("registers the engine's behaviors, then the game's in order", () => {
    expect(ENGINE_BEHAVIORS.map((b) => b.name)).toEqual(STANDARD);
    const r = createRegistry(game());
    expect(r.behaviorNames).toEqual([...STANDARD, "fake/tint", "fake/wobble", "fake/kinds"]);
    expect([...r.behaviors.keys()]).toEqual(r.behaviorNames);
    expect(r.behaviors.get("sprite")).toMatchObject({
      origin: "engine",
      index: 0,
      visualOnly: true,
    });
    expect(r.behaviors.get("occupant")).toMatchObject({ origin: "engine", index: 1 });
    expect(r.behaviors.get("occupant")?.visualOnly).toBeUndefined();
    const reg = r.behaviors.get("fake/wobble")!;
    expect(reg.origin).toBe("fake");
    expect(reg.index).toBe(STANDARD.length + 1);
    expect(reg.requires).toEqual(["fake/tint"]);
    expect(Object.keys(reg.shape)).toEqual(["amount"]);
  });

  it("resolves a behavior's fields against the registry", () => {
    const r = createRegistry(game());
    const material = r.behaviors.get("fake/kinds")!.shape.material!;
    expect(z.safeParse(material, "mud").success).toBe(true);
    expect(z.safeParse(material, "lava").success).toBe(false);
  });

  it("has only the engine's without a game, and the primitives registry has none of the game's", () => {
    expect(createRegistry().behaviorNames).toEqual(STANDARD);
    expect(createRegistry(game()).primitives.behaviorNames).toEqual(STANDARD);
  });

  it("defineBehavior is the identity", () => {
    expect(defineBehavior(tint)).toBe(tint);
  });

  it("names match the pattern: bare or one prefix", () => {
    for (const ok of ["sprite", "a", "tactics/selectable", "x-1/y-2"])
      expect(BEHAVIOR_NAME_PATTERN.test(ok)).toBe(true);
    for (const bad of ["", "Sprite", "a/b/c", "/a", "a/", "-a", "a.b", "a_b", "x".repeat(49)])
      expect(BEHAVIOR_NAME_PATTERN.test(bad)).toBe(false);
  });
});

describe("behavior refusals", () => {
  const named = (name: string): BehaviorDef => ({ ...tint, name });

  it("refuses a game behavior outside the game's namespace", () => {
    expect(refused({ behaviors: [named("glow"), named("other/glow")] })).toEqual([
      'behavior "glow" must be "fake/<name>"',
      'behavior "other/glow" must be "fake/<name>"',
    ]);
  });

  it("refuses a name that fails the pattern", () => {
    expect(refused({ behaviors: [named("fake/Glow")] })).toEqual([
      `behavior "fake/Glow" must match ${BEHAVIOR_NAME_PATTERN}`,
    ]);
  });

  it("refuses a duplicate", () => {
    expect(refused({ behaviors: [tint, tint] })).toEqual([
      'behavior "fake/tint" is registered twice',
    ]);
  });

  it("refuses requires naming an unknown behavior", () => {
    expect(refused({ behaviors: [wobble] })).toEqual([
      'behavior "fake/wobble" requires unknown behavior "fake/tint"',
    ]);
  });

  it("refuses type rules naming an unknown behavior", () => {
    const types = [
      marker("a", { required: { "fake/nope": {} } }),
      marker("b", { defaults: { "fake/nope": {} } }),
      marker("c", { forbidden: ["fake/nope"] }),
    ];
    expect(refused({ types })).toEqual([
      'type "a" required names unknown behavior "fake/nope"',
      'type "b" defaults names unknown behavior "fake/nope"',
      'type "c" forbids unknown behavior "fake/nope"',
    ]);
  });

  it("refuses a behavior both required and forbidden", () => {
    const types = [marker("a", { required: { "fake/tint": {} }, forbidden: ["fake/tint"] })];
    expect(refused({ types })).toEqual(['type "a" both requires and forbids "fake/tint"']);
  });

  it("refuses a required behavior whose own requirement the type forbids", () => {
    const types = [
      marker("a", { required: { "fake/wobble": { amount: 1 } }, forbidden: ["fake/tint"] }),
      marker("b", { required: { "fake/wobble": { amount: 1 } }, forbidden: "all" }),
      marker("c", {
        required: { "fake/wobble": { amount: 1 }, "fake/tint": {} },
        forbidden: "all",
      }),
    ];
    expect(refused({ types })).toEqual([
      'type "a" requires "fake/wobble", which requires "fake/tint", but forbids "fake/tint"',
      'type "b" requires "fake/wobble", which requires "fake/tint", but forbids "fake/tint"',
    ]);
  });

  it("refuses defaults for a forbidden behavior", () => {
    const types = [
      marker("a", { defaults: { "fake/tint": {} }, forbidden: ["fake/tint"] }),
      marker("b", { defaults: { "fake/tint": {} }, forbidden: "all" }),
    ];
    expect(refused({ types })).toEqual([
      'type "a" gives defaults for "fake/tint", which it forbids',
      'type "b" gives defaults for "fake/tint", which it forbids',
    ]);
  });

  it("refuses a type default that fails the behavior's schema", () => {
    const types = [
      marker("a", { required: { "fake/tint": { alpha: 2 } } }),
      marker("b", { defaults: { "fake/tint": { color: 3, shade: 1 } } }),
    ];
    expect(refused({ types })).toEqual([
      `type "a" required "fake/tint" field "alpha" fails the behavior's schema`,
      `type "b" defaults "fake/tint" field "color" fails the behavior's schema`,
      'type "b" defaults "fake/tint" names unknown field "shade"',
    ]);
  });

  it("refuses behavior rules on a type that never loads", () => {
    const note = defineEntityType({
      type: "memo",
      description: "Never loads.",
      loads: false,
      fields: { at: pointField("Where.") },
      behaviors: { forbidden: ["fake/tint"] },
    });
    expect(refused({ types: [note] })).toEqual([
      `type "memo" never loads and can't carry behaviors`,
    ]);
  });
});

describe("behaviorRules", () => {
  it("allows every behavior, in registration order, on a type without rules", () => {
    const r = createRegistry(game());
    const all = [...STANDARD, "fake/tint", "fake/wobble", "fake/kinds"];
    for (const type of ["post", "marker"]) {
      const rules = r.behaviorRules(type);
      expect(rules.allowed).toEqual(all);
      expect(rules.required.size).toBe(0);
    }
    expect(r.behaviorRules("solid").allowed).toEqual(
      all.filter((b) => b !== "body" && b !== "collider"),
    );
  });

  it("gives types that don't load, and unknown types, none", () => {
    const r = createRegistry(game());
    for (const type of ["note", "nope"]) {
      const rules = r.behaviorRules(type);
      expect(rules.allowed).toEqual([]);
      expect(rules.required.size).toBe(0);
      expect(rules.defaults.size).toBe(0);
    }
  });

  it("leaves out a forbidden list, and allows only required under forbidden all", () => {
    const r = createRegistry(
      game({
        types: [
          marker("some", { forbidden: ["fake/kinds"] }),
          marker("only", { required: { "fake/tint": {} }, forbidden: "all" }),
          marker("none", { forbidden: "all" }),
        ],
      }),
    );
    expect(r.behaviorRules("some").allowed).toEqual([...STANDARD, "fake/tint", "fake/wobble"]);
    expect(r.behaviorRules("only").allowed).toEqual(["fake/tint"]);
    expect(r.behaviorRules("none").allowed).toEqual([]);
    expect(r.behaviorRules("none").defaults.size).toBe(0);
  });

  it("merges the behavior's defaults under the type's defaults under its required values", () => {
    const r = createRegistry(
      game({
        types: [
          marker("lit", {
            required: { "fake/tint": { color: "#ff0000" } },
            defaults: {
              "fake/tint": { color: "#00ff00", alpha: 0.5 },
              "fake/wobble": { amount: 3 },
            },
          }),
        ],
      }),
    );
    const rules = r.behaviorRules("lit");
    expect([...rules.required]).toEqual([["fake/tint", { color: "#ff0000", alpha: 0.5 }]]);
    const engine = createRegistry().behaviorRules("marker").defaults;
    expect(Object.fromEntries(rules.defaults)).toEqual({
      ...Object.fromEntries(STANDARD.map((b) => [b, engine.get(b)])),
      "fake/tint": { color: "#ff0000", alpha: 0.5 },
      "fake/wobble": { amount: 3 },
      "fake/kinds": {},
    });
    expect(rules.defaults.get("fake/tint")).toBe(rules.required.get("fake/tint"));
    expect(Object.isFrozen(rules.defaults.get("fake/wobble"))).toBe(true);
    expect(r.behaviorRules("marker").defaults.get("fake/tint")).toEqual({
      color: "#ffffff",
      alpha: 1,
    });
  });

  it("an empty required block is the behavior's own defaults", () => {
    const r = createRegistry(game({ types: [marker("lit", { required: { "fake/tint": {} } })] }));
    expect(r.behaviorRules("lit").required.get("fake/tint")).toEqual({
      color: "#ffffff",
      alpha: 1,
    });
  });
});

describe("the test game's behaviors", () => {
  const r = createRegistry(testGame);

  it("registers glow and spin, prefixed with the game id", () => {
    expect(r.behaviorNames).toEqual([...STANDARD, "test-game/glow", "test-game/spin"]);
    expect(r.behaviors.get(GLOW.name)?.system).toBeUndefined();
    expect(typeof r.behaviors.get(SPIN.name)?.system).toBe("function");
  });

  it("the lamp requires glow brighter than its default and spins slowly", () => {
    const rules = r.behaviorRules("lamp");
    expect(Object.fromEntries(rules.required)).toEqual({
      "test-game/glow": { color: "#ffcc00", intensity: 2 },
    });
    expect(rules.defaults.get(SPIN.name)).toEqual({ speed: 30 });
    expect(r.behaviorRules("plain").allowed).toEqual([]);
  });

  it("spin's stub system attaches, detaches and clears", () => {
    const sys = SPIN.system!({} as never, r.behaviors.get(SPIN.name)!);
    sys.attach("a", { speed: 10 }, { id: "a", type: "lamp" } as never);
    sys.attach("b", { speed: 20 }, { id: "b", type: "lamp" } as never);
    expect(sys.size()).toBe(2);
    sys.detach("a");
    sys.detach("a");
    expect(sys.size()).toBe(1);
    sys.clear();
    expect(sys.size()).toBe(0);
  });

  it("paints cells on a grid from a point at", () => {
    const shape = r.types.get("paint")!.shape;
    expect(fieldKind(shape.at!)).toBe("point");
    expect(fieldKind(shape.cells!)).toBe("grid");
    expect(z.safeParse(shape.cells!, { "0,0": ["1*3,0,2"] }).success).toBe(true);
  });

  it("keeps the engine's four layers and adds one", () => {
    expect(r.layers.map((l) => l.name)).toEqual([
      "backdrop",
      "terrain",
      "decor",
      "gameplay",
      "editor",
    ]);
  });
});

describe("behavior issue codes", () => {
  const halo = defineBehavior({
    name: "test-game/halo",
    description: "A ring around the glow.",
    fields: { radius: z.number().default(8).describe("Px.") },
    requires: [GLOW.name],
  });
  const r = createRegistry(
    defineGame({ ...testGame, behaviors: [...(testGame.behaviors ?? []), halo] }),
  );
  const codes = ["behavior-unknown", "behavior-forbidden", "behavior-missing"];
  const issues = (entities: EntityDef[]) => {
    const def: SceneDefinition = {
      v: 1,
      name: "t",
      game: "test-game",
      bounds: [0, 0, 1000, 1000],
      entities,
    };
    return validateScene(def, r)
      .filter((i) => codes.includes(i.code))
      .map((i) => [i.code, i.path, i.entityIds]);
  };
  const at: [number, number] = [100, 100];

  it("passes a lamp that leaves its required glow out", () => {
    expect(issues([{ id: "lamp", type: "lamp", at }])).toEqual([]);
  });

  it("flags an unknown name, a forbidden block and a missing required behavior", () => {
    expect(
      issues([
        { id: "a", type: "lamp", at, behaviors: { "test-game/spn": {} } },
        { id: "b", type: "plain", at, behaviors: { [SPIN.name]: {} } },
        { id: "c", type: "marker", at, behaviors: { [halo.name]: {} } },
      ]),
    ).toEqual([
      ["behavior-unknown", "/entities/0/behaviors/test-game~1spn", ["a"]],
      ["behavior-forbidden", "/entities/1/behaviors/test-game~1spin", ["b"]],
      ["behavior-missing", "/entities/2/behaviors/test-game~1halo", ["c"]],
    ]);
  });
});

describe("behavior blocks in the JSON Schema", () => {
  type Node = { properties?: Record<string, Node>; required?: string[] };
  const block = (r: ReturnType<typeof createRegistry>, type: string, behavior: string) => {
    const entities = (sceneJsonSchema(r) as { $defs: { Entity: { oneOf: Node[] } } }).$defs.Entity
      .oneOf;
    const entity = entities.find((e) => (e.properties!.type as { const?: string }).const === type)!;
    return entity.properties!.behaviors!.properties![behavior]!;
  };

  it("requires a field only when neither the behavior nor the type defaults it", () => {
    const r = createRegistry(
      game({
        types: [marker("post"), marker("still", { defaults: { "fake/wobble": { amount: 0 } } })],
      }),
    );
    expect(block(r, "post", "fake/wobble").required).toEqual(["amount"]);
    expect(block(r, "still", "fake/wobble").required).toBeUndefined();
    expect(block(r, "post", "fake/tint").required).toBeUndefined();
  });
});

describe("behavior defaults on parse", () => {
  const r = createRegistry(testGame);
  const scene = (behaviors: Record<string, unknown>): SceneDefinition => ({
    v: 5,
    game: "test-game",
    name: "defaults",
    bounds: [0, 0, 640, 480],
    entities: [{ id: "m", type: "lamp", at: [0, 0], behaviors } as EntityDef],
  });

  it("keeps only the fields a file writes, so parse then format leaves `{}` as `{}`", () => {
    const written = scene({ [GLOW.name]: {}, [SPIN.name]: { speed: 5 } });
    const def = parseSceneOrThrow(formatScene(written).text, r);
    expect(def.entities![0]!.behaviors).toEqual({ [GLOW.name]: {}, [SPIN.name]: { speed: 5 } });
    expect(formatScene(def).text).toBe(formatScene(written).text);
  });

  it("still fills the defaults in the expanded entity, the type's over the behavior's", () => {
    const def = parseSceneOrThrow(formatScene(scene({ [GLOW.name]: {}, [SPIN.name]: {} })).text, r);
    const e = expandScene(def, r).entities.find((x) => x.id === "m")!;
    expect(e.behaviors).toMatchObject({
      [GLOW.name]: { color: "#ffcc00", intensity: 2 },
      [SPIN.name]: { speed: 30 },
    });
  });

  it("still refuses a written field that fails its schema", () => {
    expect(() =>
      parseSceneOrThrow(formatScene(scene({ [GLOW.name]: { intensity: -1 } })).text, r),
    ).toThrow(/intensity/);
  });

  it("leaves out a default under an optional or nullable wrapper too", () => {
    const ring = defineBehavior({
      name: "test-game/ring",
      description: "A ring.",
      fields: {
        size: z.number().default(3).optional().describe("Px."),
        tone: z.string().default("red").nullable(),
      },
    });
    const withRing = createRegistry(
      defineGame({ ...testGame, behaviors: [...(testGame.behaviors ?? []), ring] }),
    );
    const written: SceneDefinition = {
      ...scene({}),
      entities: [{ id: "m", type: "marker", at: [0, 0], behaviors: { [ring.name]: {} } }],
    };
    const def = parseSceneOrThrow(formatScene(written).text, withRing);
    expect(def.entities![0]!.behaviors).toEqual({ [ring.name]: {} });
    expect(formatScene(def).text).toBe(formatScene(written).text);
    const kept = parseSceneOrThrow(
      formatScene({
        ...written,
        entities: [
          { id: "m", type: "marker", at: [0, 0], behaviors: { [ring.name]: { tone: null } } },
        ],
      }).text,
      withRing,
    );
    expect(kept.entities![0]!.behaviors).toEqual({ [ring.name]: { tone: null } });
    const e = expandScene(def, withRing).entities.find((x) => x.id === "m")!;
    expect(e.behaviors).toMatchObject({ [ring.name]: { size: 3, tone: "red" } });
    const entities = (
      sceneJsonSchema(withRing) as {
        $defs: { Entity: { oneOf: { properties: Record<string, any> }[] } };
      }
    ).$defs.Entity.oneOf;
    const marker = entities.find((x) => x.properties.type.const === "marker")!;
    expect(marker.properties.behaviors.properties[ring.name].properties.size).toMatchObject({
      default: 3,
      description: "Px.",
    });
  });

  it("keeps each default and description in the JSON Schema", () => {
    const entities = (
      sceneJsonSchema(r) as {
        $defs: { Entity: { oneOf: { properties: Record<string, any> }[] } };
      }
    ).$defs.Entity.oneOf;
    const lamp = entities.find((e) => e.properties.type.const === "lamp")!;
    const glow = lamp.properties.behaviors.properties[GLOW.name].properties;
    expect(glow.color).toMatchObject({
      default: "#ffcc00",
      description: expect.stringContaining("color"),
    });
    expect(glow.intensity).toMatchObject({ default: 1, minimum: 0 });
  });
});

describe("the lifetime behavior's schema", () => {
  const r = createRegistry(
    game({ types: [marker("post"), marker("spark", { defaults: { lifetime: { ticks: 5 } } })] }),
  );
  const scene = (type: string, lifetime: Record<string, unknown>): SceneDefinition => ({
    v: 5,
    game: "fake",
    name: "lifetime",
    bounds: [0, 0, 640, 480],
    entities: [{ id: "m", type, at: [10, 10], behaviors: { lifetime } } as EntityDef],
  });
  const parseIssues = (type: string, lifetime: Record<string, unknown>) => {
    const res = parseScene(formatScene(scene(type, lifetime)).text, r);
    return res.ok ? [] : res.issues.map((i) => [i.code, i.path, i.message]);
  };
  const validateIssues = (type: string, lifetime: Record<string, unknown>) =>
    validateScene(scene(type, lifetime), r)
      .filter((i) => i.code === "schema")
      .map((i) => [i.path, i.message]);
  const ONE_OF = /exactly one of `ticks` or `ms`/;
  // oxlint-disable-next-line unicorn/no-thenable -- `then` is a lifetime block field
  const withThen = (then: string, block: Record<string, unknown> = {}) => ({ ...block, then });

  it("takes exactly one of ticks or ms, a schema issue otherwise", () => {
    expect(parseIssues("post", { ticks: 3 })).toEqual([]);
    expect(parseIssues("post", withThen("disable", { ms: 250 }))).toEqual([]);
    for (const block of [{}, { ticks: 3, ms: 250 }, withThen("destroy")]) {
      const found = parseIssues("post", block);
      expect(found, JSON.stringify(block)).toHaveLength(1);
      expect(found[0]![0]).toBe("schema");
      expect(found[0]![1]).toBe("/entities/0/behaviors/lifetime");
      expect(found[0]![2]).toMatch(ONE_OF);
    }
  });

  it("keeps a valid block as written", () => {
    const def = parseSceneOrThrow(formatScene(scene("post", { ms: 100 })).text, r);
    expect(def.entities![0]!.behaviors).toEqual({ lifetime: { ms: 100 } });
  });

  it("counts the type's defaults under the written block", () => {
    expect(parseIssues("spark", {})).toEqual([]);
    expect(parseIssues("spark", withThen("disable"))).toEqual([]);
    expect(parseIssues("spark", { ms: 100 })).toHaveLength(1);
  });

  it("still checks each field's own shape", () => {
    for (const block of [
      { ticks: 0 },
      { ticks: 1.5 },
      { ms: -5 },
      withThen("vanish", { ticks: 2 }),
    ]) {
      expect(parseIssues("post", block), JSON.stringify(block)).toHaveLength(1);
    }
  });

  it("validation reports the same rule", () => {
    expect(validateIssues("post", { ticks: 3 })).toEqual([]);
    expect(validateIssues("spark", {})).toEqual([]);
    for (const block of [{}, { ticks: 3, ms: 250 }]) {
      const found = validateIssues("post", block);
      expect(found, JSON.stringify(block)).toHaveLength(1);
      expect(found[0]![0]).toBe("/entities/0/behaviors/lifetime");
      expect(found[0]![1]).toMatch(ONE_OF);
    }
  });

  it("is the engine's third behavior, simulated headless", () => {
    const b = r.behaviors.get("lifetime")!;
    expect(b).toMatchObject({ origin: "engine", index: 2 });
    expect(b.visualOnly).toBeUndefined();
    expect(Object.keys(b.shape)).toEqual(["ticks", "ms", "then"]);
  });
});
