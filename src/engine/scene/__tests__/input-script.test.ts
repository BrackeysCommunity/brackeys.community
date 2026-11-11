import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { compileInputScript } from "../../headless/compile-input-script";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../agent-surface";
import { inputScriptJsonSchema, inputScriptSchemaFor, inputScriptSchemaId } from "../input-script";
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
    expect(schema.$id).toBe(`${SCHEMA_ID_BASE}input-script:v1`);
    expect(inputScriptSchemaId(game)).toBe(`${SCHEMA_ID_BASE}input-script:test-game:v1`);
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
    const script = (step: unknown) => zod.safeParse({ v: 1, steps: [step] }).success;
    expect(script({ command: "nudge", args: { dx: 3 } })).toBe(true);
    expect(script({ command: "nudge", args: { dx: "3" } })).toBe(false);
    expect(script({ command: "nudge" })).toBe(false);
    expect(script({ command: "@elapsed", args: { ms: 3 } })).toBe(false);
    expect(script({ elapse: 100 })).toBe(false);
    const away = createRegistry({ ...testGame, time: { kind: "fixed", catchUp: { maxMs: 10 } } });
    expect(inputScriptSchemaFor(away).safeParse({ v: 1, steps: [{ elapse: 100 }] }).success).toBe(
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
    const until = (u: unknown) => zod.safeParse({ v: 1, steps: [{ hold: [], until: u }] }).success;
    expect(until({ exists: "boss#1" })).toBe(true);
    expect(until({ exists: { id: "boss#1", enabled: false } })).toBe(true);
    expect(until({ exists: { id: "boss#1", enabled: true } })).toBe(false);
    expect(until({ count: { type: "lamp", max: 0 } })).toBe(true);
    expect(until({ count: { tag: "coin", min: 3, enabled: true } })).toBe(true);
    expect(until({ count: { type: "lamp" } })).toBe(false);
    expect(until({ count: { type: "ghost", min: 1 } })).toBe(false);
  });

  it("describes every property", () => {
    expect(undescribedProperties(inputScriptJsonSchema(engine))).toEqual([]);
  });

  it("parses a script with the zod schema it is generated from", () => {
    const schema = inputScriptSchemaFor(game);
    expect(schema).toBe(inputScriptSchemaFor(game));
    const ok = schema.safeParse({
      v: 1,
      steps: [
        { hold: ["right"], until: { event: { type: "goal" }, past: 3 } },
        { press: ["left", "push"] },
        { wait: 2 },
      ],
    });
    expect(ok.success).toBe(true);
    expect(schema.safeParse({ v: 1, steps: [{ hold: ["jump"], for: 1 }] }).success).toBe(false);
    expect(schema.safeParse({ v: 1, steps: [{ hold: [], for: 1, forMs: 3 }] }).success).toBe(false);
  });

  it("takes a seed, a number or a string, in its header and passes it to the run", () => {
    const schema = inputScriptSchemaFor(game);
    const steps = [{ wait: 1 }];
    for (const seed of [7, "seven"]) {
      expect(schema.safeParse({ v: 1, seed, steps }).success).toBe(true);
      const compiled = compileInputScript({ v: 1, seed, steps }, game);
      expect(compiled.ok && compiled.script.play).toEqual({ seed });
    }
    for (const seed of [true, null, { n: 1 }, Number.NaN])
      expect(schema.safeParse({ v: 1, seed, steps }).success).toBe(false);
    const unseeded = compileInputScript({ v: 1, steps }, game);
    expect(unseeded.ok && unseeded.script.play).toEqual({});
    const props = (inputScriptJsonSchema(engine) as { properties: Record<string, unknown> })
      .properties;
    expect(props.seed).toMatchObject({ anyOf: [{ type: "number" }, { type: "string" }] });
  });
});
