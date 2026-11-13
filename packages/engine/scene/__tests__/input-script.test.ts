import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { testGame } from "../../__tests__/fixtures/test-game";
import { sequentialKeys } from "../../collab/keys";
import { layoutFromDoc, layoutPatch, layoutToDoc } from "../../collab/layout";
import { createRegistry } from "../../game/define";
import { compileInputScript } from "../../headless/compile-input-script";
import { docKindJsonSchema, parseAssetDoc } from "../../project/kinds";
import type { DocKindDef } from "../../project/kinds/define";
import { inputMapKind } from "../../project/kinds/input-map";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import { formatInputScript, INPUT_SCRIPT_LAYOUT } from "../format";
import {
  INPUT_SCRIPT_MIGRATIONS,
  inputScriptJsonSchema,
  inputScriptSchemaFor,
  inputScriptSchemaId,
  inputScriptSchemasFor,
  migrateInputScript,
  parseInputScript,
  scriptSeatLimit,
  scriptShapeIssues,
} from "../input-script";
import { SCHEMA_ID_BASE, undescribedProperties } from "../json-schema";
import { engine } from "./fixtures/fake-game";

const FILE = new URL("../input-script.schema.json", import.meta.url);
const game = createRegistry(testGame);

type Defs = { $defs: Record<string, { enum?: string[]; properties?: Record<string, unknown> }> };

