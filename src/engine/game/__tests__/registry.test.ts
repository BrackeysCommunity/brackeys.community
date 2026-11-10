// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import type { AssetEntry, ProjectView } from "../../project/types";
import { DEFAULT_LAYERS } from "../../scene/layers";
import { parseScene } from "../../scene/parse";
import { defineBehavior } from "../behaviors";
import {
  createRegistry,
  defineEntityType,
  defineGame,
  RegistryError,
  withProject,
  type ProjectMaterialDef,
} from "../define";
import { pointField, shapeField } from "../fields";
import { PRIMITIVE_TYPES, type GameDefinition } from "../types";

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
    expect(r.runResults).toEqual(["timeout", "script-end", "stuck", "quit", "won"]);
    expect(r.predicateNames).toEqual(["event", "tick", "grounded"]);
    expect(createRegistry().runResults).toEqual(["timeout", "script-end", "stuck", "quit"]);
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

describe("createRegistry", () => {
  it("always has the primitives, first, without a game", () => {
    const r = createRegistry();
    expect(r.id).toBe("engine");
    expect(r.typeNames).toEqual([...PRIMITIVE_TYPES]);
    expect(r.schemaId).toBe("urn:jams-engine:scene:v3");
    expect(r.spawnGroups).toEqual([
      ["solid"],
      ["sensor"],
      ["marker"],
      ["prop"],
      ["follower"],
      ["decor"],
      ["nav"],
    ]);
    expect(r.bulkKeys.map((b) => b.key)).toEqual(["solid"]);
    expect(r.actionNames).toEqual([]);
  });

  it("registers a game's types after the primitives", () => {
    const r = createRegistry(game());
    expect(r.typeNames).toEqual([...PRIMITIVE_TYPES, "crate", "flag"]);
    expect(r.types.get("crate")).toMatchObject({ origin: "fake", base: "prop" });
    expect(r.types.get("solid")?.origin).toBe("engine");
    expect(r.schemaId).toBe("urn:jams-engine:scene:fake:v3");
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

  it("spawns decor and nav last when an explicit spawn order leaves them out", () => {
    const r = createRegistry(
      game({
        spawnOrder: [
          "decor",
          "nav",
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
    expect(r.spawnGroups.slice(0, 2)).toEqual([["decor"], ["nav"]]);
    const without = createRegistry(
      game({ spawnOrder: ["solid", "sensor", "crate", "prop", "flag", "marker", "follower"] }),
    );
    expect(without.spawnGroups.slice(-2)).toEqual([["decor"], ["nav"]]);
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
    ]);
    expect(r.bulkKeys.map((b) => b.key)).toEqual(["solid", "solid:mud", "flag"]);
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
    expect(Object.keys(registry.settings)).toEqual(["gravity", "physics", "grid", "view", "lives"]);
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
    expect(registry.commandNames).toEqual(["@elapsed", "end", "move-to"]);
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
