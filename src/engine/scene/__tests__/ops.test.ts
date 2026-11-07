import { describe, expect, it } from "vite-plus/test";

import type { Registry } from "../../game/types";
import { formatScene } from "../format";
import { sceneHash } from "../hash";
import { applyOps } from "../ops";
import { formatPrefabs } from "../prefab";
import {
  OP_NAMES,
  type ApplyOptions,
  type ApplyResult,
  type OpBatch,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneOp,
} from "../types";
import {
  engine,
  engineYard,
  fake,
  fakeYard,
  randomOp,
  rng,
  yardPrefabs,
} from "./fixtures/random-ops";

const text = (def: SceneDefinition) => formatScene(def).text;
const apply = (def: SceneDefinition, batch: OpBatch, opts?: ApplyOptions, reg = engine) =>
  applyOps(def, batch, reg, opts);

function ok(result: ApplyResult): Extract<ApplyResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got ${result.issue.code}: ${result.issue.message}`);
  return result;
}

function failed(result: ApplyResult): Extract<ApplyResult, { ok: false }> {
  if (result.ok) throw new Error("expected the batch to fail");
  return result;
}

/** Applies `batch`, then its inverse, and checks the document comes back byte for byte. */
function roundTrip(def: SceneDefinition, batch: OpBatch, reg: Registry = engine) {
  const forward = ok(applyOps(def, batch, reg));
  const back = ok(applyOps(forward.def, forward.inverse, reg));
  expect(text(back.def)).toBe(text(def));
  return forward;
}

const based = (def: SceneDefinition, ops: SceneOp[]): OpBatch => ({ base: sceneHash(def), ops });
const entity = (def: SceneDefinition, id: string) => def.entities!.find((e) => e.id === id);

describe("applyOps: add", () => {
  it("generates the lowest free <type>-<n> id and reports it", () => {
    const r = roundTrip(engineYard(), {
      ops: [
        { op: "add", entity: { type: "marker", at: [10, 10] } },
        { op: "add", entity: { type: "marker", at: [20, 20] } },
      ],
    });
    expect(r.created).toEqual(["marker-1", "marker-2"]);
    expect(r.def.entities!.slice(-2).map((e) => e.id)).toEqual(["marker-1", "marker-2"]);
    expect(r.touched).toEqual(["marker-1", "marker-2"]);
  });

  it("keeps a given id, lets later ops in the batch use it, and inserts at index", () => {
    const r = roundTrip(engineYard(), {
      ops: [
        {
          op: "add",
          entity: { id: "gate", type: "solid", shape: ["box", 0, 0, 10, 10] },
          index: 0,
        },
        { op: "move", refs: ["gate"], by: [5, 0] },
      ],
    });
    expect(r.def.entities![0]).toEqual({ id: "gate", type: "solid", shape: ["box", 5, 0, 10, 10] });
  });

  it("stores rect and object shapes as tuples", () => {
    const r = roundTrip(engineYard(), {
      ops: [
        {
          op: "add",
          entity: {
            id: "shelf",
            type: "solid",
            shape: { type: "rect", left: 100, top: 880, right: 180, bottom: 896 },
          },
        },
        {
          op: "add",
          entity: { id: "orb", type: "sensor", shape: { type: "circle", cx: 1, cy: 2, r: 3 } },
        },
      ],
    });
    expect(entity(r.def, "shelf")).toMatchObject({ shape: ["box", 140, 888, 40, 8] });
    expect(entity(r.def, "orb")).toMatchObject({ shape: ["circle", 1, 2, 3] });
  });

  it("rejects a taken id, a malformed id, a bad shape and a schema failure", () => {
    const def = engineYard();
    const add = (e: Record<string, unknown>) =>
      apply(def, { ops: [{ op: "add", entity: e as never }] });
    expect(failed(add({ id: "lift", type: "marker", at: [0, 0] })).issue.code).toBe("id-taken");
    expect(failed(add({ id: "Lift!", type: "marker", at: [0, 0] })).issue.code).toBe("bad-id");
    expect(failed(add({ type: "solid", shape: ["boxx", 0, 0, 1, 1] })).issue.code).toBe(
      "bad-shape",
    );
    const schema = failed(add({ type: "follower", shape: ["box", 0, 0, 4, 4] }));
    expect(schema.issue.code).toBe("schema");
    expect(schema.issue.entityIds).toEqual(["follower-1"]);
  });

  it("checks a game type against its own schema", () => {
    const r = failed(
      apply(
        fakeYard(),
        { ops: [{ op: "add", entity: { type: "ledge", shape: ["circle", 0, 0, 5] } }] },
        {},
        fake,
      ),
    );
    expect(r.issue.code).toBe("bad-shape");
    expect(r.issue.entityIds).toEqual(["ledge-1"]);
  });

  it("knows only the registry's types, with a did-you-mean", () => {
    const r = failed(
      apply(engineYard(), {
        ops: [{ op: "add", entity: { type: "folower", shape: ["box", 0, 0, 1, 1] } }],
      }),
    );
    expect(r.issue).toMatchObject({ code: "unknown-type", path: "/ops/0/entity/type" });
    expect(r.issue.message).toContain('did you mean "follower"');
    expect(r.issue.got).toBe('"folower"');
    expect(
      failed(apply(engineYard(), { ops: [{ op: "add", entity: { type: "ledge", at: [0, 0] } }] }))
        .issue.code,
    ).toBe("unknown-type");
  });

  it("points a leftover `b` at `type`", () => {
    const r = failed(
      apply(engineYard(), { ops: [{ op: "add", entity: { b: "marker", at: [0, 0] } as never }] }),
    );
    expect(r.issue).toMatchObject({ code: "op-invalid", path: "/ops/0/entity/type" });
    expect(r.issue.hint).toContain('"type"');
  });

  it("rejects an index past the end", () => {
    const r = failed(
      apply(engineYard(), {
        ops: [{ op: "add", entity: { type: "marker", at: [0, 0] }, index: 99 }],
      }),
    );
    expect(r.issue.code).toBe("op-invalid");
  });
});

describe("applyOps: addBulk", () => {
  it("appends or inserts shapes and points under any registered bulk key", () => {
    const def = fakeYard();
    const r = roundTrip(
      def,
      {
        ops: [
          { op: "addBulk", key: "solid", shapes: [["box", 1, 1, 2, 2]], index: 1 },
          { op: "addBulk", key: "solid:ice", shapes: [["box", 9, 9, 2, 2]] },
          { op: "addBulk", key: "peg", points: [[7, 7]] },
        ],
      },
      fake,
    );
    expect((r.def.solid as unknown[])[1]).toEqual(["box", 1, 1, 2, 2]);
    expect((r.def["solid:ice"] as unknown[]).at(-1)).toEqual(["box", 9, 9, 2, 2]);
    expect(r.def.peg).toEqual([
      [300, 300],
      [7, 7],
    ]);
    expect(r.touched).toEqual(expect.arrayContaining(["~solid:1", "~solid:ice:2", "~peg:1"]));
  });

  it("checks each entry against its type's schema", () => {
    const r = failed(
      apply(
        fakeYard(),
        {
          ops: [
            {
              op: "addBulk",
              key: "ledge",
              shapes: [
                ["box", 0, 0, 5, 5],
                ["circle", 0, 0, 5],
              ],
            },
          ],
        },
        {},
        fake,
      ),
    );
    expect(r.issue.code).toBe("bad-shape");
    expect(r.issue.entityIds).toEqual(["~ledge:2"]);
    expect(r.issue.path).toMatch(/^\/ops\/0\/shapes\/1/);
  });

  it("refuses a key the registry doesn't have", () => {
    const r = failed(
      apply(engineYard(), {
        ops: [{ op: "addBulk", key: "solid:ice", shapes: [["box", 0, 0, 1, 1]] }],
      }),
    );
    expect(r.issue.code).toBe("op-invalid");
  });
});

describe("applyOps: update", () => {
  it("sets and unsets nested fields", () => {
    const r = roundTrip(engineYard(), {
      ops: [{ op: "update", ref: "lift", set: { "path.speed": 140 }, unset: ["path.pauseMs"] }],
    });
    expect(entity(r.def, "lift")).toMatchObject({ path: { speed: 140 } });
    expect((entity(r.def, "lift")!.path as { pauseMs?: number }).pauseMs).toBe(undefined);
    expect(r.diff).toContainEqual({
      kind: "modified",
      ref: "lift",
      field: "path.speed",
      from: 80,
      to: 140,
    });
  });

  it("appends a path point at the end index and splices one out on unset", () => {
    const added = roundTrip(engineYard(), {
      ops: [{ op: "update", ref: "lift", set: { "path.pts.2": [1800, 600] } }],
    });
    expect(entity(added.def, "lift")).toMatchObject({
      path: {
        pts: [
          [1700, 900],
          [1700, 600],
          [1800, 600],
        ],
      },
    });
    const removed = roundTrip(added.def, {
      ops: [{ op: "update", ref: "lift", unset: ["path.pts.0"] }],
    });
    expect(entity(removed.def, "lift")).toMatchObject({
      path: {
        pts: [
          [1700, 600],
          [1800, 600],
        ],
      },
    });
  });

  it("accepts any shape form for `shape` and stores a tuple", () => {
    const r = roundTrip(engineYard(), {
      ops: [
        {
          op: "update",
          ref: "zone",
          set: { shape: { type: "box", cx: 1, cy: 2, hw: 3, hh: 4, rotDeg: 0 } },
        },
      ],
    });
    expect(entity(r.def, "zone")).toMatchObject({ shape: ["box", 1, 2, 3, 4] });
  });

  it("re-validates the entity", () => {
    const r = failed(
      apply(engineYard(), {
        ops: [{ op: "update", ref: "lift", set: { "path.mode": "bounce" } }],
      }),
    );
    expect(r.issue.code).toBe("schema");
  });

  it("refuses id and type changes, overlapping paths and an empty update", () => {
    const def = engineYard();
    for (const op of [
      { op: "update", ref: "lift", set: { id: "x" } },
      { op: "update", ref: "lift", set: { type: "solid" } },
      { op: "update", ref: "lift", set: { path: {}, "path.speed": 1 } },
      { op: "update", ref: "lift" },
    ] as SceneOp[]) {
      expect(failed(apply(def, { ops: [op] })).issue.code).toBe("op-invalid");
    }
  });

  it("updates a bulk entry's bulk field and nothing else", () => {
    const def = fakeYard();
    const r = roundTrip(
      def,
      based(def, [
        { op: "update", ref: "~solid:1", set: { shape: ["box", 20, 500, 30, 500] } },
        { op: "update", ref: "~peg:0", set: { at: [310, 300] } },
      ]),
      fake,
    );
    expect((r.def.solid as unknown[])[1]).toEqual(["box", 20, 500, 30, 500]);
    expect(r.def.peg).toEqual([[310, 300]]);
    for (const set of [{ name: "x" }, { at: [1, 1] }]) {
      expect(
        failed(apply(def, based(def, [{ op: "update", ref: "~solid:1", set }]), {}, fake)).issue
          .code,
      ).toBe("op-invalid");
    }
    expect(
      failed(
        apply(
          def,
          based(def, [{ op: "update", ref: "~ledge:0", set: { shape: ["circle", 0, 0, 4] } }]),
          {},
          fake,
        ),
      ).issue.code,
    ).toBe("bad-shape");
  });

  it("names the missing ref with a suggestion", () => {
    const r = failed(
      apply(engineYard(), { ops: [{ op: "update", ref: "lifr", set: { "path.speed": 1 } }] }),
    );
    expect(r.issue.code).toBe("ref-not-found");
    expect(r.issue.message).toContain('did you mean "lift"?');
  });

  it("names an unknown bulk key with a suggestion", () => {
    const def = engineYard();
    const r = failed(apply(def, based(def, [{ op: "remove", refs: ["~sold:0"] }])));
    expect(r.issue.code).toBe("ref-not-found");
    expect(r.issue.message).toContain("did you mean ~solid:0?");
  });
});

describe("applyOps: move and place", () => {
  it("moves shapes, a follower's path, points and bulk points", () => {
    const def = fakeYard();
    const r = roundTrip(
      def,
      based(def, [
        { op: "move", refs: ["~solid:1", "~peg:0", "lift", "start", "zone"], by: [10, -5] },
      ]),
      fake,
    );
    expect((r.def.solid as unknown[])[1]).toEqual(["box", 30, 495, 20, 500]);
    expect(r.def.peg).toEqual([[310, 295]]);
    expect(entity(r.def, "lift")).toMatchObject({
      shape: ["box", 0, 0, 60, 8],
      path: {
        pts: [
          [1710, 895],
          [1710, 595],
        ],
      },
    });
    expect(entity(r.def, "zone")).toMatchObject({ shape: ["box", 910, 925, 40, 30] });
    expect(entity(r.def, "start")).toMatchObject({ at: [310, 955] });
    expect(r.inverse.ops).toEqual([
      { op: "move", refs: ["lift", "zone", "start", "~solid:1", "~peg:0"], by: [-10, 5] },
    ]);
    expect(r.inverse.base).toBe(r.hash);
  });

  it("places a shape's top edge on a point", () => {
    const def = engineYard();
    const r = roundTrip(
      def,
      based(def, [{ op: "place", ref: "~solid:1", at: [250, 100], anchor: "top" }]),
    );
    expect((r.def.solid as unknown[])[1]).toEqual(["box", 250, 600, 20, 500]);
  });

  it("places a follower by its shape at the first path point", () => {
    const r = roundTrip(engineYard(), {
      ops: [{ op: "place", ref: "lift", at: [1700, 994], anchor: "bottom" }],
    });
    expect(entity(r.def, "lift")).toMatchObject({
      path: {
        pts: [
          [1700, 986],
          [1700, 686],
        ],
      },
    });
  });
});

describe("applyOps: remove", () => {
  it("resolves bulk refs against the batch's starting document", () => {
    const def = engineYard();
    const r = roundTrip(
      def,
      based(def, [
        { op: "remove", refs: ["~solid:0"] },
        { op: "remove", refs: ["~solid:2"] },
      ]),
    );
    expect(r.def.solid).toEqual([["box", 20, 500, 20, 500]]);
  });

  it("fails on a ref removed earlier in the batch, or out of range", () => {
    const def = engineYard();
    const twice = failed(
      apply(
        def,
        based(def, [
          { op: "remove", refs: ["~solid:0"] },
          { op: "move", refs: ["~solid:0"], by: [1, 0] },
        ]),
      ),
    );
    expect(twice.failedAt).toBe(1);
    expect(twice.issue.code).toBe("ref-not-found");
    expect(failed(apply(def, based(def, [{ op: "remove", refs: ["~solid:9"] }]))).issue.code).toBe(
      "ref-not-found",
    );
  });

  it("drops an emptied bulk array and restores it on inverse", () => {
    const def = fakeYard();
    const r = roundTrip(def, based(def, [{ op: "remove", refs: ["~peg:0", "zone"] }]), fake);
    expect(r.def.peg).toBeUndefined();
    expect(r.diff).toContainEqual({ kind: "removed", ref: "zone", type: "sensor" });
    expect(r.diff).toContainEqual({ kind: "removed", ref: "~peg:0", type: "peg" });
  });
});

describe("applyOps: rename, promote, demote", () => {
  it("renames and reports it", () => {
    const r = roundTrip(engineYard(), { ops: [{ op: "rename", from: "lift", to: "elevator" }] });
    expect(r.def.entities!.map((e) => e.id)).toContain("elevator");
    expect(r.diff).toEqual([{ kind: "renamed", from: "lift", to: "elevator" }]);
    expect(
      failed(apply(engineYard(), { ops: [{ op: "rename", from: "lift", to: "zone" }] })).issue.code,
    ).toBe("id-taken");
  });

  it("rewrites the type's declared refs to a renamed entity", () => {
    const r = roundTrip(
      fakeYard(),
      { ops: [{ op: "rename", from: "lift", to: "elevator" }] },
      fake,
    );
    expect(entity(r.def, "pull")).toMatchObject({ target: "elevator" });
  });

  it("swaps two ids and undoes the swap", () => {
    roundTrip(engineYard(), {
      ops: [
        { op: "rename", from: "lift", to: "tmp" },
        { op: "rename", from: "zone", to: "lift" },
        { op: "rename", from: "tmp", to: "zone" },
      ],
    });
  });

  it("promotes a bulk entry with its material, and demotes it back to the end of its array", () => {
    const def = fakeYard();
    const promoted = roundTrip(
      def,
      based(def, [{ op: "promote", ref: "~solid:ice:0", id: "rink" }]),
      fake,
    );
    expect(promoted.def["solid:ice"]).toEqual([["box", 600, 600, 40, 8]]);
    expect(promoted.def.entities!.at(-1)).toEqual({
      id: "rink",
      type: "solid",
      shape: ["box", 500, 700, 40, 8],
      material: "ice",
    });
    expect(promoted.created).toEqual(["rink"]);

    const demoted = roundTrip(promoted.def, { ops: [{ op: "demote", id: "rink" }] }, fake);
    expect(demoted.def["solid:ice"]).toEqual([
      ["box", 600, 600, 40, 8],
      ["box", 500, 700, 40, 8],
    ]);
    expect(demoted.inverse.base).toBe(demoted.hash);
  });

  it("promotes and demotes a point bulk entry", () => {
    const def = fakeYard();
    const promoted = roundTrip(
      def,
      based(def, [{ op: "promote", ref: "~peg:0", id: "hook" }]),
      fake,
    );
    expect(entity(promoted.def, "hook")).toEqual({ id: "hook", type: "peg", at: [300, 300] });
    const demoted = roundTrip(promoted.def, { ops: [{ op: "demote", id: "hook" }] }, fake);
    expect(demoted.def.peg).toEqual([[300, 300]]);
  });

  it("won't demote a type without a bulk form, or what a bulk entry can't hold", () => {
    const def = engineYard();
    expect(failed(apply(def, { ops: [{ op: "demote", id: "lift" }] })).issue.code).toBe(
      "op-invalid",
    );
    const r = failed(apply(def, { ops: [{ op: "demote", id: "ledge" }] }));
    expect(r.issue.message).toContain("oneWay");
  });

  it("won't demote an entity a ref still names", () => {
    const added = ok(
      apply(
        fakeYard(),
        {
          ops: [
            { op: "add", entity: { id: "hook", type: "peg", at: [1, 1] } },
            { op: "update", ref: "pull", set: { target: "hook" } },
          ],
        },
        {},
        fake,
      ),
    );
    const r = failed(apply(added.def, { ops: [{ op: "demote", id: "hook" }] }, {}, fake));
    expect(r.issue.message).toContain("referenced by pull");
  });

  it("refuses to promote an id", () => {
    expect(
      failed(apply(engineYard(), { ops: [{ op: "promote", ref: "lift", id: "x" }] })).issue.code,
    ).toBe("op-invalid");
  });
});

describe("applyOps: error messages", () => {
  it("names the set path and suggests the key for a misspelled update field", () => {
    const r = failed(
      apply(engineYard(), { ops: [{ op: "update", ref: "lift", set: { "path.spead": 3 } }] }),
    );
    expect(r.issue.code).toBe("unknown-key");
    expect(r.issue.path).toBe("/ops/0/set/path.spead");
    expect(r.issue.message).toContain('did you mean "speed"');
    expect(r.issue.entityIds).toEqual(["lift"]);
  });

  it("suggests the key for a misspelled entity field on add", () => {
    const r = failed(
      apply(engineYard(), {
        ops: [
          {
            op: "add",
            entity: { id: "x1", type: "solid", shape: ["box", 0, 0, 1, 1], oneWy: true } as never,
          },
        ],
      }),
    );
    expect(r.issue).toMatchObject({ code: "unknown-key", path: "/ops/0/entity/oneWy" });
    expect(r.issue.message).toContain('did you mean "oneWay"');
  });

  it("suggests the key for a misspelled op field", () => {
    const r = failed(
      apply(engineYard(), { ops: [{ op: "move", refs: ["lift"], by: [1, 0], bye: 1 } as never] }),
    );
    expect(r.issue).toMatchObject({ code: "op-invalid", path: "/ops/0/bye", got: "bye" });
    expect(r.issue.message).toContain('did you mean "by"');
  });

  it("suggests the key for a misspelled addBulk field", () => {
    const r = failed(
      apply(engineYard(), {
        ops: [{ op: "addBulk", key: "solid", shapes: [["box", 0, 0, 1, 1]], indx: 0 } as never],
      }),
    );
    expect(r.issue.message).toContain('did you mean "index"');
  });
});

describe("applyOps: remap", () => {
  it("says where each start ref went", () => {
    const def = engineYard();
    const result = ok(
      apply(def, {
        base: sceneHash(def),
        ops: [
          { op: "remove", refs: ["~solid:0", "zone"] },
          { op: "promote", ref: "~solid:1", id: "wall" },
          { op: "rename", from: "lift", to: "elevator" },
        ],
      }),
    );
    expect(result.remap).toEqual({
      "~solid:0": null,
      "~solid:1": "wall",
      "~solid:2": "~solid:0",
      zone: null,
      lift: "elevator",
    });
  });

  it("is empty when nothing shifted", () => {
    expect(
      ok(apply(engineYard(), { ops: [{ op: "move", refs: ["lift"], by: [1, 0] }] })).remap,
    ).toEqual({});
  });
});

describe("applyOps: scene and settings", () => {
  it("sets name and bounds, rejecting inverted bounds", () => {
    const def = engineYard();
    const r = roundTrip(def, {
      ops: [{ op: "setScene", set: { name: "renamed", bounds: [-10, -10, 3000, 3000] } }],
    });
    expect(r.def.name).toBe("renamed");
    expect(r.diff.map((c) => c.kind === "scene" && c.field)).toEqual(["name", "bounds"]);
    expect(
      failed(apply(def, { ops: [{ op: "setScene", set: { bounds: [10, 0, 0, 10] } }] })).issue.code,
    ).toBe("op-invalid");
  });

  it("sets and unsets engine and game settings", () => {
    const def = fakeYard();
    const r = roundTrip(
      def,
      { ops: [{ op: "setSettings", set: { gravity: [0, 900], wind: 40 } }] },
      fake,
    );
    expect(r.def.settings).toEqual({ gravity: [0, 900], wind: 40 });
    expect(r.diff).toEqual([
      { kind: "scene", field: "settings.gravity", from: [0, 1200], to: [0, 900] },
      { kind: "scene", field: "settings.wind", from: undefined, to: 40 },
    ]);
    const cleared = roundTrip(def, { ops: [{ op: "setSettings", unset: ["gravity"] }] }, fake);
    expect(cleared.def.settings).toBeUndefined();
  });

  it("restores settings whose key order changed", () => {
    const def = fakeYard();
    roundTrip(
      { ...def, settings: { gravity: [0, 1200], wind: 5 } },
      {
        ops: [
          { op: "setSettings", unset: ["gravity"] },
          { op: "setSettings", set: { gravity: [0, 1] } },
        ],
      },
      fake,
    );
  });

  it("checks settings against the registry's schema", () => {
    const def = engineYard();
    const unknown = failed(apply(def, { ops: [{ op: "setSettings", set: { gravty: [0, 1] } }] }));
    expect(unknown.issue).toMatchObject({ code: "unknown-key", path: "/ops/0/set/gravty" });
    expect(unknown.issue.message).toContain('did you mean "gravity"');
    expect(failed(apply(def, { ops: [{ op: "setSettings", set: { wind: 3 } }] })).issue.code).toBe(
      "unknown-key",
    );
    expect(
      failed(apply(def, { ops: [{ op: "setSettings", set: { gravity: "down" } }] })).issue.code,
    ).toBe("schema");
    expect(failed(apply(def, { ops: [{ op: "setSettings" }] })).issue.code).toBe("op-invalid");
  });
});

describe("applyOps: base and atomicity", () => {
  it("fails a ~ batch against a changed document with the current hash", () => {
    const def = engineYard();
    const stale = sceneHash(def);
    const changed = ok(apply(def, { ops: [{ op: "setScene", set: { name: "changed" } }] })).def;
    const r = failed(apply(changed, { base: stale, ops: [{ op: "remove", refs: ["~solid:0"] }] }));
    expect(r.issue.code).toBe("stale-base");
    expect(r.issue.got).toBe(sceneHash(changed));
    expect(r.issue.hint).toMatch(/re-read/i);
    expect(failed(apply(def, { ops: [{ op: "remove", refs: ["~solid:0"] }] })).issue.code).toBe(
      "stale-base",
    );
  });

  it("applies an id-only batch whatever its base", () => {
    const r = apply(engineYard(), {
      base: "0000000000000000",
      ops: [{ op: "move", refs: ["lift"], by: [1, 0] }],
    });
    expect(r.ok).toBe(true);
  });

  it("applies nothing when a later op fails, and never mutates its input", () => {
    const def = engineYard();
    const before = JSON.stringify(def);
    const r = failed(
      apply(def, {
        ops: [
          { op: "move", refs: ["lift"], by: [1, 0] },
          { op: "update", ref: "missing", set: { x: 1 } },
        ],
      }),
    );
    expect(r.failedAt).toBe(1);
    expect(r.hash).toBe(sceneHash(def));
    expect(JSON.stringify(def)).toBe(before);

    ok(apply(def, { ops: [{ op: "move", refs: ["lift"], by: [1, 0] }] }));
    expect(JSON.stringify(def)).toBe(before);
  });

  it("validates the result against the registry unless told not to", () => {
    const def = engineYard();
    const batch: OpBatch = { ops: [{ op: "move", refs: ["zone"], by: [5000, 0] }] };
    expect(ok(apply(def, batch)).issues.map((i) => i.code)).toContain("out-of-bounds");
    expect(ok(apply(def, batch, { validate: "none" })).issues).toEqual([]);
  });

  it("returns the new hash and an empty batch changes nothing", () => {
    const def = engineYard();
    const r = ok(apply(def, { ops: [] }));
    expect(r.hash).toBe(sceneHash(def));
    expect(r.inverse.ops).toEqual([]);
    expect(r.diff).toEqual([]);
  });
});

// ─── Property test ───────────────────────────────────────

/** mulberry32: small, seedable, good enough to pick ops. */
describe("applyOps: property", () => {
  for (const [label, reg, yard] of [
    ["engine-yard on the engine registry", engine, engineYard],
    ["the fake game's yard", fake, fakeYard],
  ] as const) {
    it(`restores random batches byte for byte, with unique created ids: ${label}`, () => {
      const rand = rng(0x5eed);
      let doc = yard();
      let prefabs = yardPrefabs(yard().game);
      let applied = 0;
      const kinds = new Set<string>();
      const library = (p: PrefabLibrary) => formatPrefabs(p);
      for (let i = 0; i < 600; i++) {
        const ops = Array.from({ length: 1 + Math.floor(rand() * 4) }, () =>
          randomOp(reg, doc, rand, prefabs),
        );
        const result = applyOps(doc, based(doc, ops), reg, { validate: "none", prefabs });
        if (!result.ok) continue;
        applied++;
        for (const op of ops) kinds.add(op.op);
        const after = result.prefabs ?? prefabs;

        expect(new Set(result.created).size).toBe(result.created.length);
        for (const id of result.created)
          expect(
            result.def.entities?.some((e) => e.id === id) ||
              result.def.instances?.some((e) => e.id === id),
          ).toBe(true);

        const back = ok(
          applyOps(result.def, result.inverse, reg, { validate: "none", prefabs: after }),
        );
        expect(text(back.def)).toBe(text(doc));
        expect(back.hash).toBe(sceneHash(doc));
        expect(library(back.prefabs ?? after)).toEqual(library(prefabs));

        const again = ok(
          applyOps(back.def, back.inverse, reg, {
            validate: "none",
            prefabs: back.prefabs ?? after,
          }),
        );
        expect(text(again.def)).toBe(text(result.def));
        expect(library(again.prefabs ?? back.prefabs ?? after)).toEqual(library(after));

        if (rand() < 0.7) {
          doc = result.def;
          prefabs = after;
        }
      }
      expect(applied).toBeGreaterThan(150);
      expect([...kinds].sort()).toEqual([...OP_NAMES].sort());
    }, 30_000);
  }
});
