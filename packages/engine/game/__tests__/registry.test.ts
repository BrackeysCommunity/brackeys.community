// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import type { AssetEntry, ProjectView } from "../../project/types";
import { DEFAULT_LAYERS } from "../../scene/layers";
import { parseScene } from "../../scene/parse";
import { sceneSchemaFor } from "../../scene/schema";
import { defineBehavior } from "../behaviors";
import { DEFAULT_ACTIONS } from "../defaults";
import {
  createRegistry,
  defineEntityType,
  defineGame,
  ENGINE_BEHAVIORS,
  isSpawnOnly,
  placeableTypes,
  RegistryError,
  withProject,
  type ProjectMaterialDef,
} from "../define";
import { pointField, shapeField } from "../fields";
import { bindingProblems } from "../input-bindings";
import type { TimeModel } from "../time";
import { PRIMITIVE_TYPES, type ActionDef, type Binding, type GameDefinition } from "../types";

const crate = defineEntityType({
  type: "crate",
  description: "A box to push.",
  base: "prop",
  fields: {
    shape: shapeField("Crate shape."),
    density: z.number().describe("Density."),
    restitution: z.number().describe("Bounciness."),
  },
});

const flag = defineEntityType({
  type: "flag",
  description: "A finish flag.",
  base: "marker",
  fields: { at: pointField("Where.") },
  bulk: { form: "point", description: "Flags." },
});

