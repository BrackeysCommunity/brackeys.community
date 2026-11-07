// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineEntityType, defineGame, RegistryError } from "../define";
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
