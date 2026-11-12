// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import {
  AGENT_SURFACE_VERSION,
  createRegistry,
  inputScriptJsonSchema,
  sceneJsonSchema,
  undescribedProperties,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { ownSavesGame } from "../fixtures/own-saves";

const registry = createRegistry(ownSavesGame);
const fixture = (file: string) => new URL(`../fixtures/own-saves/${file}`, import.meta.url);
const SCHEMA = fixture("scene.schema.json");
const SCRIPT_SCHEMA = fixture("input-script.schema.json");

describe("the own-saves fixture's committed schemas", () => {
  it("scene.schema.json matches sceneJsonSchema (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = sceneJsonSchema(registry);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(SCHEMA, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCHEMA, "utf8"))).toEqual(fresh);
    expect(fresh.$id).toBe("urn:jams-engine:scene:own-saves:v4");
    expect(fresh["x-agent-surface"]).toBe(AGENT_SURFACE_VERSION);
  });

  it("input-script.schema.json matches inputScriptJsonSchema (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = inputScriptJsonSchema(registry);
    if (process.env.UPDATE_SCHEMAS)
      writeFileSync(SCRIPT_SCHEMA, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCRIPT_SCHEMA, "utf8"))).toEqual(fresh);
    expect(fresh.$id).toBe("urn:jams-engine:input-script:own-saves:v2");
    expect(fresh["x-agent-surface"]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(fresh)).toEqual([]);
  });
});