describe("input-script.schema.json", () => {
  it("matches inputScriptJsonSchema for the engine-only registry (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = inputScriptJsonSchema(engine);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(FILE, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(fresh);
  });

  it("has a URN id beside the scene schema's, and the agent surface version", () => {
    const schema = inputScriptJsonSchema(engine);
    expect(schema.$id).toBe(`${SCHEMA_ID_BASE}input-script:v2`);
    expect(inputScriptSchemaId(game)).toBe(`${SCHEMA_ID_BASE}input-script:test-game:v2`);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
  });

  it("names the game's actions, its predicates and its play options", () => {
    const schema = inputScriptJsonSchema(game) as Defs & { properties: Record<string, unknown> };
    expect(schema.$defs.Action!.enum).toEqual(["left", "right", "push"]);
    expect(Object.keys(schema.$defs.Until!.properties!)).toEqual([
      "event",
      "tick",
      "exists",
      "count",
      "near",
      "scene",
      "persist",
      "past",
    ]);
    expect(schema.properties).toHaveProperty("game");
    const bare = inputScriptJsonSchema(engine) as Defs & { properties: Record<string, unknown> };
    expect(bare.properties).not.toHaveProperty("game");
    expect(Object.keys(bare.$defs.Until!.properties!)).toEqual([
      "event",
      "tick",
      "exists",
      "count",
      "near",
      "scene",
      "persist",
    ]);
  });

  it("describes durations at the game's rate, and slots for an event or turns game", () => {
    const text = (g: typeof testGame) => JSON.stringify(inputScriptJsonSchema(createRegistry(g)));
    const fixed = text(testGame);
    expect(fixed).toContain("at 60 ticks a second");
    expect(fixed).toContain("(default 1800, 30 s)");
    expect(fixed).not.toContain("slots");
    const at30 = text({ ...testGame, time: { kind: "fixed", rate: 30 } });
    expect(at30).toContain("at 30 ticks a second");
    expect(at30).toContain("rounded to whole 30 Hz ticks");
    expect(at30).toContain("(30 a second)");
    expect(at30).toContain("(default 1800, 60 s)");
    expect(at30).not.toContain("60 ticks a second");
    expect(text({ ...testGame, time: { kind: "turns" } })).toContain(
      "in this turns game a slot nothing wakes",
    );
  });

  it("has command and elapse steps: the game's commands, with their args checked", () => {
    const schema = inputScriptJsonSchema(game) as Defs;
    const json = JSON.stringify(schema.$defs.Step);
    expect(json).toContain('"enum":["nudge"]');
    expect(json).toContain("nudge (Move the avatar along x at once.)");
    expect(json).toContain('"elapse"');
    expect(json).not.toContain('"@elapsed"]');
    const zod = inputScriptSchemaFor(game);
    const script = (step: unknown) => zod.safeParse({ v: 2, steps: [step] }).success;
    expect(script({ command: "nudge", args: { dx: 3 } })).toBe(true);
    expect(script({ command: "nudge", args: { dx: "3" } })).toBe(false);
    expect(script({ command: "nudge" })).toBe(false);
    expect(script({ command: "@elapsed", args: { ms: 3 } })).toBe(false);
    expect(script({ elapse: 100 })).toBe(false);
    const away = createRegistry({ ...testGame, time: { kind: "fixed", catchUp: { maxMs: 10 } } });
    expect(inputScriptSchemaFor(away).safeParse({ v: 2, steps: [{ elapse: 100 }] }).success).toBe(
      true,
    );
    expect(JSON.stringify(inputScriptJsonSchema(away))).toContain("clamped to 10");
    const bare = JSON.stringify((inputScriptJsonSchema(engine) as Defs).$defs.Step);
    expect(bare).toContain("this registry's game declares none");
  });

  it("has exists and count predicates over the registry's entity types", () => {
    const schema = inputScriptJsonSchema(game) as Defs;
    expect(Object.keys(schema.$defs.CountMatch!.properties!)).toEqual([
      "type",
      "tag",
      "enabled",
      "min",
      "max",
      "eq",
    ]);
    const json = JSON.stringify(schema.$defs.CountMatch);
    expect(json).toContain('"$ref":"#/$defs/EntityType"');
    expect(JSON.stringify(schema.$defs.EntityType)).toContain('"lamp"');
    expect(json).toContain('{"required":["eq"]}');
    expect(JSON.stringify(schema.$defs.ExistsMatch)).toContain('"const":false');
    const zod = inputScriptSchemaFor(game);
    const until = (u: unknown) => zod.safeParse({ v: 2, steps: [{ hold: [], until: u }] }).success;
    expect(until({ exists: "boss#1" })).toBe(true);
    expect(until({ exists: { id: "boss#1", enabled: false } })).toBe(true);
    expect(until({ exists: { id: "boss#1", enabled: true } })).toBe(false);
    expect(until({ count: { type: "lamp", max: 0 } })).toBe(true);
    expect(until({ count: { tag: "coin", min: 3, enabled: true } })).toBe(true);
    expect(until({ count: { type: "lamp" } })).toBe(false);
    expect(until({ count: { type: "ghost", min: 1 } })).toBe(false);
  });

  it("has a persist predicate: a JSON Pointer and eq, gte or lte", () => {
    const schema = inputScriptJsonSchema(game) as Defs;
    expect(Object.keys(schema.$defs.PersistMatch!.properties!)).toEqual([
      "pointer",
      "eq",
      "gte",
      "lte",
    ]);
    expect(JSON.stringify(schema.$defs.Until)).toContain(
      '"persist":{"$ref":"#/$defs/PersistMatch"}',
    );
    const zod = inputScriptSchemaFor(game);
    const until = (u: unknown) => zod.safeParse({ v: 2, steps: [{ hold: [], until: u }] }).success;
    expect(until({ persist: { pointer: "/coins", gte: 3 } })).toBe(true);
    expect(until({ persist: { pointer: "/level", eq: "cellar" } })).toBe(true);
    expect(until({ persist: { pointer: "", eq: { coins: 1, keys: [null] } } })).toBe(true);
    expect(until({ persist: { pointer: "/flags/a~1b", eq: null } })).toBe(true);
    expect(until({ persist: { pointer: "/coins" } })).toBe(false);
    expect(until({ persist: { pointer: "coins", eq: 1 } })).toBe(false);
    expect(until({ persist: { pointer: "/a~2", eq: 1 } })).toBe(false);
    expect(until({ persist: { pointer: "/coins", gte: "3" } })).toBe(false);
    expect(until({ persist: { pointer: "/coins", eq: 1, past: 2 } })).toBe(false);
  });

  it("has a scene predicate: a scene's asset id", () => {
    const schema = inputScriptJsonSchema(game) as Defs;
    expect(schema.$defs.Until!.properties!.scene).toMatchObject({
      type: "string",
      pattern: "^[a-z0-9][a-z0-9-]{0,47}$",
    });
    const zod = inputScriptSchemaFor(game);
    const until = (u: unknown) => zod.safeParse({ v: 2, steps: [{ hold: [], until: u }] }).success;
    expect(until({ scene: "level-2" })).toBe(true);
    expect(until({ scene: "level-2", tick: 30 })).toBe(true);
    expect(until({ scene: "Level 2" })).toBe(false);
    expect(until({ scene: "" })).toBe(false);
    expect(until({ scene: 2 })).toBe(false);
    const v1 = { v: 1, steps: [{ hold: [], until: { scene: "menu" } }] };
    const lifted = migrateInputScript(v1, pads(32));
    expect(lifted.ok && lifted.script).toMatchObject({ steps: [{ until: { scene: "menu" } }] });
  });

  it("keeps a v1 script's persist bounds as they are: they aren't lengths", () => {
    const v1 = { v: 1, steps: [{ hold: [], until: { persist: { pointer: "/x", gte: 64 } } }] };
    const lifted = migrateInputScript(v1, pads(32));
    expect(lifted.ok && lifted.script).toMatchObject({
      v: 2,
      steps: [{ until: { persist: { pointer: "/x", gte: 64 } } }],
    });
  });

  it("describes every property", () => {
    expect(undescribedProperties(inputScriptJsonSchema(engine))).toEqual([]);
  });

  it("parses a script with the zod schema it is generated from", () => {
    const schema = inputScriptSchemaFor(game);
    expect(schema).toBe(inputScriptSchemaFor(game));
    const ok = schema.safeParse({
      v: 2,
      steps: [
        { hold: ["right"], until: { event: { type: "goal" }, past: 3 } },
        { press: ["left", "push"] },
        { wait: 2 },
      ],
    });
    expect(ok.success).toBe(true);
    expect(schema.safeParse({ v: 2, steps: [{ hold: ["jump"], for: 1 }] }).success).toBe(false);
    expect(schema.safeParse({ v: 2, steps: [{ hold: [], for: 1, forMs: 3 }] }).success).toBe(false);
  });

  it("takes a seed, a number or a string, in its header and passes it to the run", () => {
    const schema = inputScriptSchemaFor(game);
    const steps = [{ wait: 1 }];
    for (const seed of [7, "seven"]) {
      expect(schema.safeParse({ v: 2, seed, steps }).success).toBe(true);
      const compiled = compileInputScript({ v: 2, seed, steps }, game);
      expect(compiled.ok && compiled.script.play).toEqual({ seed });
    }
    for (const seed of [true, null, { n: 1 }, Number.NaN])
      expect(schema.safeParse({ v: 2, seed, steps }).success).toBe(false);
    const unseeded = compileInputScript({ v: 2, steps }, game);
    expect(unseeded.ok && unseeded.script.play).toEqual({});
    const props = (inputScriptJsonSchema(engine) as { properties: Record<string, unknown> })
      .properties;
    expect(props.seed).toMatchObject({ anyOf: [{ type: "number" }, { type: "string" }] });
  });
});

