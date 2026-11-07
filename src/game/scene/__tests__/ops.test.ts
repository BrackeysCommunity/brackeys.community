import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { applyOps } from "../ops";
import { parseScene } from "../parse";
import {
  OP_NAMES,
  type ApplyResult,
  type OpBatch,
  type SceneDefinition,
  type SceneOp,
} from "../types";

function tiny(): SceneDefinition {
  return {
    v: 1,
    name: "tiny",
    bounds: [0, 0, 2000, 1200],
    spawn: [[100, 1000]],
    solid: [
      ["box", 500, 1040, 500, 20],
      ["box", 200, 900, 40, 8],
      ["box", 400, 800, 40, 8],
    ],
    cloud: [["box", 600, 700, 60, 6]],
    anchor: [[300, 300]],
    entities: [
      {
        id: "lift",
        b: "mover",
        shape: ["box", 0, 0, 40, 6],
        path: {
          pts: [
            [800, 1000],
            [800, 700],
          ],
          mode: "ping_pong",
          speed: 100,
          pauseMs: 500,
        },
      },
      { id: "cheese", b: "sensor", kind: "goal", shape: ["circle", 900, 600, 12] },
      { id: "pad", b: "construct", type: "bounce_pad", at: [1000, 1010] },
    ],
  };
}

const text = (def: SceneDefinition) => formatScene(def).text;

