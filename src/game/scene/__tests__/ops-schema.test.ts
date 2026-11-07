import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import { applyOps } from "../ops";
import { OPS_SCHEMA_ID, OpBatchSchema, opsJsonSchema, usesBulkRefs } from "../ops-schema";
import type { OpBatch, SceneDefinition } from "../types";

const committed = new URL("../ops.schema.json", import.meta.url);

/** Fails to compile if a typed batch stops fitting the schema's input type. */
const asSchemaInput = (b: OpBatch): z.input<typeof OpBatchSchema> => b;

const tiny: SceneDefinition = { v: 1, name: "tiny", bounds: [0, 0, 100, 100], spawn: [[10, 90]] };

describe("ops JSON Schema", () => {
  it("matches the committed ops.schema.json", () => {
    expect(JSON.parse(readFileSync(committed, "utf8"))).toEqual(opsJsonSchema());
  });

  it("carries a stable URN id and draft 2020-12", () => {
    const schema = opsJsonSchema();
    expect(schema.$id).toBe(OPS_SCHEMA_ID);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("describes every op for agents", () => {
    const text = JSON.stringify(opsJsonSchema());
    for (const phrase of ["y is down", "half-extents", "integer degrees", "must carry `base`"]) {
      expect(text).toContain(phrase);
    }
  });
});

describe("OpBatchSchema", () => {
  it("accepts every op form", () => {
    const batch: OpBatch = {
      label: "all",
      base: "0123456789abcdef",
      actor: "agent",
      ops: [
        { op: "add", entity: { b: "anchor", at: [1, 2] }, index: 0 },
        {
          op: "addBulk",
          key: "solid:ice",
          shapes: [["box", 0, 0, 4, 4], { type: "rect", left: 0, top: 0, right: 8, bottom: 8 }],
        },
        { op: "addBulk", key: "anchor", points: [[3, 4]] },
        { op: "update", ref: "lift", set: { "path.speed": 140 }, unset: ["path.pauseMs"] },
        { op: "move", refs: ["~solid:0", "lift"], by: [16, 0] },
        { op: "place", ref: "~cloud:1", at: [500, 900], anchor: "top" },
        { op: "remove", refs: ["lift"] },
        { op: "rename", from: "a", to: "b" },
        { op: "promote", ref: "~solid:2", id: "ledge" },
        { op: "demote", id: "ledge" },
        { op: "setSpawn", at: [1, 1] },
        { op: "removeSpawn", index: 0 },
        { op: "setScene", set: { name: "x", bounds: [0, 0, 10, 10] } },
      ],
    };
    expect(OpBatchSchema.safeParse(asSchemaInput(batch)).success).toBe(true);
  });

  it("names an unknown op and suggests the nearest one", () => {
    const result = OpBatchSchema.safeParse({ ops: [{ op: "ad", entity: { b: "solid" } }] });
    expect(result.success).toBe(false);
    const message = result.error!.issues[0]!.message;
    expect(message).toContain('Unknown op "ad"');
    expect(message).toContain('did you mean "add"?');
    expect(message).toContain("Expected one of: add, addBulk");
  });

  it("names a bad addBulk key", () => {
    const result = OpBatchSchema.safeParse({
      ops: [{ op: "addBulk", key: "solid:icee", shapes: [] }],
    });
    expect(result.error!.issues[0]!.message).toContain('did you mean "solid:ice"?');
  });

  it("rejects unknown fields, fractional coordinates and a malformed base", () => {
    expect(
      OpBatchSchema.safeParse({ ops: [{ op: "move", refs: ["a"], by: [1, 2], extra: 1 }] }).success,
    ).toBe(false);
    expect(
      OpBatchSchema.safeParse({ ops: [{ op: "move", refs: ["a"], by: [1.5, 2] }] }).success,
    ).toBe(false);
    expect(OpBatchSchema.safeParse({ base: "nope", ops: [] }).success).toBe(false);
  });

  it("turns schema failures into op-invalid at the failing op", () => {
    const result = applyOps(tiny, {
      ops: [{ op: "setSpawn", at: [1, 1] }, { op: "bogus" }],
    } as unknown as OpBatch);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedAt).toBe(1);
    expect(result.issue.code).toBe("op-invalid");
    expect(result.issue.message).toMatch(/^\/ops\/1\/op: Unknown op "bogus"/);
  });

  it("knows which batches need a base", () => {
    expect(usesBulkRefs({ ops: [{ op: "move", refs: ["lift"], by: [1, 0] }] })).toBe(false);
    expect(usesBulkRefs({ ops: [{ op: "remove", refs: ["lift", "~solid:0"] }] })).toBe(true);
    expect(usesBulkRefs({ ops: [{ op: "promote", ref: "~cloud:0", id: "c" }] })).toBe(true);
  });
});
