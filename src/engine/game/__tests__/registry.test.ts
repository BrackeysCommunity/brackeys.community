// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import type { AssetEntry, ProjectView } from "../../project/types";
import { parseScene } from "../../scene/parse";
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
    expect(r.schemaId).toBe("urn:jams-engine:scene:v2");
    expect(r.spawnGroups).toEqual([["solid"], ["sensor"], ["marker"], ["prop"], ["follower"]]);
    expect(r.bulkKeys.map((b) => b.key)).toEqual(["solid"]);
    expect(r.actionNames).toEqual([]);
  });

  it("registers a game's types after the primitives", () => {
    const r = createRegistry(game());
    expect(r.typeNames).toEqual([...PRIMITIVE_TYPES, "crate", "flag"]);
    expect(r.types.get("crate")).toMatchObject({ origin: "fake", base: "prop" });
    expect(r.types.get("solid")?.origin).toBe("engine");
    expect(r.schemaId).toBe("urn:jams-engine:scene:fake:v2");
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
      v: 2,
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
});