/** The test game with analog actions, two seats and px per metre `ppm`. */
const pads = (ppm = 100) =>
  createRegistry({
    ...testGame,
    world: { ...testGame.world, lengthUnit: ppm },
    input: { players: { max: 2, join: "press" } },
    actions: [
      ...testGame.actions,
      { action: "steer", kind: "axis", description: "Steer." },
      { action: "move", kind: "vector", description: "Walk." },
    ],
  });

describe("input-script v2 steps", () => {
  const two = pads();
  const ok = (script: Record<string, unknown>, registry = two) =>
    inputScriptSchemaFor(registry).safeParse({ v: 2, ...script }).success;
  const step = (s: unknown, registry = two) => ok({ steps: [s] }, registry);

  it("set holds axis values and vector pairs, alone or beside hold, for a duration", () => {
    expect(step({ set: { steer: -0.5 }, for: 30 })).toBe(true);
    expect(step({ set: { move: [1, 0] }, forMs: 100 })).toBe(true);
    expect(step({ set: { move: [0.6, 0.8] }, until: { tick: 9 }, max: 20 })).toBe(true);
    expect(step({ hold: ["right"], set: { steer: 1 }, for: 3 })).toBe(true);
    expect(step({ set: { steer: 1 } })).toBe(false);
    expect(step({ set: {}, for: 1 })).toBe(false);
    expect(step({ set: { steer: 1.5 }, for: 1 })).toBe(false);
    expect(step({ set: { steer: [1, 0] }, for: 1 })).toBe(false);
    expect(step({ set: { move: 1 }, for: 1 })).toBe(false);
    expect(step({ set: { move: [1, 1] }, for: 1 })).toBe(false);
    expect(step({ set: { right: 1 }, for: 1 })).toBe(false);
    expect(step({ set: { steer: 1 }, for: 1 }, game)).toBe(false);
    const json = JSON.stringify((inputScriptJsonSchema(two) as Defs).$defs.AnalogSet);
    expect(json).toContain('"steer"');
    expect(json).toContain('"move"');
    expect(json).not.toContain('"right"');
    expect(undescribedProperties(inputScriptJsonSchema(two))).toEqual([]);
  });

  it("pointer moves, presses, releases and drags, for one slot or a duration", () => {
    expect(step({ pointer: { at: [4, 3], press: "primary" } })).toBe(true);
    expect(step({ pointer: { at: [4, 3], drag: [6, 3], release: "primary" }, for: 20 })).toBe(true);
    expect(step({ pointer: { at: [4, 3] }, until: { tick: 5 } })).toBe(true);
    expect(step({ pointer: { at: [4, 3], press: "thumb" } })).toBe(false);
    expect(step({ pointer: { press: "primary" } })).toBe(false);
    expect(step({ pointer: { at: [4, 3] }, max: 3 })).toBe(false);
    expect(step({ pointer: { at: [4, 3] }, hold: [], for: 1 })).toBe(false);
    const press = { at: [4, 3], press: "primary", release: "primary" };
    expect(step({ pointer: press })).toBe(false);
    expect(step({ pointer: press, for: 1 })).toBe(false);
    expect(step({ pointer: press, for: 2 })).toBe(true);
    expect(step({ pointer: { at: [4, 3], drag: [6, 3] }, until: { tick: 5 } })).toBe(false);
    expect(step({ pointer: { at: [4, 3], release: "primary" }, until: { tick: 5 } })).toBe(false);
    const props = (inputScriptJsonSchema(two) as Defs).$defs.ScriptPointer!.properties!;
    expect(JSON.stringify(props.at)).toContain("world metres");
  });

  it("join and leave name a device for the track's seat", () => {
    for (const device of ["keyboard", "pointer", "touch", "pad:0", "pad:12"]) {
      expect(step({ join: device })).toBe(true);
      expect(step({ leave: device })).toBe(true);
    }
    for (const device of ["pad", "pad:x", "mouse", 0]) expect(step({ join: device })).toBe(false);
    expect(step({ join: "pad:0", for: 3 })).toBe(false);
  });

  it("nav sends a nav agent to a point or after an entity, for one slot", () => {
    expect(step({ nav: { id: "guard", to: [4, 1.5] } })).toBe(true);
    expect(step({ nav: { id: "guard#1", to: "hero" } })).toBe(true);
    expect(step({ nav: { id: "guard", to: [4] } })).toBe(false);
    expect(step({ nav: { id: "", to: "hero" } })).toBe(false);
    expect(step({ nav: { id: "guard" } })).toBe(false);
    expect(step({ nav: { id: "guard", to: "hero", within: 1 } })).toBe(false);
    expect(step({ nav: { id: "guard", to: "hero" }, for: 3 })).toBe(false);
    const nav = (inputScriptJsonSchema(two) as Defs).$defs.NavDestination!;
    expect(Object.keys(nav.properties!)).toEqual(["id", "to"]);
    expect(JSON.stringify(nav.properties!.to)).toContain("world metres");
    const parsed = parseInputScript({ v: 2, steps: [{ nav: { id: "guard", to: [4, 1.5] } }] }, two);
    expect(parsed).toEqual({
      ok: true,
      script: { v: 2, steps: [{ nav: { id: "guard", to: [4, 1.5] } }] },
    });
  });

  it("keeps command, elapse and the predicates", () => {
    expect(step({ command: "nudge", args: { dx: 3 } })).toBe(true);
    expect(step({ hold: [], until: { past: 2, count: { type: "lamp", min: 1 } } })).toBe(true);
  });

  it("has exactly one of steps or tracks", () => {
    const steps = [{ wait: 1 }];
    expect(ok({ steps })).toBe(true);
    expect(ok({ tracks: [{ player: 0, steps }] })).toBe(true);
    expect(ok({})).toBe(false);
    expect(ok({ steps, tracks: [{ player: 0, steps }] })).toBe(false);
    expect(ok({ tracks: [] })).toBe(false);
    expect(ok({ tracks: [{ player: 0, steps: [] }] })).toBe(false);
    const head = inputScriptSchemasFor(two).head;
    expect(head.safeParse({ v: 2, steps, tracks: [] }).success).toBe(false);
    expect(scriptShapeIssues({ steps, tracks: [{ player: 0, steps }] }, two)).toEqual([
      { path: "/tracks", message: "a script has `steps` or `tracks`, not both" },
    ]);
    expect(scriptShapeIssues({}, two)[0]!.message).toContain("needs `steps`");
    const schema = inputScriptJsonSchema(two);
    expect(schema.oneOf).toEqual([{ required: ["steps"] }, { required: ["tracks"] }]);
  });

  it("drives seats the run has, one track each; players widens them", () => {
    const steps = [{ wait: 1 }];
    const tracks = (...players: number[]) => players.map((player) => ({ player, steps }));
    expect(ok({ tracks: tracks(0, 1) })).toBe(true);
    expect(ok({ tracks: tracks(1) })).toBe(true);
    expect(ok({ tracks: tracks(2) })).toBe(false);
    expect(ok({ players: 3, tracks: tracks(2) })).toBe(true);
    expect(ok({ tracks: tracks(1) }, game)).toBe(false);
    expect(ok({ players: 9, steps })).toBe(false);
    expect(ok({ players: 0, steps })).toBe(false);
    const issues = scriptShapeIssues({ tracks: tracks(0, 2, 0) }, two);
    expect(issues.map((i) => i.path)).toEqual(["/tracks/1/player", "/tracks/2/player"]);
    expect(issues[1]!.message).toBe("tracks 0 and 2 both drive seat 0; a seat has one track");
    expect(scriptShapeIssues({ players: 9, steps }, two)).toMatchObject([
      { path: "/players", message: "players must be a whole number from 1 to 8; got 9" },
    ]);
  });

  it("drives the seats the project input map gives over the game's", () => {
    const steps = [{ wait: 1 }];
    const tracks = (...players: number[]) => players.map((player) => ({ player, steps }));
    const four = { max: 4, join: "press" } as const;
    const one = { max: 1, join: "auto" } as const;
    expect(scriptSeatLimit(two)).toBe(2);
    expect(scriptSeatLimit(two, four)).toBe(4);
    expect(scriptSeatLimit(two, one)).toBe(1);
    expect(scriptSeatLimit(game)).toBe(1);
    expect(scriptSeatLimit(game, four)).toBe(4);
    expect(scriptSeatLimit(two, { max: 99, join: "auto" })).toBe(8);

    expect(scriptShapeIssues({ tracks: tracks(0, 3) }, two)).toMatchObject([
      { path: "/tracks/1/player" },
    ]);
    expect(scriptShapeIssues({ tracks: tracks(0, 3) }, two, four)).toEqual([]);
    expect(scriptShapeIssues({ tracks: tracks(4) }, two, four)).toMatchObject([
      { path: "/tracks/0/player" },
    ]);
    expect(scriptShapeIssues({ tracks: tracks(1) }, two, one)).toMatchObject([
      { path: "/tracks/0/player" },
    ]);
    expect(scriptShapeIssues({ players: 2, tracks: tracks(1) }, two, one)).toEqual([]);

    const script = { v: 2, tracks: tracks(0, 3) };
    expect(inputScriptSchemaFor(two).safeParse(script).success).toBe(false);
    expect(inputScriptSchemaFor(two, four).safeParse(script).success).toBe(true);
    expect(inputScriptSchemaFor(two, four)).toBe(inputScriptSchemaFor(two, four));
    expect(inputScriptSchemaFor(two, { max: 2, join: "host" })).toBe(inputScriptSchemaFor(two));
    expect(parseInputScript(script, two).ok).toBe(false);
    expect(parseInputScript(script, two, four)).toMatchObject({ ok: true, script });
  });

  it("parses the spec's two-seat example", () => {
    const parsed = parseInputScript(
      {
        v: 2,
        scene: "arena",
        seed: 7,
        players: 2,
        maxTicks: 1800,
        tracks: [
          {
            player: 0,
            steps: [
              { set: { move: [1, 0] }, for: 30 },
              { press: "push" },
              { pointer: { at: [4, 3], press: "primary" } },
              { pointer: { at: [4, 3], drag: [6, 3], release: "primary" }, for: 20 },
            ],
          },
          {
            player: 1,
            steps: [
              { join: "pad:0" },
              {
                hold: ["push"],
                set: { move: [-1, 0] },
                until: { event: "contact:start" },
                max: 120,
              },
            ],
          },
        ],
      },
      two,
    );
    expect(parsed).toMatchObject({ ok: true, script: { v: 2, players: 2 } });
    expect(parsed.ok && "migratedFrom" in parsed).toBe(false);
  });
});

