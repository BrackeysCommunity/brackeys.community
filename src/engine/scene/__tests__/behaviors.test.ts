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
import { fieldKind } from "../schema";

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

describe("behavior registration", () => {
  it("registers the engine's behaviors, then the game's in order", () => {
    expect(ENGINE_BEHAVIORS).toEqual([]);
    const r = createRegistry(game());
    expect(r.behaviorNames).toEqual(["fake/tint", "fake/wobble", "fake/kinds"]);
    expect([...r.behaviors.keys()]).toEqual(r.behaviorNames);
    const reg = r.behaviors.get("fake/wobble")!;
    expect(reg.origin).toBe("fake");
    expect(reg.index).toBe(1);
    expect(reg.requires).toEqual(["fake/tint"]);
    expect(Object.keys(reg.shape)).toEqual(["amount"]);
  });

  it("resolves a behavior's fields against the registry", () => {
    const r = createRegistry(game());
    const material = r.behaviors.get("fake/kinds")!.shape.material!;
    expect(z.safeParse(material, "mud").success).toBe(true);
    expect(z.safeParse(material, "lava").success).toBe(false);
  });

  it("has none without a game, and the primitives registry has none of the game's", () => {
    expect(createRegistry().behaviorNames).toEqual([]);
    expect(createRegistry(game()).primitives.behaviorNames).toEqual([]);
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
    for (const type of ["post", "solid", "marker"]) {
      const rules = r.behaviorRules(type);
      expect(rules.allowed).toEqual(["fake/tint", "fake/wobble", "fake/kinds"]);
      expect(rules.required.size).toBe(0);
    }
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
    expect(r.behaviorRules("some").allowed).toEqual(["fake/tint", "fake/wobble"]);
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
    expect(Object.fromEntries(rules.defaults)).toEqual({
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
    expect(r.behaviorNames).toEqual(["test-game/glow", "test-game/spin"]);
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