function ok(result: ApplyResult): Extract<ApplyResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.issue.code}: ${result.issue.message}`);
  return result;
}

function failed(result: ApplyResult): Extract<ApplyResult, { ok: false }> {
  if (result.ok) throw new Error("expected the batch to fail");
  return result;
}

/** Applies `batch`, then its inverse, and checks the document comes back byte for byte. */
function roundTrip(def: SceneDefinition, batch: OpBatch) {
  const forward = ok(applyOps(def, batch));
  const back = ok(applyOps(forward.def, forward.inverse));
  expect(text(back.def)).toBe(text(def));
  return forward;
}

const based = (def: SceneDefinition, ops: SceneOp[]): OpBatch => ({ base: sceneHash(def), ops });

describe("applyOps: add", () => {
  it("generates the lowest free <behavior>-<n> id and reports it", () => {
    const def = tiny();
    const r = roundTrip(def, {
      ops: [
        { op: "add", entity: { b: "anchor", at: [10, 10] } },
        { op: "add", entity: { b: "anchor", at: [20, 20] } },
      ],
    });
    expect(r.created).toEqual(["anchor-1", "anchor-2"]);
    expect(r.def.entities!.slice(-2).map((e) => e.id)).toEqual(["anchor-1", "anchor-2"]);
    expect(r.touched).toEqual(["anchor-1", "anchor-2"]);
  });

  it("keeps a given id, lets later ops in the batch use it, and inserts at index", () => {
    const def = tiny();
    const r = roundTrip(def, {
      ops: [
        { op: "add", entity: { id: "gate", b: "solid", shape: ["box", 0, 0, 10, 10] }, index: 0 },
        { op: "move", refs: ["gate"], by: [5, 0] },
      ],
    });
    expect(r.def.entities![0]).toEqual({ id: "gate", b: "solid", shape: ["box", 5, 0, 10, 10] });
  });

  it("stores rect and object shapes as tuples", () => {
    const r = roundTrip(tiny(), {
      ops: [
        {
          op: "add",
          entity: {
            id: "ledge",
            b: "solid",
            shape: { type: "rect", left: 100, top: 880, right: 180, bottom: 896 },
          },
        },
        {
          op: "add",
          entity: {
            id: "orb",
            b: "sensor",
            kind: "goal",
            shape: { type: "circle", cx: 1, cy: 2, r: 3 },
          },
        },
      ],
    });
    const ents = r.def.entities!;
    expect(ents.find((e) => e.id === "ledge")).toMatchObject({ shape: ["box", 140, 888, 40, 8] });
    expect(ents.find((e) => e.id === "orb")).toMatchObject({ shape: ["circle", 1, 2, 3] });
  });

  it("rejects a taken id, a malformed id, a bad shape and a schema failure", () => {
    const def = tiny();
    expect(
      failed(
        applyOps(def, { ops: [{ op: "add", entity: { id: "lift", b: "anchor", at: [0, 0] } }] }),
      ).issue.code,
    ).toBe("id-taken");
    expect(
      failed(
        applyOps(def, { ops: [{ op: "add", entity: { id: "Lift!", b: "anchor", at: [0, 0] } }] }),
      ).issue.code,
    ).toBe("bad-id");
    expect(
      failed(
        applyOps(def, {
          ops: [{ op: "add", entity: { b: "solid", shape: ["boxx", 0, 0, 1, 1] } as never }],
        }),
      ).issue.code,
    ).toBe("bad-shape");
    const schema = failed(
      applyOps(def, {
        ops: [{ op: "add", entity: { b: "mover", shape: ["box", 0, 0, 4, 4] } as never }],
      }),
    );
    expect(schema.issue.code).toBe("schema");
    expect(schema.issue.entityIds).toEqual(["mover-1"]);
  });

  it("rejects an index past the end", () => {
    const r = failed(
      applyOps(tiny(), { ops: [{ op: "add", entity: { b: "anchor", at: [0, 0] }, index: 9 }] }),
    );
    expect(r.issue.code).toBe("op-invalid");
  });
});

describe("applyOps: addBulk", () => {
  it("appends or inserts shapes and points", () => {
    const def = tiny();
    const r = roundTrip(def, {
      ops: [
        { op: "addBulk", key: "solid", shapes: [["box", 1, 1, 2, 2]], index: 1 },
        { op: "addBulk", key: "solid:ice", shapes: [["box", 9, 9, 2, 2]] },
        { op: "addBulk", key: "anchor", points: [[7, 7]] },
      ],
    });
    expect(r.def.solid![1]).toEqual(["box", 1, 1, 2, 2]);
    expect(r.def["solid:ice"]).toEqual([["box", 9, 9, 2, 2]]);
    expect(r.def.anchor).toEqual([
      [300, 300],
      [7, 7],
    ]);
    expect(r.touched).toEqual(expect.arrayContaining(["~solid:1", "~solid:ice:0", "~anchor:1"]));
  });

  it("keeps clouds box-only", () => {
    const r = failed(
      applyOps(tiny(), { ops: [{ op: "addBulk", key: "cloud", shapes: [["circle", 0, 0, 5]] }] }),
    );
    expect(r.issue.code).toBe("bad-shape");
  });
});

describe("applyOps: update", () => {
  it("sets and unsets nested fields", () => {
    const r = roundTrip(tiny(), {
      ops: [{ op: "update", ref: "lift", set: { "path.speed": 140 }, unset: ["path.pauseMs"] }],
    });
    const lift = r.def.entities![0]!;
    expect(lift).toMatchObject({ path: { speed: 140 } });
    expect(lift.b === "mover" && lift.path.pauseMs).toBe(undefined);
    expect(r.diff).toContainEqual({
      kind: "modified",
      ref: "lift",
      field: "path.speed",
      from: 100,
      to: 140,
    });
  });

  it("appends a path point at the end index and splices one out on unset", () => {
    const def = tiny();
    const added = roundTrip(def, {
      ops: [{ op: "update", ref: "lift", set: { "path.pts.2": [900, 700] } }],
    });
    expect(added.def.entities![0]).toMatchObject({
      path: {
        pts: [
          [800, 1000],
          [800, 700],
          [900, 700],
        ],
      },
    });
    const removed = roundTrip(added.def, {
      ops: [{ op: "update", ref: "lift", unset: ["path.pts.0"] }],
    });
    expect(removed.def.entities![0]).toMatchObject({
      path: {
        pts: [
          [800, 700],
          [900, 700],
        ],
      },
    });
  });

  it("accepts any shape form for `shape` and stores a tuple", () => {
    const r = roundTrip(tiny(), {
      ops: [
        {
          op: "update",
          ref: "cheese",
          set: { shape: { type: "box", cx: 1, cy: 2, hw: 3, hh: 4, rotDeg: 0 } },
        },
      ],
    });
    expect(r.def.entities![1]).toMatchObject({ shape: ["box", 1, 2, 3, 4] });
  });

  it("re-validates the entity", () => {
    const r = failed(
      applyOps(tiny(), { ops: [{ op: "update", ref: "lift", set: { "path.mode": "bounce" } }] }),
    );
    expect(r.issue.code).toBe("schema");
  });

  it("refuses id and behavior changes, overlapping paths and an empty update", () => {
    const def = tiny();
    for (const op of [
      { op: "update", ref: "lift", set: { id: "x" } },
      { op: "update", ref: "lift", set: { b: "solid" } },
      { op: "update", ref: "lift", set: { path: {}, "path.speed": 1 } },
      { op: "update", ref: "lift" },
    ] as SceneOp[]) {
      expect(failed(applyOps(def, { ops: [op] })).issue.code).toBe("op-invalid");
    }
  });

  it("updates a bulk entry's shape and nothing else", () => {
    const def = tiny();
    const r = roundTrip(
      def,
      based(def, [{ op: "update", ref: "~solid:1", set: { shape: ["box", 200, 900, 60, 8] } }]),
    );
    expect(r.def.solid![1]).toEqual(["box", 200, 900, 60, 8]);
    expect(
      failed(applyOps(def, based(def, [{ op: "update", ref: "~solid:1", set: { name: "x" } }])))
        .issue.code,
    ).toBe("op-invalid");
  });

  it("names the missing ref with a suggestion", () => {
    const r = failed(
      applyOps(tiny(), { ops: [{ op: "update", ref: "lifr", set: { "path.speed": 1 } }] }),
    );
    expect(r.issue.code).toBe("ref-not-found");
    expect(r.issue.message).toContain('did you mean "lift"?');
  });
});

describe("applyOps: move and place", () => {
  it("moves shapes, a mover's path, anchors and constructs", () => {
    const def = tiny();
    const r = roundTrip(
      def,
      based(def, [
        { op: "move", refs: ["~solid:1", "~anchor:0", "lift", "pad", "cheese"], by: [10, -5] },
      ]),
    );
    expect(r.def.solid![1]).toEqual(["box", 210, 895, 40, 8]);
    expect(r.def.anchor![0]).toEqual([310, 295]);
    const [lift, cheese, pad] = r.def.entities!;
    expect(lift).toMatchObject({
      shape: ["box", 0, 0, 40, 6],
      path: {
        pts: [
          [810, 995],
          [810, 695],
        ],
      },
    });
    expect(cheese).toMatchObject({ shape: ["circle", 910, 595, 12] });
    expect(pad).toMatchObject({ at: [1010, 1005] });
    expect(r.inverse.ops).toEqual([
      { op: "move", refs: ["lift", "cheese", "pad", "~solid:1", "~anchor:0"], by: [-10, 5] },
    ]);
    expect(r.inverse.base).toBe(r.hash);
  });

  it("places a shape's top edge on a point", () => {
    const def = tiny();
    const r = roundTrip(
      def,
      based(def, [{ op: "place", ref: "~solid:1", at: [250, 500], anchor: "top" }]),
    );
    expect(r.def.solid![1]).toEqual(["box", 250, 508, 40, 8]);
  });

  it("places a mover by its shape at the first path point", () => {
    const r = roundTrip(tiny(), {
      ops: [{ op: "place", ref: "lift", at: [800, 994], anchor: "bottom" }],
    });
    expect(r.def.entities![0]).toMatchObject({
      path: {
        pts: [
          [800, 988],
          [800, 688],
        ],
      },
    });
  });
});

describe("applyOps: remove", () => {
  it("resolves bulk refs against the batch's starting document", () => {
    const def = tiny();
    const r = roundTrip(
      def,
      based(def, [
        { op: "remove", refs: ["~solid:0"] },
        { op: "remove", refs: ["~solid:2"] },
      ]),
    );
    expect(r.def.solid).toEqual([["box", 200, 900, 40, 8]]);
  });

  it("fails on a ref removed earlier in the batch, or out of range", () => {
    const def = tiny();
    const twice = failed(
      applyOps(
        def,
        based(def, [
          { op: "remove", refs: ["~solid:0"] },
          { op: "move", refs: ["~solid:0"], by: [1, 0] },
        ]),
      ),
    );
    expect(twice.failedAt).toBe(1);
    expect(twice.issue.code).toBe("ref-not-found");
    expect(
      failed(applyOps(def, based(def, [{ op: "remove", refs: ["~solid:9"] }]))).issue.code,
    ).toBe("ref-not-found");
  });

  it("drops an emptied bucket and restores it on inverse", () => {
    const def = tiny();
    const r = roundTrip(def, based(def, [{ op: "remove", refs: ["~cloud:0", "cheese"] }]));
    expect(r.def.cloud).toBeUndefined();
    expect(r.diff).toContainEqual({ kind: "removed", ref: "cheese", behavior: "sensor" });
  });
});

describe("applyOps: rename, promote, demote", () => {
  it("renames and reports it", () => {
    const r = roundTrip(tiny(), { ops: [{ op: "rename", from: "lift", to: "elevator" }] });
    expect(r.def.entities![0]!.id).toBe("elevator");
    expect(r.diff).toEqual([{ kind: "renamed", from: "lift", to: "elevator" }]);
    expect(
      failed(applyOps(tiny(), { ops: [{ op: "rename", from: "lift", to: "cheese" }] })).issue.code,
    ).toBe("id-taken");
  });

  it("swaps two ids and undoes the swap", () => {
    roundTrip(tiny(), {
      ops: [
        { op: "rename", from: "lift", to: "tmp" },
        { op: "rename", from: "cheese", to: "lift" },
        { op: "rename", from: "tmp", to: "cheese" },
      ],
    });
  });

  it("promotes a bulk entry with its material, and demotes it back to the end of its bucket", () => {
    const def: SceneDefinition = {
      ...tiny(),
      "solid:ice": [
        ["box", 1, 1, 4, 4],
        ["box", 9, 9, 4, 4],
      ],
    };
    const promoted = roundTrip(
      def,
      based(def, [{ op: "promote", ref: "~solid:ice:0", id: "rink" }]),
    );
    expect(promoted.def["solid:ice"]).toEqual([["box", 9, 9, 4, 4]]);
    expect(promoted.def.entities!.at(-1)).toEqual({
      id: "rink",
      b: "solid",
      shape: ["box", 1, 1, 4, 4],
      material: "ice",
    });
    expect(promoted.created).toEqual(["rink"]);

    const demoted = roundTrip(promoted.def, { ops: [{ op: "demote", id: "rink" }] });
    expect(demoted.def["solid:ice"]).toEqual([
      ["box", 9, 9, 4, 4],
      ["box", 1, 1, 4, 4],
    ]);
    expect(demoted.inverse.base).toBe(demoted.hash);
  });

  it("won't demote what a bulk entry can't hold", () => {
    const def = tiny();
    expect(failed(applyOps(def, { ops: [{ op: "demote", id: "lift" }] })).issue.code).toBe(
      "op-invalid",
    );
    const named = ok(
      applyOps(def, {
        ops: [
          {
            op: "add",
            entity: { id: "wall", b: "solid", name: "Wall", shape: ["box", 0, 0, 1, 1] },
          },
        ],
      }),
    );
    const r = failed(applyOps(named.def, { ops: [{ op: "demote", id: "wall" }] }));
    expect(r.issue.message).toContain("name");
  });

  it("refuses to promote an id", () => {
    expect(
      failed(applyOps(tiny(), { ops: [{ op: "promote", ref: "lift", id: "x" }] })).issue.code,
    ).toBe("op-invalid");
  });
});

describe("applyOps: error messages", () => {
  it("suggests a behavior for a misspelled b on add", () => {
    const r = failed(
      applyOps(tiny(), {
        ops: [{ op: "add", entity: { b: "platfrom", shape: ["box", 0, 0, 1, 1] } as never }],
      }),
    );
    expect(r.issue).toMatchObject({ code: "op-invalid", path: "/ops/0/entity/b" });
    expect(r.issue.message).toContain('did you mean "mover"');
    expect(r.issue.got).toBe('"platfrom"');
  });

  it("names the set path and suggests the key for a misspelled update field", () => {
    const r = failed(
      applyOps(tiny(), { ops: [{ op: "update", ref: "lift", set: { "path.spead": 3 } }] }),
    );
    expect(r.issue.code).toBe("unknown-key");
    expect(r.issue.path).toBe("/ops/0/set/path.spead");
    expect(r.issue.message).toContain('did you mean "speed"');
    expect(r.issue.entityIds).toEqual(["lift"]);
  });

  it("suggests the key for a misspelled entity field on add", () => {
    const r = failed(
      applyOps(tiny(), {
        ops: [
          {
            op: "add",
            entity: { id: "x1", b: "solid", shape: ["box", 0, 0, 1, 1], materal: "ice" } as never,
          },
        ],
      }),
    );
    expect(r.issue).toMatchObject({ code: "unknown-key", path: "/ops/0/entity/materal" });
    expect(r.issue.message).toContain('did you mean "material"');
  });

  it("suggests the key for a misspelled op field", () => {
    const r = failed(
      applyOps(tiny(), { ops: [{ op: "move", refs: ["lift"], by: [1, 0], bye: 1 } as never] }),
    );
    expect(r.issue).toMatchObject({ code: "op-invalid", path: "/ops/0/bye", got: "bye" });
    expect(r.issue.message).toContain('did you mean "by"');
  });
});

describe("applyOps: remap", () => {
  it("says where each start ref went", () => {
    const def = tiny();
    const result = ok(
      applyOps(def, {
        base: sceneHash(def),
        ops: [
          { op: "remove", refs: ["~solid:0", "cheese"] },
          { op: "promote", ref: "~solid:1", id: "ledge" },
          { op: "rename", from: "lift", to: "elevator" },
        ],
      }),
    );
    expect(result.remap).toEqual({
      "~solid:0": null,
      "~solid:1": "ledge",
      "~solid:2": "~solid:0",
      cheese: null,
      lift: "elevator",
    });
  });

  it("is empty when nothing shifted", () => {
    const def = tiny();
    expect(ok(applyOps(def, { ops: [{ op: "move", refs: ["lift"], by: [1, 0] }] })).remap).toEqual(
      {},
    );
  });
});

describe("applyOps: spawns and scene", () => {
  it("sets, appends past the end and removes spawns", () => {
    const def = tiny();
    const r = roundTrip(def, {
      ops: [
        { op: "setSpawn", at: [50, 1000] },
        { op: "setSpawn", index: 7, at: [60, 1000] },
        { op: "setSpawn", index: 7, at: [70, 1000] },
        { op: "removeSpawn", index: 0 },
      ],
    });
    expect(r.def.spawn).toEqual([
      [60, 1000],
      [70, 1000],
    ]);
    expect(failed(applyOps(def, { ops: [{ op: "removeSpawn", index: 3 }] })).issue.code).toBe(
      "ref-not-found",
    );
  });

  it("restores a spawn removed from the middle", () => {
    const def: SceneDefinition = {
      ...tiny(),
      spawn: [
        [1, 1],
        [2, 2],
        [3, 3],
      ],
    };
    roundTrip(def, { ops: [{ op: "removeSpawn", index: 1 }] });
  });

  it("sets name and bounds, rejecting inverted bounds", () => {
    const def = tiny();
    const r = roundTrip(def, {
      ops: [{ op: "setScene", set: { name: "renamed", bounds: [-10, -10, 10, 10] } }],
    });
    expect(r.def.name).toBe("renamed");
    expect(r.diff.map((c) => c.kind === "scene" && c.field)).toEqual(["name", "bounds"]);
    expect(
      failed(applyOps(def, { ops: [{ op: "setScene", set: { bounds: [10, 0, 0, 10] } }] })).issue
        .code,
    ).toBe("op-invalid");
  });
});

describe("applyOps: base and atomicity", () => {
  it("fails a ~ batch against a changed document with the current hash", () => {
    const def = tiny();
    const stale = sceneHash(def);
    const changed = ok(applyOps(def, { ops: [{ op: "setScene", set: { name: "changed" } }] })).def;
    const r = failed(
      applyOps(changed, { base: stale, ops: [{ op: "remove", refs: ["~solid:0"] }] }),
    );
    expect(r.issue.code).toBe("stale-base");
    expect(r.issue.got).toBe(sceneHash(changed));
    expect(r.issue.hint).toMatch(/re-read/i);
    expect(failed(applyOps(def, { ops: [{ op: "remove", refs: ["~solid:0"] }] })).issue.code).toBe(
      "stale-base",
    );
  });

  it("applies an id-only batch whatever its base", () => {
    const r = applyOps(tiny(), {
      base: "0000000000000000",
      ops: [{ op: "move", refs: ["lift"], by: [1, 0] }],
    });
    expect(r.ok).toBe(true);
  });

  it("applies nothing when a later op fails, and never mutates its input", () => {
    const def = tiny();
    const before = JSON.stringify(def);
    const r = failed(
      applyOps(def, {
        ops: [
          { op: "move", refs: ["lift"], by: [1, 0] },
          { op: "update", ref: "missing", set: { x: 1 } },
        ],
      }),
    );
    expect(r.failedAt).toBe(1);
    expect(r.hash).toBe(sceneHash(def));
    expect(JSON.stringify(def)).toBe(before);

    ok(applyOps(def, { ops: [{ op: "move", refs: ["lift"], by: [1, 0] }] }));
    expect(JSON.stringify(def)).toBe(before);
  });

  it("validates the result unless told not to", () => {
    const def = tiny();
    const batch: OpBatch = { ops: [{ op: "removeSpawn", index: 0 }] };
    expect(ok(applyOps(def, batch)).issues.map((i) => i.code)).toContain("spawn-missing");
    expect(ok(applyOps(def, batch, { validate: "none" })).issues).toEqual([]);
  });

  it("returns the new hash and an empty batch changes nothing", () => {
    const def = tiny();
    const r = ok(applyOps(def, { ops: [] }));
    expect(r.hash).toBe(sceneHash(def));
    expect(r.inverse.ops).toEqual([]);
    expect(r.diff).toEqual([]);
  });
});

// ─── Property test ───────────────────────────────────────

/** mulberry32: small, seedable, good enough to pick ops. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const yardFile = new URL("../../scenes/test-yard.json", import.meta.url);

function loadYard(): SceneDefinition {
  const parsed = parseScene(JSON.parse(readFileSync(yardFile, "utf8")));
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join("\n"));
  return parsed.def;
}

function randomOp(def: SceneDefinition, rand: () => number): SceneOp {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
  const bulkRefs = (["solid", "solid:ice", "cloud", "anchor"] as const).flatMap((k) =>
    ((def[k] ?? []) as unknown[]).map((_, i) => `~${k}:${i}`),
  );
  const ids = (def.entities ?? []).map((e) => e.id);
  const refs = [...bulkRefs, ...ids];
  const any = () => pick(refs) ?? "missing";
  const by = (): [number, number] => [int(-64, 64), int(-64, 64)];

  switch (int(0, 12)) {
    case 0:
      return {
        op: "add",
        entity: { b: "solid", shape: ["box", int(0, 900), int(0, 900), int(1, 40), int(1, 20)] },
      };
    case 1:
      return {
        op: "add",
        entity: { b: "construct", type: "bounce_pad", at: [int(0, 900), int(0, 900)] },
        index: int(0, ids.length),
      };
    case 2:
      return {
        op: "addBulk",
        key: "cloud",
        shapes: [["box", int(0, 900), int(0, 900), int(10, 60), 6]],
        index: int(0, def.cloud?.length ?? 0),
      };
    case 3:
      return { op: "addBulk", key: "anchor", points: [[int(0, 900), int(0, 900)]] };
    case 4:
      return { op: "move", refs: [any(), any()], by: by() };
    case 5:
      return {
        op: "place",
        ref: any(),
        at: [int(0, 900), int(0, 900)],
        anchor: pick(["center", "top", "bottom", "left", "right"] as const),
      };
    case 6:
      return { op: "remove", refs: [any()] };
    case 7: {
      const mover = (def.entities ?? []).find((e) => e.b === "mover");
      return mover
        ? {
            op: "update",
            ref: mover.id,
            set: { "path.speed": int(20, 300) },
            unset: rand() < 0.5 ? ["path.pauseMs"] : [],
          }
        : { op: "setScene", set: { name: `yard-${int(0, 9)}` } };
    }
    case 8:
      return { op: "rename", from: pick(ids) ?? "missing", to: `r-${int(0, 99)}` };
    case 9:
      return { op: "promote", ref: pick(bulkRefs) ?? "~solid:0", id: `p-${int(0, 99)}` };
    case 10: {
      const demotable = (def.entities ?? []).filter((e) => e.id.startsWith("p-"));
      return { op: "demote", id: pick(demotable)?.id ?? "missing" };
    }
    case 11:
      return { op: "setSpawn", index: int(0, def.spawn.length), at: [int(0, 900), int(0, 900)] };
    default:
      return def.spawn.length > 1
        ? { op: "removeSpawn", index: int(0, def.spawn.length - 1) }
        : { op: "setScene", set: { bounds: [-int(1, 9) * 100, -500, 4000, 1200] } };
  }
}

describe("applyOps: property", () => {
  it("restores random batches byte for byte, with unique created ids", () => {
    const rand = rng(0x5eed);
    let doc = loadYard();
    let applied = 0;
    const kinds = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const ops = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => randomOp(doc, rand));
      const batch = based(doc, ops);
      const result = applyOps(doc, batch, { validate: "none" });
      if (!result.ok) continue;
      applied++;
      for (const op of ops) kinds.add(op.op);

      expect(new Set(result.created).size).toBe(result.created.length);
      for (const id of result.created)
        expect(result.def.entities!.some((e) => e.id === id)).toBe(true);

      const back = ok(applyOps(result.def, result.inverse, { validate: "none" }));
      expect(text(back.def)).toBe(text(doc));
      expect(back.hash).toBe(sceneHash(doc));

      const again = ok(applyOps(back.def, back.inverse, { validate: "none" }));
      expect(text(again.def)).toBe(text(result.def));

      if (rand() < 0.7) doc = result.def;
    }
    expect(applied).toBeGreaterThan(150);
    expect([...kinds].sort()).toEqual([...OP_NAMES].sort());
  }, 30_000);
});