describe("input-script UI-only actions", () => {
  const ui = createRegistry({
    ...testGame,
    actions: [
      ...testGame.actions,
      { action: "confirm", ui: true, description: "Confirm the menu choice." },
      { action: "cursor", ui: true, kind: "vector", description: "Move the cursor." },
      { action: "steer", kind: "axis", description: "Steer." },
    ],
  });
  const HINT = "UI actions don't reach the simulation; send a command";

  it("marks them x-ui in the action enum and the analog set, beside the simulation's", () => {
    const schema = inputScriptJsonSchema(ui) as {
      $defs: Record<string, { anyOf?: unknown[]; properties?: Record<string, unknown> }>;
    };
    expect(schema.$defs.Action!.anyOf).toEqual([
      expect.objectContaining({ enum: ["left", "right", "push", "steer"] }),
      expect.objectContaining({ enum: ["confirm", "cursor"], "x-ui": true }),
    ]);
    expect(schema.$defs.AnalogSet!.properties!.cursor).toMatchObject({ "x-ui": true });
    expect(schema.$defs.AnalogSet!.properties!.steer).not.toHaveProperty("x-ui");
    expect(undescribedProperties(inputScriptJsonSchema(ui))).toEqual([]);
    // A game with no UI-only action keeps its plain enum.
    expect((inputScriptJsonSchema(game) as Defs).$defs.Action!.enum).toEqual([
      "left",
      "right",
      "push",
    ]);
  });

  it("marks them x-ui where the input-map kind names an action, which still binds them", () => {
    const schema = docKindJsonSchema(inputMapKind as DocKindDef, { registry: ui, project: null });
    const json = JSON.stringify(schema);
    const actions = (
      schema as { properties: Record<string, { items: { properties: Record<string, unknown> } }> }
    ).properties;
    const marked = {
      anyOf: [
        { enum: ["left", "right", "push", "steer"] },
        { enum: ["confirm", "cursor"], "x-ui": true },
      ],
    };
    expect(actions.actions!.items.properties.action).toMatchObject(marked);
    expect(actions.touch!.items.properties.action).toMatchObject(marked);
    expect(json).toContain('"x-ui":true');
    const plain = docKindJsonSchema(inputMapKind as DocKindDef, { registry: game, project: null });
    expect(JSON.stringify(plain)).not.toContain("x-ui");
    const doc = {
      kind: "input-map",
      v: 1,
      actions: [{ action: "confirm", bindings: [{ device: "key", code: "Enter" }] }],
    };
    expect(parseAssetDoc(inputMapKind, doc, { registry: ui, project: null }).issues).toEqual([]);
  });

  it("refuses a hold, press or set naming one as binding-unknown, with the hint", () => {
    const cases: [unknown, string][] = [
      [{ hold: ["right", "confirm"], for: 2 }, "/steps/0/hold/1"],
      [{ press: "confirm" }, "/steps/0/press"],
      [{ press: ["push", "confirm"] }, "/steps/0/press"],
      [{ set: { cursor: [1, 0] }, for: 2 }, "/steps/0/set/cursor"],
      [{ set: { confirm: 1 }, for: 2 }, "/steps/0/set/confirm"],
    ];
    for (const [step, path] of cases) {
      const compiled = compileInputScript({ v: 2, steps: [step] }, ui);
      expect(compiled.ok, JSON.stringify(step)).toBe(false);
      if (compiled.ok) continue;
      expect(compiled.issues, JSON.stringify(step)).toEqual([
        expect.objectContaining({
          path: path.startsWith("/steps/0/press")
            ? expect.stringMatching(/^\/steps\/0\/press/)
            : path,
          message: expect.stringContaining("(binding-unknown)"),
          hint: HINT,
        }),
      ]);
    }
    const parsed = parseInputScript({ v: 2, steps: [{ hold: ["confirm"], for: 1 }] }, ui);
    expect(parsed).toEqual({
      ok: false,
      issues: [
        {
          path: "/steps/0/hold/0",
          message: '"confirm" is a UI-only action, which a script can\'t drive (binding-unknown)',
          hint: HINT,
        },
      ],
    });
  });

  it("still plays the simulation's actions", () => {
    const compiled = compileInputScript(
      { v: 2, steps: [{ hold: ["right"], set: { steer: 0.5 }, for: 2 }, { press: "push" }] },
      ui,
    );
    expect(compiled.ok).toBe(true);
  });
});

