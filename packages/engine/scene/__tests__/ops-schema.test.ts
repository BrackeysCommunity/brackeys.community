import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import { applyOps } from "../ops";
import { opBatchSchemaFor, opsJsonSchema, opsSchemaId, usesBulkRefs } from "../ops-schema";
import { OVERRIDE_PATH } from "../schema";
import type { OpBatch, Prefab, SceneDefinition } from "../types";

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
    expect(opsJsonSchema(engine).$id).toBe("urn:jams-engine:ops:v5");
    expect(opsSchemaId(game)).toBe("urn:jams-engine:ops:pegs:v5");
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

  it("describes the v3 prefab ops and addressing", () => {
    const text = JSON.stringify(opsJsonSchema(engine));
    for (const phrase of [
      "instances become nested instances",
      "its nested instances become instances",
      "behaviors.tactics/selectable.team",
      "`params.<name>` (null clears a param)",
      "paint its cells with paintCells",
      "door-1/panel.path.speed",
    ])
      expect(text).toContain(phrase);
    expect(text).not.toContain("not instances");
    expect(text).not.toContain("children as plain entities");
    for (const key of ["door-1/panel.path.speed", "door-1.rot", "door-1.params.speed"])
      expect(key).toMatch(OVERRIDE_PATH);
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
        { op: "reorder", refs: ["lift"], index: 0 },
        {
          op: "instantiate",
          instance: { prefab: "gate", at: [8, 8], rot: 90, flip: true, z: 2, params: { speed: 3 } },
        },
        { op: "reparent", refs: ["lift"], parent: "wing" },
        { op: "override", ref: "gate-1", set: { "door.path.speed": 60 } },
        { op: "revertOverride", ref: "gate-1", paths: ["door.path.speed"] },
        { op: "applyToPrefab", ref: "gate-1", to: "gate" },
        { op: "unpack", ref: "gate-1" },
        { op: "createPrefab", refs: ["lift"], id: "lifty", at: [0, 0] },
        {
          op: "definePrefab",
          id: "gate",
          prefab: { entities: [], base: "door", assets: ["boom"] },
        },
        { op: "transform", refs: ["gate-1", "wing"], turn: -1, flip: "x", about: [0, 0] },
        { op: "setZ", refs: ["lift", "gate-1"], z: 5 },
        { op: "setZ", refs: ["lift"], by: -1 },
        { op: "useAssets", add: ["boom"], remove: ["hud-font"] },
        {
          op: "paintCells",
          ref: "floor",
          field: "cells",
          cells: [[0, 0, 1]],
          rects: [[0, 0, 31, 3, 2]],
        },
        { op: "setPrefabBase", base: "door" },
        { op: "setPrefabBase", base: null },
        {
          op: "exposeParam",
          name: "speed",
          param: { description: "How fast.", targets: ["door.path.speed"], default: 100 },
        },
        { op: "exposeParam", name: "speed", param: null },
        { op: "setParam", ref: "gate-1", name: "speed", value: 120 },
        { op: "setParam", ref: "gate-1", name: "speed", value: null },
      ],
    };
    expect(opBatchSchemaFor(game).safeParse(asSchemaInput(batch)).success).toBe(true);
  });

  it("bounds the new ops' values", () => {
    const schema = opBatchSchemaFor(engine);
    const parses = (op: unknown) => schema.safeParse({ ops: [op] }).success;
    expect(parses({ op: "transform", refs: ["a"], turn: 4 })).toBe(false);
    expect(parses({ op: "transform", refs: ["a"], flip: "z" })).toBe(false);
    expect(parses({ op: "transform", turn: 1 })).toBe(false);
    expect(parses({ op: "setZ", refs: ["a"], z: 10001 })).toBe(false);
    expect(parses({ op: "setZ", refs: ["a"], z: 1.5 })).toBe(false);
    expect(parses({ op: "useAssets", add: ["Not An Id"] })).toBe(false);
    expect(parses({ op: "paintCells", ref: "a", field: "cells", cells: [[0, 0, 65536]] })).toBe(
      false,
    );
    expect(
      parses({ op: "paintCells", ref: "a", field: "cells", rects: [[0, 0, 255, 255, 1]] }),
    ).toBe(true);
    expect(
      parses({
        op: "paintCells",
        ref: "a",
        field: "cells",
        cells: [[0, 0, 1]],
        rects: [[0, 0, 255, 255, 1]],
      }),
    ).toBe(false);
    expect(parses({ op: "paintCells", ref: "a", field: "cells", rects: [[5, 0, 4, 0, 1]] })).toBe(
      false,
    );
    expect(
      parses({ op: "exposeParam", name: "speed", param: { description: "x", targets: [] } }),
    ).toBe(false);
  });

  it("refuses the header ops on a scene and setParam on an entity with op-invalid, and leaves the scene alone", () => {
    const withLift: SceneDefinition = {
      ...tiny,
      entities: [{ id: "lift", type: "marker", at: [1, 1] }],
    };
    for (const op of [
      { op: "setPrefabBase", base: null },
      { op: "exposeParam", name: "speed", param: null },
      { op: "setParam", ref: "lift", name: "speed", value: 1 },
    ] as const) {
      const result = applyOps(withLift, { ops: [op] } as OpBatch, engine);
      expect(result.ok, op.op).toBe(false);
      if (result.ok) continue;
      expect(result.issue.code).toBe("op-invalid");
      expect(result.issue.message).toMatch(/prefab's document|not a prefab instance/);
    }
  });

  it("stores instantiate's rot, flip, z and params", () => {
    const gate: Prefab = {
      kind: "prefab",
      v: 3,
      id: "gate",
      entities: [{ id: "post", type: "marker", at: [0, 0] }],
    };
    const result = applyOps(
      tiny,
      {
        ops: [
          {
            op: "instantiate",
            instance: {
              id: "g1",
              prefab: "gate",
              at: [10, 10],
              rot: 90,
              flip: true,
              z: 3,
              params: { a: 1 },
            },
          },
        ],
      },
      engine,
      { prefabs: new Map([["gate", gate]]) },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.def.instances).toEqual([
      { id: "g1", prefab: "gate", at: [10, 10], rot: 90, flip: true, z: 3, params: { a: 1 } },
    ]);
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

  it("rejects unknown fields and a malformed base, and takes metric coordinates", () => {
    const schema = opBatchSchemaFor(engine);
    expect(
      schema.safeParse({ ops: [{ op: "move", refs: ["a"], by: [1, 2], extra: 1 }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ ops: [{ op: "move", refs: ["a"], by: [0.16, 2] }] }).success).toBe(
      true,
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
    expect(usesBulkRefs({ ops: [{ op: "setZ", refs: ["~solid:0"], z: 1 }] })).toBe(true);
  });
});
