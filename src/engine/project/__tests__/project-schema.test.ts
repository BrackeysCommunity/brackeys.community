import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { sceneNameOf } from "../../vite/scene-paths";
import {
  formatProjectFile,
  parseProjectFile,
  PROJECT_SCHEMA_ID,
  projectJsonSchema,
} from "../project-file";
import { SIDECAR_SCHEMA_ID, sidecarJsonSchema } from "../sidecar";
import { PROJECT_FILE } from "../types";

const SCHEMAS = [
  {
    file: new URL("../project.schema.json", import.meta.url),
    fresh: projectJsonSchema,
    id: PROJECT_SCHEMA_ID,
    urn: "urn:jams-engine:project:v1",
  },
  {
    file: new URL("../asset-sidecar.schema.json", import.meta.url),
    fresh: sidecarJsonSchema,
    id: SIDECAR_SCHEMA_ID,
    urn: "urn:jams-engine:asset-sidecar:v1",
  },
];

describe.each(SCHEMAS)("$urn", ({ file, fresh, id, urn }) => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = fresh();
    if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
  });

  it("has its URN, draft 2020-12, the agent surface and no domain", () => {
    const schema = fresh();
    expect(id).toBe(urn);
    expect(schema.$id).toBe(urn);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
  });

  it("describes every property", () => {
    expect(undescribedProperties(fresh())).toEqual([]);
  });
});

describe("project.schema.json", () => {
  it("documents the default globs", () => {
    const props = (projectJsonSchema() as { properties: Record<string, { default?: unknown }> })
      .properties;
    expect(props.assets?.default).toEqual(["**"]);
    expect(props.code?.default).toEqual(["**/*.ts", "**/*.tsx"]);
  });
});

const HOMES = [
  { path: "../../scenes/jams.project.json", id: "engine", game: null },
  {
    path: "../../../games/platformer/jams.project.json",
    id: "platformer",
    game: { module: "./index.ts", export: "platformerGame" },
  },
];

describe.each(HOMES)("$path", ({ path, id, game }) => {
  const url = new URL(path, import.meta.url);
  const text = readFileSync(url, "utf8");

  it("parses, is canonical, and points at the committed schema", () => {
    const parsed = parseProjectFile(text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.file.id).toBe(id);
    expect(parsed.file.game).toEqual(game);
    expect(formatProjectFile(parsed.file)).toBe(text);
    const schemaFile = fileURLToPath(new URL("../project.schema.json", import.meta.url));
    expect(resolve(dirname(fileURLToPath(url)), parsed.file.$schema!)).toBe(schemaFile);
  });

  it("is never listed as a scene", () => {
    expect(sceneNameOf(PROJECT_FILE)).toBeNull();
  });
});
