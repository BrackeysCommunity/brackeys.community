import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
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
    expect(Object.keys(schema.$defs.Until!.properties!)).toEqual(["event", "tick", "past"]);
    expect(schema.properties).toHaveProperty("game");
    const bare = inputScriptJsonSchema(engine) as Defs & { properties: Record<string, unknown> };
    expect(bare.properties).not.toHaveProperty("game");
    expect(Object.keys(bare.$defs.Until!.properties!)).toEqual(["event", "tick"]);
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
});
