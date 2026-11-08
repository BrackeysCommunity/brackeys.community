import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { docKindJsonSchema, validateAssetDoc, type KindEnv } from "../kinds";
import { MATERIAL_SCHEMA_ID, materialKind } from "../kinds/material";

const env: KindEnv = { registry: createRegistry(), project: null };
const file = new URL("../material.schema.json", import.meta.url);
const fresh = () => docKindJsonSchema(materialKind, env);

describe("material.schema.json", () => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = fresh();
    if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
  });

  it("has its URN, draft 2020-12, the agent surface and no domain", () => {
    const schema = fresh();
    expect(MATERIAL_SCHEMA_ID).toBe("urn:jams-engine:material:v1");
    expect(schema.$id).toBe(MATERIAL_SCHEMA_ID);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
  });

  it("describes every property", () => {
    expect(undescribedProperties(fresh())).toEqual([]);
  });

  it("reads the engine's material file shape", () => {
    expect(
      validateAssetDoc(materialKind, { kind: "material", v: 1, description: "Ink." }, env),
    ).toEqual([]);
  });
});
