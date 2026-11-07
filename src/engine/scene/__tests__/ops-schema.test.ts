import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import { applyOps } from "../ops";
import { opBatchSchemaFor, opsJsonSchema, opsSchemaId, usesBulkRefs } from "../ops-schema";
import type { OpBatch, SceneDefinition } from "../types";

const committed = new URL("../ops.schema.json", import.meta.url);

const engine = createRegistry();
const game = createRegistry(
  defineGame({
    id: "pegs",
    types: [
      defineEntityType({
        type: "peg",
        description: "A point to hang from.",
        base: "marker",
        fields: { at: pointField("Peg position.") },
        bulk: { form: "point", description: "Pegs." },
      }),
    ],
    materials: { ice: { friction: 0.05, restitution: 0, description: "Slippery." } },
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

/** Fails to compile if a typed batch stops fitting the schema's input type. */
const asSchemaInput = (b: OpBatch): z.input<ReturnType<typeof opBatchSchemaFor>> => b;

const tiny: SceneDefinition = { v: 1, name: "tiny", bounds: [0, 0, 100, 100] };

describe("ops JSON Schema", () => {
  it("matches the committed ops.schema.json for the engine-only registry (UPDATE_SCHEMAS=1 regenerates)", () => {
    const fresh = opsJsonSchema(engine);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(committed, `${JSON.stringify(fresh, null, 2)}\n`);
    expect(JSON.parse(readFileSync(committed, "utf8"))).toEqual(fresh);
  });

  it("carries a URN id beside the registry's scene schema and draft 2020-12", () => {
    expect(opsJsonSchema(engine).$id).toBe("urn:jams-engine:ops:v2");
    expect(opsSchemaId(game)).toBe("urn:jams-engine:ops:pegs:v2");
    expect(opsJsonSchema(engine).$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("lists the registry's types, bulk keys and settings", () => {
    const text = JSON.stringify(opsJsonSchema(game));
    for (const word of ['"peg"', '"solid:ice"', "`gravity`"]) expect(text).toContain(word);
    expect(JSON.stringify(opsJsonSchema(engine))).not.toContain('"peg"');
  });

  it("describes every op for agents", () => {
    const text = JSON.stringify(opsJsonSchema(engine));
    for (const phrase of ["y is down", "half-extents", "integer degrees", "must carry `base`"]) {
      expect(text).toContain(phrase);
    }
  });

  it("builds a registry's schemas once", () => {
    expect(opBatchSchemaFor(game)).toBe(opBatchSchemaFor(game));
  });
});

describe("opBatchSchemaFor", () => {
  it("accepts every op form", () => {
    const batch: OpBatch = {
      label: "all",
      base: "0123456789abcdef",
      actor: "agent",
      ops: [
        { op: "add", entity: { type: "peg", at: [1, 2] }, index: 0 },
        {
          op: "addBulk",
          key: "solid:ice",
          shapes: [["box", 0, 0, 4, 4], { type: "rect", left: 0, top: 0, right: 8, bottom: 8 }],
        },
        { op: "addBulk", key: "peg", points: [[3, 4]] },
        { op: "update", ref: "lift", set: { "path.speed": 140 }, unset: ["path.pauseMs"] },
        { op: "move", refs: ["~solid:0", "lift"], by: [16, 0] },
        { op: "place", ref: "~solid:1", at: [500, 900], anchor: "top" },
        { op: "remove", refs: ["lift"] },
        { op: "rename", from: "a", to: "b" },
        { op: "promote", ref: "~solid:2", id: "ledge" },
        { op: "demote", id: "ledge" },
        { op: "setScene", set: { name: "x", bounds: [0, 0, 10, 10] } },
        { op: "setSettings", set: { gravity: [0, 900] }, unset: ["wind"] },
      ],
    };
    expect(opBatchSchemaFor(game).safeParse(asSchemaInput(batch)).success).toBe(true);
  });

  it("names an unknown op and suggests the nearest one", () => {
    const result = opBatchSchemaFor(engine).safeParse({
      ops: [{ op: "ad", entity: { type: "solid" } }],
    });
    expect(result.success).toBe(false);
    const message = result.error!.issues[0]!.message;
    expect(message).toContain('Unknown op "ad"');
    expect(message).toContain('did you mean "add"?');
    expect(message).toContain("Expected one of: add, addBulk");
  });

  it("names a bad addBulk key, and points use only point keys", () => {
    const icy = opBatchSchemaFor(game).safeParse({
      ops: [{ op: "addBulk", key: "solid:icee", shapes: [] }],
    });
    expect(icy.error!.issues[0]!.message).toContain('did you mean "solid:ice"?');
    expect(
      opBatchSchemaFor(game).safeParse({ ops: [{ op: "addBulk", key: "solid", points: [[1, 1]] }] })
        .success,
    ).toBe(false);
  });

  it("names an unknown entity type with the nearest registered one", () => {
    const result = opBatchSchemaFor(game).safeParse({
      ops: [{ op: "add", entity: { type: "pag", at: [0, 0] } }],
    });
    expect(result.error!.issues[0]!.message).toContain('did you mean "peg"?');
  });

  it("rejects unknown fields, fractional coordinates and a malformed base", () => {
    const schema = opBatchSchemaFor(engine);
    expect(
      schema.safeParse({ ops: [{ op: "move", refs: ["a"], by: [1, 2], extra: 1 }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ ops: [{ op: "move", refs: ["a"], by: [1.5, 2] }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ base: "nope", ops: [] }).success).toBe(false);
  });

  it("turns schema failures into op-invalid at the failing op", () => {
    const result = applyOps(
      tiny,
      { ops: [{ op: "setScene", set: { name: "x" } }, { op: "bogus" }] } as unknown as OpBatch,
      engine,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedAt).toBe(1);
    expect(result.issue.code).toBe("op-invalid");
    expect(result.issue.message).toMatch(/^\/ops\/1\/op: Unknown op "bogus"/);
  });

  it("knows which batches need a base", () => {
    expect(usesBulkRefs({ ops: [{ op: "move", refs: ["lift"], by: [1, 0] }] })).toBe(false);
    expect(usesBulkRefs({ ops: [{ op: "remove", refs: ["lift", "~solid:0"] }] })).toBe(true);
    expect(usesBulkRefs({ ops: [{ op: "promote", ref: "~peg:0", id: "c" }] })).toBe(true);
  });
});
