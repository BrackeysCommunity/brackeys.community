import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import { sha256 } from "../hash";
import {
  formatProjectSnapshot,
  PROJECT_SNAPSHOT_SCHEMA_ID,
  projectSnapshotJsonSchema,
  projectSnapshotSchema,
  snapshotProject,
} from "../snapshot";
import { projectView } from "../view";

const FILE = new URL("../project-snapshot.schema.json", import.meta.url);

describe("urn:jams-engine:project-snapshot:v1", () => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = projectSnapshotJsonSchema();
    if (process.env.UPDATE_SCHEMAS) writeFileSync(FILE, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(schema);
  });

  it("has its URN, draft 2020-12, the agent surface and no domain", () => {
    const schema = projectSnapshotJsonSchema();
    expect(PROJECT_SNAPSHOT_SCHEMA_ID).toBe("urn:jams-engine:project-snapshot:v1");
    expect(schema.$id).toBe(PROJECT_SNAPSHOT_SCHEMA_ID);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
  });

  it("describes every property", () => {
    expect(undescribedProperties(projectSnapshotJsonSchema())).toEqual([]);
  });

  it("accepts a snapshot snapshotProject writes, as a value and as its file text", async () => {
    const view = projectView({
      meta: { projectId: "demo", layout: 1, name: "Demo" },
      assets: {
        k1: { key: "k1", id: "yard", kind: "scene", path: "yard.json", created: { at: 0, by: "" } },
        k2: {
          key: "k2",
          id: "hero",
          kind: "texture",
          path: "art/hero.png",
          sha256: await sha256("pixels"),
          created: { at: 0, by: "" },
        },
      },
      history: {},
      code: {},
      build: {},
    });
    const snap = await snapshotProject(view, new Map([["yard", "{}\n"]]), {});
    expect(projectSnapshotSchema.safeParse(snap).success).toBe(true);
    const text = formatProjectSnapshot({ ...snap, $schema: "./project-snapshot.schema.json" });
    expect(projectSnapshotSchema.safeParse(JSON.parse(text)).success).toBe(true);
    expect(text.split("\n").slice(1, 4)).toEqual([
      '  "$schema": "./project-snapshot.schema.json",',
      '  "kind": "project-snapshot",',
      '  "v": 1,',
    ]);
  });
});