function game(over: Partial<GameDefinition> = {}): GameDefinition {
  return defineGame({
    id: "fake",
    types: [crate, flag],
    actions: [{ action: "push", keys: ["x"], description: "Push." }],
    materials: { mud: { friction: 2, restitution: 0, description: "Sticky." } },
    collisionGroups: { avatar: { collidesWith: ["static", "dynamic", "sensor"] } },
    issues: {
      "fake/no-flag": { severity: "warn", summary: "No flag.", hint: "Add one.", fixable: false },
    },
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

describe("createRegistry play hooks", () => {
  const pred = { description: "d", arg: z.boolean(), test: () => true };

  it("lists the engine's results and predicates, then the game's", () => {
    const r = createRegistry(game({ play: { results: ["won"], predicates: { grounded: pred } } }));
    expect(r.runResults).toEqual(["timeout", "script-end", "stuck", "quit", "flow", "won"]);
    expect(r.predicateNames).toEqual([
      "event",
      "tick",
      "exists",
      "count",
      "near",
      "scene",
      "persist",
      "grounded",
    ]);
    expect(createRegistry().runResults).toEqual(["timeout", "script-end", "stuck", "quit", "flow"]);
  });

  it("rejects a predicate or result that collides with the engine's", () => {
    expect(problems(() => createRegistry(game({ play: { predicates: { tick: pred } } })))).toEqual([
      'script predicate "tick" is the engine\'s',
    ]);
    expect(
      problems(() => createRegistry(game({ play: { results: ["stuck", "won", "won"] } }))),
    ).toEqual(['run result "stuck" is the engine\'s', 'run result "won" is declared twice']);
  });

  it("rejects movement actions the game doesn't declare and doubled editor keys", () => {
    expect(problems(() => createRegistry(game({ play: { movementActions: ["walk"] } })))).toEqual([
      'movement action "walk" is not a declared action',
    ]);
    const key = { key: "1", scope: "edit" as const, command: "a", description: "d" };
    expect(
      problems(() => createRegistry(game({ editorKeys: [key, { ...key, command: "b" }] }))),
    ).toEqual(['editor key "1" is bound twice in edit']);
  });
});

describe("createRegistry bindings", () => {
  const bound = (bindings: Binding[], kind?: ActionDef["kind"]): ActionDef[] => [
    { action: "act", description: "Act.", bindings, ...(kind ? { kind } : {}) },
  ];
  /** A binding as an input map or a host might send it, wrong on purpose. */
  const loose = (b: object): Binding => b as Binding;
  const refused = (actions: ActionDef[], over: Partial<GameDefinition> = {}) =>
    problems(() => createRegistry(game({ actions, ...over })));

  it("accepts every device's vocabulary and 0.x keys through the table", () => {
    expect(
      refused([
        { action: "jump", keys: ["ArrowUp", "w", " ", "Shift"], description: "Jump." },
        {
          action: "fire",
          description: "Fire.",
          bindings: [
            { device: "key", code: "Space" },
            { device: "pad", button: "south" },
            { device: "pad", button: 17 },
            { device: "pointer", button: "primary" },
            { device: "touch", control: "fire" },
          ],
        },
        {
          action: "move",
          kind: "vector",
          description: "Move.",
          bindings: [
            { device: "key", code: "KeyW", axis: "y", value: -1 },
            { device: "pad", button: "dpad-left", axis: "x", value: -1 },
            { device: "pad", stick: "left" },
          ],
        },
        {
          action: "throttle",
          kind: "axis",
          description: "Throttle.",
          bindings: [
            { device: "pad", axis: "rt" },
            { device: "pad", axis: "left-y", scale: -1 },
            { device: "pad", axis: 5 },
            { device: "key", code: "KeyS", value: -1 },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("refuses an unknown key code, pad button, pad axis or pointer button, with did-you-mean", () => {
    expect(
      refused(
        bound([
          loose({ device: "key", code: "keyw" }),
          loose({ device: "key", code: "Spce" }),
          loose({ device: "pad", button: "soth" }),
          loose({ device: "pointer", button: "primery" }),
        ]),
      ),
    ).toEqual([
      'action "act" binding 0/code: unknown key code "keyw"; did you mean "KeyW"? (binding-unknown)',
      'action "act" binding 1/code: unknown key code "Spce"; did you mean "Space"? (binding-unknown)',
      'action "act" binding 2/button: unknown pad button "soth"; did you mean "south"? (binding-unknown)',
      'action "act" binding 3/button: unknown pointer button "primery"; did you mean "primary"? (binding-unknown)',
    ]);
    expect(refused(bound([loose({ device: "pad", axis: "left-z" })], "axis"))).toEqual([
      'action "act" binding 0/axis: unknown pad axis "left-z"; did you mean "left-x"? (binding-unknown)',
    ]);
    expect(refused(bound([{ device: "key", code: "Hyper" }]))).toEqual([
      'action "act" binding 0/code: unknown key code "Hyper" (binding-unknown)',
    ]);
  });

  it("refuses a 0.x key the table doesn't know, with did-you-mean, rather than binding nothing", () => {
    expect(
      refused([
        { action: "up", keys: ["arrowup"], description: "Up." },
        { action: "jump", keys: [" ", "space", "Hyper"], description: "Jump." },
      ]),
    ).toEqual([
      'action "up" keys/0: unknown 0.x key "arrowup"; did you mean "ArrowUp"? (binding-unknown)',
      'action "jump" keys/1: unknown 0.x key "space"; did you mean " "? (binding-unknown)',
      'action "jump" keys/2: unknown 0.x key "Hyper" (binding-unknown)',
    ]);
    expect(
      refused([
        {
          action: "go",
          keys: ["nope"],
          bindings: [{ device: "key", code: "KeyG" }],
          description: "Bindings win; keys are not read.",
        },
      ]),
    ).toEqual([]);
  });

  it("refuses a binding whose shape doesn't fit its action's kind", () => {
    expect(
      refused(
        bound([
          { device: "pad", stick: "left" },
          { device: "pad", axis: "lt" },
          { device: "key", code: "KeyA", axis: "x", value: -1 },
        ]),
      ),
    ).toEqual([
      'action "act" binding 0/stick: a stick binds a vector action, not a button action (binding-unknown)',
      'action "act" binding 1/axis: a pad axis binds an axis action, not a button action (binding-unknown)',
      'action "act" binding 2/axis: a key on a button action takes no axis (binding-unknown)',
      'action "act" binding 2/value: a key on a button action takes no value (binding-unknown)',
    ]);
    expect(
      refused(
        bound(
          [
            { device: "key", code: "KeyA" },
            { device: "pointer", button: "primary" },
            { device: "key", code: "KeyD", axis: "x", value: 2 },
          ],
          "vector",
        ),
      ),
    ).toEqual([
      'action "act" binding 0/axis: a key on a vector action needs axis "x" or "y" (binding-unknown)',
      'action "act" binding 1/button: a pointer button binds a button action, not a vector action (binding-unknown)',
      'action "act" binding 2/value: a key\'s value must be a number in −1…1 (binding-unknown)',
    ]);
    expect(refused(bound([{ device: "key", code: "KeyA", axis: "x" }], "axis"))).toEqual([
      'action "act" binding 0/axis: a key on an axis action takes no axis; its value is the axis (binding-unknown)',
    ]);
  });

  it("refuses an unknown device or kind, a seat past max and seats outside 1–8", () => {
    expect(refused(bound([loose({ device: "mouse" })]))).toEqual([
      'action "act" binding 0/device: unknown device "mouse" (binding-unknown)',
    ]);
    expect(refused(bound([], "trigger" as ActionDef["kind"]))).toEqual([
      'action "act" has unknown kind "trigger"',
    ]);
    expect(refused(bound([{ device: "key", code: "KeyW", player: 1 }]))).toEqual([
      'action "act" binding 0/player: seat 1 is past the last seat, 0 (player-unknown)',
    ]);
    expect(
      refused(bound([{ device: "key", code: "KeyW", player: 1 }]), {
        input: { players: { max: 2, join: "auto" } },
      }),
    ).toEqual([]);
    expect(
      refused([], { input: { players: { max: 9, join: "party" as "auto" }, deadzone: 2 } }),
    ).toEqual([
      "input.players: players.max must be a whole number from 1 to 8; got 9 (player-unknown)",
      'input.players: unknown join policy "party" (player-unknown)',
      "input.deadzone must be a number from 0 to 1; got 2",
    ]);
  });

  it("judges a touch control against the declared controls when it has them", () => {
    const touch: Binding = { device: "touch", control: "fyre" };
    expect(bindingProblems(touch, { kind: "button", max: 1 })).toEqual([]);
    expect(bindingProblems(touch, { kind: "button", max: 1, controls: ["fire", "stick"] })).toEqual(
      [
        {
          code: "binding-unknown",
          message: 'unknown touch control "fyre"; did you mean "fire"?',
          path: "/control",
          expected: '"fire" | "stick"',
          got: '"fyre"',
          hint: 'did you mean "fire"?',
        },
      ],
    );
  });
});

describe("createRegistry", () => {
  it("always has the primitives, first, without a game", () => {
    const r = createRegistry();
    expect(r.id).toBe("engine");
    expect(r.typeNames).toEqual([...PRIMITIVE_TYPES]);
    expect(r.schemaId).toBe("urn:jams-engine:scene:v4");
    expect(r.spawnGroups).toEqual([
      ["solid"],
      ["sensor"],
      ["marker"],
      ["prop"],
      ["follower"],
      ["decor"],
      ["nav"],
      ["camera-region"],
    ]);
    expect(r.bulkKeys.map((b) => b.key)).toEqual(["solid"]);
    expect(r.actionNames).toEqual(["move", "jump"]);
  });

  it("registers a game's types after the primitives", () => {
    const r = createRegistry(game());
    expect(r.typeNames).toEqual([...PRIMITIVE_TYPES, "crate", "flag"]);
    expect(r.types.get("crate")).toMatchObject({ origin: "fake", base: "prop" });
    expect(r.types.get("solid")?.origin).toBe("engine");
    expect(r.schemaId).toBe("urn:jams-engine:scene:fake:v4");
    expect(r.bulkKeys.map((b) => b.key)).toEqual(["solid", "solid:mud", "flag"]);
    expect(r.bulkKey("solid:mud")).toEqual({
      key: "solid:mud",
      type: "solid",
      form: "shape",
      field: "shape",
      material: "mud",
    });
    expect(r.bulkKey("flag")).toMatchObject({ form: "point", field: "at" });
    expect(r.actionNames).toEqual(["push"]);
    expect(r.issueCodes["fake/no-flag"]?.severity).toBe("warn");
    expect(r.issueCodes["dup-id"]).toBeDefined();
  });

  it("resolves material fields against the registry", () => {
    const r = createRegistry(game());
    const material = r.types.get("solid")!.shape.material as z.ZodType;
    expect(material.safeParse("mud").success).toBe(true);
    expect(material.safeParse("ice").success).toBe(false);
  });

  it("packs symmetric collision groups", () => {
    const r = createRegistry(game());
    expect(r.collisionGroupNames).toEqual(["static", "dynamic", "sensor", "avatar"]);
    const member = (g: number) => g >>> 16;
    const filter = (g: number) => g & 0xffff;
    const hits = (a: string, b: string) => {
      const ga = r.collisionGroups(a);
      const gb = r.collisionGroups(b);
      return (member(ga) & filter(gb)) !== 0 && (member(gb) & filter(ga)) !== 0;
    };
    expect(hits("avatar", "static")).toBe(true);
    expect(hits("avatar", "sensor")).toBe(true);
    expect(hits("static", "dynamic")).toBe(true);
    expect(hits("dynamic", "dynamic")).toBe(true);
    expect(hits("static", "static")).toBe(false);
    expect(hits("sensor", "dynamic")).toBe(false);
    expect(hits("avatar", "avatar")).toBe(false);
    expect(() => r.collisionGroups("nope")).toThrow(/unknown collision group/);
  });

  it("lets a game add interactions to an engine group", () => {
    const r = createRegistry(game({ collisionGroups: { dynamic: { collidesWith: ["sensor"] } } }));
    expect(r.collisionGroupNames).toEqual(["static", "dynamic", "sensor"]);
    const d = r.collisionGroups("dynamic");
    const s = r.collisionGroups("sensor");
    expect((d >>> 16) & (s & 0xffff)).not.toBe(0);
    expect((s >>> 16) & (d & 0xffff)).not.toBe(0);
  });

  it("spawns decor, nav and camera regions last when an explicit spawn order leaves them out", () => {
    const r = createRegistry(
      game({
        spawnOrder: [
          "decor",
          "nav",
          "camera-region",
          "solid",
          "sensor",
          "crate",
          "prop",
          "flag",
          "marker",
          "follower",
        ],
      }),
    );
    expect(r.spawnGroups.slice(0, 3)).toEqual([["decor"], ["nav"], ["camera-region"]]);
    const without = createRegistry(
      game({ spawnOrder: ["solid", "sensor", "crate", "prop", "flag", "marker", "follower"] }),
    );
    expect(without.spawnGroups.slice(-3)).toEqual([["decor"], ["nav"], ["camera-region"]]);
  });

  it("honours an explicit spawn order with shared groups", () => {
    const r = createRegistry(
      game({ spawnOrder: ["solid", ["flag", "sensor"], "crate", "prop", "marker", "follower"] }),
    );
    expect(r.spawnGroups).toEqual([
      ["solid"],
      ["flag", "sensor"],
      ["crate"],
      ["prop"],
      ["marker"],
      ["follower"],
      ["decor"],
      ["nav"],
      ["camera-region"],
    ]);
    expect(r.bulkKeys.map((b) => b.key)).toEqual(["solid", "solid:mud", "flag"]);
  });

  it("spawns the primitives a spawn order leaves out first, in primitive order", () => {
    const r = createRegistry(game({ spawnOrder: ["flag", ["crate", "prop"]] }));
    expect(r.spawnGroups).toEqual([
      ["solid"],
      ["sensor"],
      ["marker"],
      ["follower"],
      ["flag"],
      ["crate", "prop"],
      ["decor"],
      ["nav"],
      ["camera-region"],
    ]);
    expect(problems(() => createRegistry(game({ spawnOrder: ["flag"] })))).toEqual([
      'spawnOrder misses type "crate"',
    ]);
  });

  it("refuses duplicates and redefined primitives", () => {
    expect(problems(() => createRegistry(game({ types: [crate, crate] })))).toEqual([
      'type "crate" is registered twice',
    ]);
    const solid = defineEntityType({
      type: "solid",
      description: "Mine.",
      base: "solid",
      fields: { shape: shapeField("x") },
    });
    expect(problems(() => createRegistry(game({ types: [solid] })))).toEqual([
      'type "solid" is an engine primitive and can\'t be redefined',
    ]);
    const decor = defineEntityType({
      type: "decor",
      description: "Mine.",
      base: "decor",
      fields: { at: pointField("x") },
    });
    expect(problems(() => createRegistry(game({ types: [decor] })))).toEqual([
      'type "decor" is an engine primitive and can\'t be redefined',
    ]);
    expect(
      problems(() =>
        createRegistry(
          game({
            actions: [
              { action: "push", keys: [], description: "a" },
              { action: "push", keys: [], description: "b" },
            ],
          }),
        ),
      ),
    ).toEqual(['action "push" is declared twice']);
  });

  it("refuses codes outside the game's namespace", () => {
    const info = { severity: "warn" as const, summary: "s", hint: "h", fixable: false };
    expect(problems(() => createRegistry(game({ issues: { "no-flag": info } })))).toEqual([
      'issue code "no-flag" must be "fake/<code>"',
    ]);
    expect(problems(() => createRegistry(game({ issues: { "other/no-flag": info } })))).toEqual([
      'issue code "other/no-flag" must be "fake/<code>"',
    ]);
  });

  it("refuses types it can't spawn or bulk keys it can't fill", () => {
    const ghost = defineEntityType({ type: "ghost", description: "?", fields: {} });
    const bad = defineEntityType({
      type: "bad",
      description: "?",
      base: "sensor",
      fields: { at: pointField("x") },
      bulk: { form: "shape", description: "x" },
    });
    const name = defineEntityType({
      type: "name",
      description: "?",
      base: "marker",
      fields: { at: pointField("x") },
      bulk: { form: "point", description: "x" },
    });
    expect(problems(() => createRegistry(game({ types: [ghost, bad, name] })))).toEqual([
      'type "ghost" loads but has neither a system nor a base primitive',
      'type "bad" is based on sensor but has no "shape" field',
      'type "bad" has a shape bulk form but no "shape" field',
      'bulk key "name" is a reserved scene key',
    ]);
  });

  it("refuses a spawn order that misses or repeats a type", () => {
    expect(
      problems(() =>
        createRegistry(
          game({ spawnOrder: ["solid", "solid", "sensor", "marker", "prop", "follower", "note"] }),
        ),
      ),
    ).toEqual([
      'spawnOrder lists "solid" twice',
      'spawnOrder names "note", which never loads',
      'spawnOrder misses type "crate"',
      'spawnOrder misses type "flag"',
    ]);
  });

  it("refuses a game id it can't namespace", () => {
    expect(problems(() => createRegistry(game({ id: "engine", issues: {} })))).toEqual([
      'game id "engine" is reserved',
    ]);
    expect(problems(() => createRegistry(game({ id: "Bad Id", issues: {} })))[0]).toMatch(
      /game id "Bad Id" must match/,
    );
  });
});

describe("createRegistry behavior conflicts and default actions", () => {
  const plain = (name: string, over: Record<string, unknown> = {}) =>
    defineBehavior({ name, description: "A behavior.", fields: {}, ...over });

  it("registers the standard behaviors after the first three, in attach order", () => {
    expect(createRegistry().behaviorNames).toEqual([
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
    ]);
    expect(ENGINE_BEHAVIORS.map((b) => b.name)).toEqual(createRegistry().behaviorNames);
    const movers = ["character-top-down", "character-side-view", "nav-agent", "path-follow"];
    const behaviors = createRegistry().behaviors;
    for (const mover of movers) {
      expect([...(behaviors.get(mover)?.conflicts ?? [])].sort()).toEqual(
        movers.filter((m) => m !== mover).sort(),
      );
    }
  });

  it("refuses a conflict naming an unknown behavior, itself or one it requires", () => {
    expect(
      problems(() =>
        createRegistry(
          game({
            behaviors: [
              plain("fake/a", { conflicts: ["fake/ghost"] }),
              plain("fake/b", { conflicts: ["fake/b"] }),
              plain("fake/c", { requires: ["fake/a"], conflicts: ["fake/a"] }),
            ],
          }),
        ),
      ),
    ).toEqual([
      'behavior "fake/a" conflicts with unknown behavior "fake/ghost"',
      'behavior "fake/b" conflicts with itself',
      'behavior "fake/c" both requires and conflicts with "fake/a"',
    ]);
    expect(
      problems(() =>
        createRegistry(game({ behaviors: [plain("fake/a", { conflicts: ["sprite"] })] })),
      ),
    ).toEqual([]);
  });

  it("refuses a type that requires two behaviors that conflict", () => {
    const both = defineEntityType({
      type: "both",
      description: "Two controllers.",
      base: "marker",
      fields: { at: pointField("Where.") },
      behaviors: { required: { "fake/a": {}, "fake/b": {} } },
    });
    expect(
      problems(() =>
        createRegistry(
          game({
            types: [crate, flag, both],
            behaviors: [plain("fake/a"), plain("fake/b", { conflicts: ["fake/a"] })],
          }),
        ),
      ),
    ).toEqual(['type "both" requires "fake/a" and "fake/b", which conflict']);
  });

  it("gives a registry without a game the default actions, and a game only its own", () => {
    const bare = createRegistry();
    expect(bare.actions).toBe(DEFAULT_ACTIONS);
    expect(DEFAULT_ACTIONS.map((a) => [a.action, a.kind])).toEqual([
      ["move", "vector"],
      ["jump", "button"],
    ]);
    for (const a of DEFAULT_ACTIONS)
      for (const b of a.bindings ?? [])
        expect(bindingProblems(b, { kind: a.kind ?? "button", max: 1 }), JSON.stringify(b)).toEqual(
          [],
        );
    const codes = DEFAULT_ACTIONS[0]!.bindings!.flatMap((b) =>
      b.device === "key" ? [b.code] : [],
    );
    expect(codes).toEqual([
      "KeyA",
      "KeyD",
      "KeyW",
      "KeyS",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
    ]);
    expect(DEFAULT_ACTIONS[1]!.bindings).toEqual([
      { device: "key", code: "Space" },
      { device: "pad", button: "south" },
    ]);
    const withGame = createRegistry(game());
    expect(withGame.actionNames).toEqual(["push"]);
    expect(createRegistry(game({ actions: [] })).actionNames).toEqual([]);
    expect(withGame.primitives.actionNames).toEqual(["move", "jump"]);
  });

  it("forbids body and collider on the four types that own a body", () => {
    const r = createRegistry();
    for (const type of ["solid", "sensor", "prop", "follower"]) {
      const allowed = r.behaviorRules(type).allowed;
      expect(allowed, type).not.toContain("body");
      expect(allowed, type).not.toContain("collider");
      expect(allowed, type).toContain("sprite");
    }
    expect(r.behaviorRules("marker").allowed).toContain("body");
    expect(r.behaviorRules("decor").allowed).toContain("collider");
  });

  it("passes the base primitive's ban and ownsBody to a type with no system of its own", () => {
    const goal = defineEntityType({
      type: "goal",
      description: "A finish zone.",
      base: "sensor",
      fields: { shape: shapeField("Zone.") },
      behaviors: { forbidden: ["lifetime"] },
    });
    const winch = defineEntityType({
      type: "winch",
      description: "A prop its own system draws, with no body.",
      base: "prop",
      fields: crate.fields,
      system: () => ({ spawn() {}, despawn() {}, clear() {}, size: () => 0 }),
    });
    const r = createRegistry(game({ types: [crate, flag, goal, winch] }));
    for (const type of ["crate", "goal"]) {
      const allowed = r.behaviorRules(type).allowed;
      expect(allowed, type).not.toContain("body");
      expect(allowed, type).not.toContain("collider");
      expect(allowed, type).toContain("sprite");
    }
    expect(r.behaviorRules("goal").allowed).not.toContain("lifetime");
    expect(r.types.get("crate")?.ownsBody).toBe(true);
    expect(r.types.get("goal")?.ownsBody).toBeUndefined();
    expect(r.behaviorRules("winch").allowed).toContain("collider");
    expect(r.types.get("winch")?.ownsBody).toBeUndefined();
  });

  it("refuses a based type that requires or defaults a behavior its base forbids", () => {
    const pellet = defineEntityType({
      type: "pellet",
      description: "A prop that also asks for a body.",
      base: "prop",
      fields: crate.fields,
      behaviors: { required: { body: {} }, defaults: { collider: { sensor: true } } },
    });
    expect(problems(() => createRegistry(game({ types: [crate, flag, pellet] })))).toEqual(
      expect.arrayContaining([
        'type "pellet" both requires and forbids "body"',
        'type "pellet" gives defaults for "collider", which it forbids',
      ]),
    );
  });
});

describe("createRegistry layers", () => {
  const layer = (name: string, draw = 0) => ({ name, description: `${name}.`, draw });

  it("uses the game's layers, else the defaults", () => {
    expect(createRegistry(game()).layers).toBe(DEFAULT_LAYERS);
    expect(createRegistry().layers).toBe(DEFAULT_LAYERS);
    const layers = [layer("back"), layer("front", 10)];
    expect(createRegistry(game({ layers })).layers).toBe(layers);
  });

  it("refuses no layers, doubled or bad names and non-finite numbers", () => {
    expect(problems(() => createRegistry(game({ layers: [] })))).toEqual([
      "layers must list at least one layer",
    ]);
    expect(
      problems(() =>
        createRegistry(
          game({
            layers: [
              layer("back"),
              layer("back"),
              layer("Front"),
              layer("far", Number.NaN),
              { ...layer("sky"), scroll: [0.5, Number.POSITIVE_INFINITY] },
            ],
          }),
        ),
      ),
    ).toEqual([
      'layer "back" is declared twice',
      `layer "Front" must match ${/^[a-z0-9][a-z0-9-]{0,47}$/}`,
      'layer "far" draw must be a finite number',
      'layer "sky" scroll must be two finite numbers',
    ]);
  });
});

describe("createRegistry field names and settings", () => {
  it("refuses a field name that isn't an identifier", () => {
    const odd = defineEntityType({
      type: "odd",
      description: "Odd fields.",
      base: "marker",
      fields: {
        at: pointField("Where."),
        "@x": z.number().describe("Clashes with the layout."),
        "two words": z.number().describe("Spaces."),
        $ok: z.number().describe("Fine."),
        _ok2: z.number().describe("Fine."),
      },
    });
    expect(problems(() => createRegistry(game({ types: [crate, flag, odd] })))).toEqual([
      `type "odd" field "@x" must match ${/^[A-Za-z_$][A-Za-z0-9_$]*$/}`,
      `type "odd" field "two words" must match ${/^[A-Za-z_$][A-Za-z0-9_$]*$/}`,
    ]);
  });

  it("refuses the reserved fields and a required path that accepts {}", () => {
    const odd = defineEntityType({
      type: "odd",
      description: "Clashing fields.",
      base: "marker",
      fields: {
        at: pointField("Where."),
        params: z.record(z.string(), z.number()).describe("An instance's key."),
        overrides: z.record(z.string(), z.number()).describe("An instance's key."),
        path: z.record(z.string(), z.number()).describe("Empty is valid."),
      },
    });
    expect(problems(() => createRegistry(game({ types: [crate, flag, odd] })))).toEqual([
      `type "odd" redefines the reserved field "params"`,
      `type "odd" redefines the reserved field "overrides"`,
      `type "odd" field "path" accepts {} but is required; an empty path is written as none, so make it optional or reject {}`,
    ]);
    const fine = (path: z.ZodType) =>
      defineEntityType({
        type: "fine",
        description: "A path that formats safely.",
        base: "marker",
        fields: { at: pointField("Where."), path },
      });
    for (const path of [
      z.record(z.string(), z.number()).optional().describe("Optional."),
      z.object({ pts: z.array(z.number()) }).describe("Rejects {}."),
    ])
      expect(problems(() => createRegistry(game({ types: [crate, flag, fine(path)] })))).toEqual(
        [],
      );
  });

  it("refuses a behavior field name that isn't an identifier", () => {
    const odd = defineBehavior({
      name: "fake/odd",
      description: "Odd fields.",
      fields: { "@x": z.number().describe("Clashes."), ok: z.number().describe("Fine.") },
    });
    expect(problems(() => createRegistry(game({ behaviors: [odd] })))).toEqual([
      `behavior "fake/odd" field "@x" must match ${/^[A-Za-z_$][A-Za-z0-9_$]*$/}`,
    ]);
  });

  it("checks a behavior's template against its fields and refine when it registers", () => {
    const timer = (template: Record<string, unknown>) =>
      defineBehavior({
        name: "fake/timer",
        description: "A timer.",
        fields: {
          ticks: z.number().int().min(1).optional().describe("Ticks."),
          ms: z.number().positive().optional().describe("Milliseconds."),
          label: z.string().describe("Required; Add behavior seeds it."),
        },
        refine: (b) =>
          (b.ticks === undefined) !== (b.ms === undefined) ? undefined : "one of ticks or ms",
        template,
      });
    const refusedWith = (template: Record<string, unknown>) =>
      problems(() => createRegistry(game({ behaviors: [timer(template)] })));
    expect(refusedWith({ ticks: 30 })).toEqual([]);
    expect(refusedWith({ tick: 30 })).toEqual([
      'behavior "fake/timer" template: unknown field "tick"; did you mean "ticks"?',
    ]);
    expect(refusedWith({ ticks: 0 })).toEqual([
      expect.stringMatching(/^behavior "fake\/timer" template: field "ticks": /),
    ]);
    expect(refusedWith({ ticks: 30, ms: 500 })).toEqual([
      'behavior "fake/timer" template: one of ticks or ms',
    ]);
    expect(refusedWith({})).toEqual(['behavior "fake/timer" template: one of ticks or ms']);
  });

  it("registers the engine's own behavior templates", () => {
    expect(() => createRegistry()).not.toThrow();
  });

  it("refuses a type with a grid field but no point field at", () => {
    const cells = z.record(z.string(), z.array(z.string())).meta({ kind: "grid" });
    const tiles = (fields: z.ZodRawShape) =>
      defineEntityType({ type: "tiles", description: "Cells.", base: "marker", fields });
    expect(
      problems(() =>
        createRegistry(game({ types: [crate, flag, tiles({ at: pointField("Where."), cells })] })),
      ),
    ).toEqual([]);
    expect(
      problems(() =>
        createRegistry(
          game({
            types: [
              crate,
              flag,
              defineEntityType({
                type: "tiles",
                description: "Cells.",
                system: () => ({ spawn() {}, despawn() {}, clear() {}, size: () => 0 }),
                fields: { where: pointField("Where."), cells },
              }),
            ],
          }),
        ),
      ),
    ).toEqual(['type "tiles" has a grid field but no point field "at"']);
    expect(
      problems(() =>
        createRegistry(
          game({
            types: [
              crate,
              flag,
              tiles({ at: pointField("Where."), cells }),
              defineEntityType({
                type: "rows",
                description: "Cells at a number.",
                base: "marker",
                fields: { at: z.number().describe("Not a point."), cells },
              }),
            ],
          }),
        ),
      ),
    ).toContain('type "rows" has a grid field but no point field "at"');
  });

  it("refuses a game that redefines an engine setting", () => {
    expect(
      problems(() =>
        createRegistry(
          game({ settings: { grid: z.number().describe("Mine."), lives: z.number() } }),
        ),
      ),
    ).toEqual(['settings field "grid" is the engine\'s']);
    expect(
      problems(() =>
        createRegistry(
          game({
            settings: { gravity: z.number(), physics: z.number(), view: z.number() },
          }),
        ),
      ),
    ).toEqual([
      'settings field "gravity" is the engine\'s',
      'settings field "physics" is the engine\'s',
      'settings field "view" is the engine\'s',
    ]);
  });

  it("offers the engine's settings beside the game's", () => {
    const registry = createRegistry(game({ settings: { lives: z.number().optional() } }));
    expect(Object.keys(registry.settings)).toEqual([
      "gravity",
      "physics",
      "grid",
      "view",
      "camera",
      "lives",
    ]);
  });
});

describe("createRegistry time and world", () => {
  it("refuses a time.rate the clock can't run, naming tick-rate-invalid", () => {
    for (const rate of [0, 241, 1.5, Number.NaN]) {
      const found = problems(() => createRegistry(game({ time: { kind: "fixed", rate } })));
      expect(found, String(rate)).toHaveLength(1);
      expect(found[0]).toContain("tick-rate-invalid");
      expect(found[0]).toContain("time.rate");
    }
    expect(() => createRegistry(game({ time: { kind: "fixed", rate: 0 } }))).toThrow(
      /tick-rate-invalid/,
    );
  });

  it("refuses a time.catchUp.maxMs @elapsed's args would refuse", () => {
    for (const maxMs of [-5, Number.NaN, 1.5, Number.POSITIVE_INFINITY, "60000"]) {
      const time = { kind: "fixed", catchUp: { maxMs } } as unknown as TimeModel;
      const found = problems(() => createRegistry(game({ time })));
      expect(found, String(maxMs)).toHaveLength(1);
      expect(found[0]).toContain("time.catchUp.maxMs");
    }
    for (const maxMs of [0, 60_000]) {
      expect(
        createRegistry(game({ time: { kind: "turns", catchUp: { maxMs } } })).time.catchUp,
      ).toEqual({ maxMs });
    }
  });

  it("refuses an unknown time.kind and a non-boolean wakeOnPointerMove", () => {
    const kind = problems(() =>
      createRegistry(game({ time: { kind: "realtime" } as unknown as TimeModel })),
    );
    expect(kind).toHaveLength(1);
    expect(kind[0]).toContain("time.kind");
    const wake = problems(() =>
      createRegistry(
        game({ time: { kind: "event", wakeOnPointerMove: "yes" } as unknown as TimeModel }),
      ),
    );
    expect(wake).toHaveLength(1);
    expect(wake[0]).toContain("time.wakeOnPointerMove");
  });

  it("takes a valid rate, or none, as the registry's time", () => {
    expect(createRegistry(game({ time: { kind: "turns", rate: 240 } })).time).toEqual({
      kind: "turns",
      rate: 240,
    });
    expect(createRegistry(game({ time: { kind: "event" } })).time).toEqual({ kind: "event" });
    expect(createRegistry(game()).time).toEqual({ kind: "fixed", rate: 60 });
  });

  it("accepts world defaults the scene settings would", () => {
    const registry = createRegistry(
      game({
        world: {
          physics: "none",
          gravity: [0, 0],
          grid: { kind: "square", cell: [16, 16] },
          gridWalls: ["solid", "crate"],
          lengthUnit: 50,
        },
      }),
    );
    expect(registry.game?.world?.gravity).toEqual([0, 0]);
    expect(() => createRegistry(game({ world: { gridWalls: [] } }))).not.toThrow();
  });

  it("refuses world defaults the runtime can't use", () => {
    expect(
      problems(() =>
        createRegistry(
          game({
            world: {
              physics: "box2d" as never,
              gravity: [0, Number.POSITIVE_INFINITY],
              grid: { kind: "square" } as never,
              gridWalls: ["boulder", "note"],
              lengthUnit: 0,
            },
          }),
        ),
      ),
    ).toEqual([
      'world.physics must be "rapier" or "none", got "box2d"',
      "world.gravity must be two finite numbers [x, y]",
      "world.grid must be a square or hex grid, as settings.grid takes it",
      'world.gridWalls names unknown type "boulder"',
      'world.gridWalls names "note", which never loads',
      "world.lengthUnit must be a finite number above 0, got 0",
    ]);
    for (const gravity of [[0], [0, 1, 2], ["0", 1]])
      expect(
        problems(() => createRegistry(game({ world: { gravity: gravity as never } }))),
      ).toEqual(["world.gravity must be two finite numbers [x, y]"]);
    for (const lengthUnit of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(problems(() => createRegistry(game({ world: { lengthUnit } })))).toHaveLength(1);
  });
});

describe("createRegistry commands", () => {
  const command = { description: "A test command.", args: z.strictObject({}) };

  it("registers the engine's commands, then the game's", () => {
    const registry = createRegistry(game({ commands: { end: command, "move-to": command } }));
    expect(registry.commandNames).toEqual(["@elapsed", "@nav", "end", "move-to"]);
    expect(registry.commands.get("move-to")).toBe(command);
  });

  it("refuses game command names that take the engine's @ or don't match the pattern", () => {
    expect(
      problems(() =>
        createRegistry(
          game({
            commands: {
              "@elapsed": command,
              "@mine": command,
              Move: command,
              "two words": command,
              "-dash": command,
              ["x".repeat(49)]: command,
              ok: command,
            },
          }),
        ),
      ),
    ).toEqual([
      `command "@elapsed" can't start with "@"; those are the engine's`,
      `command "@mine" can't start with "@"; those are the engine's`,
      'command "Move" must match /^[a-z0-9][a-z0-9-]{0,47}$/',
      'command "two words" must match /^[a-z0-9][a-z0-9-]{0,47}$/',
      'command "-dash" must match /^[a-z0-9][a-z0-9-]{0,47}$/',
      `command "${"x".repeat(49)}" must match /^[a-z0-9][a-z0-9-]{0,47}$/`,
    ]);
    expect(() => createRegistry(game({ commands: { ["x".repeat(48)]: command } }))).not.toThrow();
  });
});

const entry = (id: string, kind: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind,
  path,
  created: { at: 0, by: "test" },
});

function viewOf(entries: AssetEntry[]): ProjectView {
  return {
    state: {
      meta: { projectId: "fake", layout: 1, name: "Fake" },
      assets: Object.fromEntries(entries.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    byId: new Map(entries.map((e) => [e.id, e])),
    byPath: new Map(entries.map((e) => [e.path, e])),
    byKey: new Map(entries.map((e) => [e.key, e])),
    deleted: [],
    issues: [],
    repairs: new Map(),
    tree: () => [],
  };
}

describe("project materials", () => {
  const rubber: ProjectMaterialDef = {
    description: "Bouncy.",
    physics: { friction: 0.4, restitution: 0.9, impulse: { x: 0, y: -500 } },
    style: { fill: 0xe05a5a },
  };
  const paint: ProjectMaterialDef = { description: "Only a look.", style: { fill: 0x112233 } };

  it("overlay the game's code materials by name, keeping their place", () => {
    const registry = createRegistry(game(), {
      materials: {
        mud: { description: "Wetter.", physics: { friction: 3, restitution: 0.1 } },
        rubber,
      },
    });
    expect(registry.materialNames).toEqual(["mud", "rubber"]);
    expect(registry.materials.get("mud")).toEqual({
      friction: 3,
      restitution: 0.1,
      description: "Wetter.",
    });
    expect(registry.materials.get("rubber")).toEqual({
      friction: 0.4,
      restitution: 0.9,
      impulse: { x: 0, y: -500 },
      description: "Bouncy.",
      style: { fill: 0xe05a5a },
    });
    expect(registry.bulkKeys.map((b) => b.key)).toContain("solid:rubber");
    expect(createRegistry(game()).materialNames).toEqual(["mud"]);
  });

  it("overlay the engine's registry too, and refuse a bad name", () => {
    expect(createRegistry(null, { materials: { rubber } }).materialNames).toEqual(["rubber"]);
    expect(problems(() => createRegistry(null, { materials: { "Bad Name": rubber } }))).toEqual([
      `material "Bad Name" must match ${/^[a-z0-9][a-z0-9-]{0,47}$/}`,
    ]);
  });

  it("leave a material without physics out of the body choices, over a code one too", () => {
    const registry = createRegistry(game(), { materials: { paint, mud: paint } });
    expect(registry.materialNames).toEqual([]);
    const scene = {
      v: 3,
      game: "fake",
      name: "s",
      bounds: [0, 0, 100, 100],
      entities: [{ id: "floor", type: "solid", shape: ["box", 50, 90, 50, 10], material: "paint" }],
    };
    const physical = createRegistry(game(), { materials: { paint: rubber } });
    expect(parseScene(scene, physical).ok).toBe(true);
    const result = parseScene(scene, registry);
    const unknown = parseScene(
      { ...scene, entities: [{ ...scene.entities[0], material: "nope" }] },
      createRegistry(game()),
    );
    expect(result.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    const codes = (r: typeof result) => (r.ok ? [] : r.issues.map((i) => [i.code, i.path]));
    expect(codes(result)).toEqual(codes(unknown));
    expect(codes(result)).toEqual([["schema", "/entities/0/material"]]);
  });

  it("withProject builds the overlay from a project's material assets", () => {
    const view = viewOf([
      entry("rubber", "material", "materials/rubber.json"),
      entry("mud", "material", "materials/mud.json"),
      entry("broken", "material", "materials/broken.json"),
      entry("deck", "data-table", "data/deck.json"),
    ]);
    const values = new Map<string, unknown>([
      [
        "rubber",
        {
          kind: "material",
          v: 1,
          description: "Bouncy.",
          physics: { friction: 0.4, restitution: 0.9 },
          render: { style: { fill: "#e05a5a" } },
        },
      ],
      ["mud", { kind: "material", v: 1, description: "Paint over mud." }],
      ["broken", { kind: "material", v: 1 }],
      ["deck", { kind: "data-table", v: 1, table: "card", rows: [] }],
    ]);
    const base = createRegistry(game());
    const registry = withProject(base, view, values);
    expect(registry.game).toBe(base.game);
    expect(registry.materialNames).toEqual(["rubber"]);
    expect(registry.materials.get("rubber")).toEqual({
      friction: 0.4,
      restitution: 0.9,
      description: "Bouncy.",
      style: { fill: 0xe05a5a },
    });
  });

  it("withProject offers the project's live asset ids by kind, sorted", () => {
    const deleted = {
      ...entry("old", "material", "materials/old.json"),
      deleted: { at: 1, by: "t" },
    };
    const view = {
      ...viewOf([
        entry("rubber", "material", "materials/rubber.json"),
        entry("deck", "data-table", "data/deck.json"),
        entry("ice", "material", "materials/ice.json"),
        entry("cards", "data-table", "data/cards.json"),
      ]),
      deleted: [deleted],
    };
    const seen: (readonly string[])[] = [];
    const probe = defineEntityType({
      type: "probe",
      description: "Reads the asset choices.",
      base: "marker",
      fields: (env) => {
        seen.push(env.assets(["material"]), env.assets(["data-table", "material"]));
        return { at: pointField("Where.") };
      },
    });
    const base = createRegistry(game({ types: [crate, flag, probe] }));
    expect(seen).toEqual([[], []]);
    seen.length = 0;
    withProject(base, view, new Map());
    expect(seen).toEqual([
      ["ice", "rubber"],
      ["cards", "deck", "ice", "rubber"],
    ]);
  });
});

describe("spawn-only types", () => {
  const bolt = defineEntityType({
    type: "bolt",
    description: "A shot game code fires.",
    base: "marker",
    spawnOnly: true,
    fields: { at: pointField("Where it starts.") },
  });

  it("load and take a spawn group, but aren't placeable", () => {
    const r = createRegistry(game({ types: [crate, flag, bolt] }));
    expect(r.spawnGroupOf("bolt")).toBeDefined();
    expect(r.spawnGroups.flat()).toContain("bolt");
    expect(isSpawnOnly(r, "bolt")).toBe(true);
    expect(isSpawnOnly(r, "crate")).toBe(false);
    expect(isSpawnOnly(r, "nope")).toBe(false);
    expect(placeableTypes(r)).toEqual(r.typeNames.filter((t) => t !== "bolt"));
  });

  it("must be listed by an explicit spawnOrder like any loadable type", () => {
    const order = ["solid", "sensor", "crate", "prop", "flag", "marker", "follower"];
    expect(
      problems(() => createRegistry(game({ types: [crate, flag, bolt], spawnOrder: order }))),
    ).toEqual(['spawnOrder misses type "bolt"']);
    const r = createRegistry(game({ types: [crate, flag, bolt], spawnOrder: [...order, "bolt"] }));
    expect(r.spawnGroupOf("bolt")).toBe(order.length);
  });

  it("are refused when they never load or have a bulk form", () => {
    const ghost = defineEntityType({ ...bolt, type: "ghost", loads: false });
    const rain = defineEntityType({
      ...bolt,
      type: "rain",
      bulk: { form: "point", description: "Drops." },
    });
    expect(problems(() => createRegistry(game({ types: [crate, flag, ghost, rain] })))).toEqual([
      'type "ghost" is spawn-only but never loads',
      'type "rain" is spawn-only and can\'t have a bulk form',
    ]);
  });

  it("are absent from the scene schema, and a scene naming one doesn't parse", () => {
    const r = createRegistry(game({ types: [crate, flag, bolt] }));
    const entity = sceneSchemaFor(r).shape.entities.unwrap().element as unknown as {
      options: { shape: { type: { value: string } } }[];
    };
    const types = entity.options.map((o) => o.shape.type.value);
    expect(types).toContain("crate");
    expect(types).not.toContain("bolt");
    const parsed = parseScene(
      {
        v: 1,
        game: "fake",
        name: "s",
        bounds: [0, 0, 100, 100],
        entities: [{ id: "b", type: "bolt", at: [1, 1] }],
      },
      r,
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.issues.map((i) => i.code)).toEqual(["unknown-type"]);
  });
});
