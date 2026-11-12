import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { docKindJsonSchema, validateAssetDoc, type KindEnv } from "../kinds";
import { DATA_TABLE_SCHEMA_ID, dataTableKind } from "../kinds/data-table";

const env: KindEnv = { registry: createRegistry(), project: null };
const file = new URL("../data-table.schema.json", import.meta.url);
const fresh = () => docKindJsonSchema(dataTableKind, env);

describe("data-table.schema.json", () => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = fresh();
    if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
  });

  it("has its URN, draft 2020-12, the agent surface and no domain", () => {
    const schema = fresh();
    expect(DATA_TABLE_SCHEMA_ID).toBe("urn:jams-engine:data-table:v2");
    expect(schema.$id).toBe(DATA_TABLE_SCHEMA_ID);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
  });

  it("describes every property", () => {
    expect(undescribedProperties(fresh())).toEqual([]);
  });

  it("describes rows by id without a game, and takes any table name", () => {
    const issues = validateAssetDoc(
      dataTableKind,
      { kind: "data-table", v: 2, table: "card", rows: [{ id: "a", anything: 1 }] },
      env,
    );
    expect(issues).toEqual([]);
  });
});