describe("input-script v1 → v2", () => {
  /** A v1 script as 0.10.0 wrote it, in px; never edited. */
  const FROZEN_V1 = {
    v: 1,
    scene: "yard",
    at: [320, 912],
    timeOffsetMs: 50,
    game: { push: false },
    maxTicks: 600,
    steps: [
      { hold: ["right"], for: 30 },
      { hold: [], until: { past: 400, tick: 90 }, max: 120 },
      { command: "nudge", args: { dx: 200 } },
      { press: "push" },
      { wait: 10 },
    ],
  };

  it("sets v 2 and divides at, the predicates and command args by px per metre", () => {
    const at100 = parseInputScript(FROZEN_V1, pads(100));
    expect(at100).toEqual({
      ok: true,
      migratedFrom: 1,
      script: {
        ...FROZEN_V1,
        v: 2,
        at: [3.2, 9.12],
        steps: [
          { hold: ["right"], for: 30 },
          { hold: [], until: { past: 4, tick: 90 }, max: 120 },
          { command: "nudge", args: { dx: 2 } },
          { press: "push" },
          { wait: 10 },
        ],
      },
    });
    const at32 = migrateInputScript(FROZEN_V1, pads(32));
    expect(at32.ok && at32.script).toMatchObject({
      v: 2,
      at: [10, 28.5],
      steps: [{}, { until: { past: 12.5, tick: 90 } }, { args: { dx: 6.25 } }, {}, {}],
    });
  });

  it("goes through the kind's migrations, which refuse without a registry", () => {
    expect(INPUT_SCRIPT_MIGRATIONS[1]).toBeTypeOf("function");
    const out = INPUT_SCRIPT_MIGRATIONS[1]!(FROZEN_V1, {}) as { refused?: { code: string } };
    expect(out.refused?.code).toBe("migration-unresolved");
  });

  it("leaves a current script, or one without a usable v, for the schema to judge", () => {
    const current = { v: 2, steps: [{ wait: 1 }] };
    expect(migrateInputScript(current, game)).toEqual({ ok: true, script: current, from: 2 });
    expect(migrateInputScript({ steps: [] }, game)).toMatchObject({ ok: true, from: 2 });
    expect(parseInputScript({ v: 3, steps: [{ wait: 1 }] }, game)).toMatchObject({ ok: false });
  });

  it("reports issues with JSON Pointers and, from text, lines", () => {
    const text = '{\n  "v": 2,\n  "steps": [\n    { "wait": 1, "hold": [] }\n  ]\n}\n';
    const parsed = parseInputScript(text, game);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.issues[0]).toMatchObject({ path: "/steps/0", line: 4 });
    expect(parseInputScript("{ nope", game)).toMatchObject({ ok: false, issues: [{ path: "" }] });
  });
});

