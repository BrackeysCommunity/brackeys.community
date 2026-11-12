import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { undescribedProperties } from "../../scene/json-schema";
import {
  PROJECT_OP_NAMES,
  PROJECT_OPS_SCHEMA_ID,
  projectOpBatchSchema,
  projectOpsJsonSchema,
  type ProjectOpBatch,
} from "../ops";

const committed = new URL("../project-ops.schema.json", import.meta.url);

/** Fails to compile if a typed batch stops fitting the schema's input type. */
const asSchemaInput = (b: ProjectOpBatch): z.input<typeof projectOpBatchSchema> => b;

const H = "0".repeat(64);

describe("project-ops.schema.json", () => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = projectOpsJsonSchema();
    if (process.env.UPDATE_SCHEMAS) writeFileSync(committed, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(committed, "utf8"))).toEqual(fresh);
  });

  it("has its URN, draft 2020-12, the agent surface and no domain", () => {
    const schema = projectOpsJsonSchema();
    expect(PROJECT_OPS_SCHEMA_ID).toBe("urn:jams-engine:project-ops:v1");
    expect(schema.$id).toBe(PROJECT_OPS_SCHEMA_ID);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
  });

  it("describes every property", () => {
    expect(undescribedProperties(projectOpsJsonSchema())).toEqual([]);
  });

  it("lists exactly PROJECT_OP_NAMES", () => {
    const ops = (
      projectOpsJsonSchema() as {
        properties: { ops: { items: { oneOf: { properties: { op: { const: string } } }[] } } };
      }
    ).properties.ops.items.oneOf.map((o) => o.properties.op.const);
    expect(ops).toEqual([...PROJECT_OP_NAMES]);
  });
});

describe("projectOpBatchSchema", () => {
  it("accepts every op form", () => {
    const batch: ProjectOpBatch = {
      v: 1,
      label: "all",
      base: H,
      ops: [
        {
          op: "createAsset",
          kind: "material",
          path: "materials/",
          id: "rubber",
          content: { kind: "material", v: 1, description: "Bouncy." },
          licence: { spdx: "CC0-1.0" },
        },
        {
          op: "importAsset",
          path: "art/crate.png",
          sha256: H,
          bytes: 10,
          kind: "texture",
          id: "crate",
          settings: { filter: "nearest" },
          licence: { author: "Ana", attribution: "Crate by Ana" },
        },
        { op: "renameAsset", id: "crate", name: null, file: "box.png" },
        { op: "moveAsset", ids: ["crate"], to: "" },
        { op: "deleteAsset", id: "crate", force: true },
        { op: "restoreAsset", id: "crate" },
        { op: "changeAssetId", id: "crate", to: "box" },
        { op: "setImport", id: "box", set: { filter: null } },
        { op: "replaceContent", id: "box", sha256: H, bytes: 11 },
        { op: "setLicence", id: "box", licence: null },
        {
          op: "editAsset",
          id: "rubber",
          edits: [
            { set: "/physics/friction", value: 0.4 },
            { unset: "/render" },
            { insert: "/rows", value: { id: "a" }, before: "b" },
            { remove: "/rows/@a" },
          ],
        },
        { op: "editScene", id: "yard", ops: [{ op: "move", refs: ["lift"], by: [1, 0] }] },
      ],
    };
    expect(projectOpBatchSchema.safeParse(asSchemaInput(batch)).success).toBe(true);
  });

  it("refuses unknown ops and keys, bad ids and a bad hash", () => {
    const parse = (ops: unknown[]) => projectOpBatchSchema.safeParse({ v: 1, ops });
    const unknown = parse([{ op: "dleteAsset", id: "a" }]);
    expect(unknown.error!.issues[0]!.message).toContain('did you mean "deleteAsset"?');
    expect(parse([{ op: "deleteAsset", id: "a", extra: 1 }]).success).toBe(false);
    expect(parse([{ op: "deleteAsset", id: "Not An Id" }]).success).toBe(false);
    expect(parse([{ op: "replaceContent", id: "a", sha256: "ABC", bytes: 1 }]).success).toBe(false);
    expect(projectOpBatchSchema.safeParse({ ops: [] }).success).toBe(false);
  });
});
