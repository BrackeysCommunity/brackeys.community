import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { docKindJsonSchema, validateAssetDoc, type KindEnv } from "../kinds";
import { GAME_SETTINGS_SCHEMA_ID, gameSettingsKind } from "../kinds/game-settings";

const env: KindEnv = { registry: createRegistry(), project: null };
const file = new URL("../game-settings.schema.json", import.meta.url);
const fresh = () => docKindJsonSchema(gameSettingsKind, env);

describe("game-settings.schema.json", () => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = fresh();
    if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
  });

  it("has its URN, draft 2020-12, the agent surface and no domain", () => {
    const schema = fresh();
    expect(GAME_SETTINGS_SCHEMA_ID).toBe("urn:jams-engine:game-settings:v1");
    expect(schema.$id).toBe(GAME_SETTINGS_SCHEMA_ID);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
  });

  it("describes every property", () => {
    expect(undescribedProperties(fresh())).toEqual([]);
  });

  it("has an empty `game` block without a game", () => {
    const props = (fresh() as { properties: Record<string, { additionalProperties?: unknown }> })
      .properties;
    expect(props.game?.additionalProperties).toBe(false);
    expect(validateAssetDoc(gameSettingsKind, gameSettingsKind.empty(), env)).toEqual([]);
  });
});