describe("INPUT_SCRIPT_LAYOUT", () => {
  const base = {
    v: 2 as const,
    players: 2,
    tracks: [
      { player: 0, steps: [{ wait: 1 }] },
      { player: 1, steps: [{ wait: 2 }] },
    ],
  };

  /** Two clients each insert a step into `tracks[a]` and `tracks[b]` at once, then sync. */
  function concurrent(a: number, b: number) {
    const one = layoutToDoc(new Y.Doc(), INPUT_SCRIPT_LAYOUT, base, "seed", {
      key: sequentialKeys(),
    });
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one));
    const edit = (track: number, wait: number) => {
      const next = structuredClone(base);
      next.tracks[track]!.steps.push({ wait });
      return next;
    };
    layoutPatch(one, INPUT_SCRIPT_LAYOUT, edit(a, 10), "a");
    layoutPatch(other, INPUT_SCRIPT_LAYOUT, edit(b, 20), "b");
    Y.applyUpdate(one, Y.encodeStateAsUpdate(other));
    Y.applyUpdate(other, Y.encodeStateAsUpdate(one));
    const merged = layoutFromDoc(one, INPUT_SCRIPT_LAYOUT);
    expect(layoutFromDoc(other, INPUT_SCRIPT_LAYOUT)).toEqual(merged);
    return merged as typeof base;
  }

  it("merges concurrent inserts into two tracks", () => {
    expect(concurrent(0, 1).tracks).toEqual([
      { player: 0, steps: [{ wait: 1 }, { wait: 10 }] },
      { player: 1, steps: [{ wait: 2 }, { wait: 20 }] },
    ]);
  });

  it("merges concurrent inserts into one track, keeping one track per seat", () => {
    const merged = concurrent(0, 0);
    expect(merged.tracks).toHaveLength(2);
    expect(merged.tracks[0]!.steps).toHaveLength(3);
    expect(merged.tracks[0]!.steps.slice(1)).toEqual(
      expect.arrayContaining([{ wait: 10 }, { wait: 20 }]),
    );
    expect(parseInputScript(merged, pads()).ok).toBe(true);
  });

  it("formats tracks one step per line, header first, and round-trips", () => {
    const text = formatInputScript({ ...base, seed: 7, scene: "arena" });
    expect(text).toBe(
      [
        "{",
        '  "v": 2,',
        '  "scene": "arena",',
        '  "seed": 7,',
        '  "players": 2,',
        '  "tracks": [',
        '    { "player": 0, "steps": [',
        '      { "wait": 1 }',
        "    ] },",
        '    { "player": 1, "steps": [',
        '      { "wait": 2 }',
        "    ] }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
    expect(JSON.parse(text)).toEqual({ ...base, seed: 7, scene: "arena" });
    expect(formatInputScript({ v: 2, steps: [{ wait: 1 }] })).toBe(
      '{\n  "v": 2,\n  "steps": [\n    { "wait": 1 }\n  ]\n}\n',
    );
  });
});
