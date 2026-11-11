import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry, defineEntityType } from "../../game/define";
import { pointField } from "../../game/fields";
import type { Registry } from "../../game/types";
import type { AssetEntry } from "../../project/types";
import { projectView } from "../../project/view";
import { formatScene } from "../format";
import { readCell, type GridCells } from "../grid";
import { sceneHash } from "../hash";
import { applyOps } from "../ops";
import { formatPrefabs, prefabLibrary } from "../prefab";
import { resolveScene } from "../resolve";
import { aabb } from "../shape-geometry";
import { parseShape } from "../shapes";
import { applyPt, compose, dihedral, flipWorld, IDENTITY_2D, type Dihedral } from "../transform";
import {
  OP_NAMES,
  type ApplyOptions,
  type ApplyResult,
  type EntityDef,
  type InstanceDef,
  type OpBatch,
  type PrefabLibrary,
  type Pt,
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

describe("applyOps: setZ", () => {
  const prefabs = yardPrefabs();

  it("sets z on entities and instances at its canonical key, with an exact inverse", () => {
    const def = engineYard();
    const r = ok(
      applyOps(def, { ops: [{ op: "setZ", refs: ["crate", "gate-1"], z: 5 }] }, engine, {
        prefabs,
      }),
    );
    expect(Object.keys(entity(r.def, "crate")!)).toEqual([
      "id",
      "type",
      "z",
      "shape",
      "density",
      "restitution",
    ]);
    expect(entity(r.def, "crate")!.z).toBe(5);
    expect(r.def.instances![0]).toEqual({ id: "gate-1", prefab: "gate", z: 5, at: [1100, 900] });
    expect(r.inverse.ops).toEqual([{ op: "setZ", refs: ["crate", "gate-1"], z: 0 }]);
    const back = ok(applyOps(r.def, r.inverse, engine, { prefabs }));
    expect(back.def).toEqual(def);
    expect(r.diff).toEqual([
      { kind: "modified", ref: "crate", field: "z", from: undefined, to: 5 },
      { kind: "modified", ref: "gate-1", field: "z", from: undefined, to: 5 },
    ]);
  });

  it("shifts by an amount, writes 0 as absent and restores the old value exactly", () => {
    const def = ok(
      applyOps(engineYard(), { ops: [{ op: "setZ", refs: ["crate"], z: 3 }] }, engine, {
        prefabs,
      }),
    ).def;
    const up = ok(
      applyOps(def, { ops: [{ op: "setZ", refs: ["crate", "ledge"], by: -3 }] }, engine, {
        prefabs,
      }),
    );
    expect("z" in entity(up.def, "crate")!).toBe(false);
    expect(entity(up.def, "ledge")!.z).toBe(-3);
    expect(up.inverse.ops).toEqual([
      { op: "setZ", refs: ["ledge"], z: 0 },
      { op: "setZ", refs: ["crate"], z: 3 },
    ]);
    expect(ok(applyOps(up.def, up.inverse, engine, { prefabs })).def).toEqual(def);
  });

  it("update writes z 0 as absent too, matching setZ", () => {
    const def = ok(
      applyOps(engineYard(), { ops: [{ op: "setZ", refs: ["crate", "gate-1"], z: 3 }] }, engine, {
        prefabs,
      }),
    ).def;
    const viaSetZ = ok(
      applyOps(def, { ops: [{ op: "setZ", refs: ["crate", "gate-1"], z: 0 }] }, engine, {
        prefabs,
      }),
    );
    const viaUpdate = ok(
      applyOps(
        def,
        {
          ops: [
            { op: "update", ref: "crate", set: { z: 0 } },
            { op: "update", ref: "gate-1", set: { z: 0 } },
          ],
        },
        engine,
        { prefabs },
      ),
    );
    expect("z" in entity(viaUpdate.def, "crate")!).toBe(false);
    expect("z" in viaUpdate.def.instances![0]!).toBe(false);
    expect(viaUpdate.hash).toBe(viaSetZ.hash);
    expect(ok(applyOps(viaUpdate.def, viaUpdate.inverse, engine, { prefabs })).def).toEqual(def);
  });

  it("refuses bulk entries, child refs, both or neither of z and by, and z past ±10000", () => {
    const def = engineYard();
    const run = (op: SceneOp) => failed(applyOps(def, based(def, [op]), engine, { prefabs }));
    const bulk = run({ op: "setZ", refs: ["~solid:0"], z: 1 });
    expect(bulk.issue.code).toBe("op-invalid");
    expect(bulk.issue.message).toMatch(/promote/);
    expect(run({ op: "setZ", refs: ["gate-1/door"], z: 1 }).issue.code).toBe("ref-not-found");
    expect(run({ op: "setZ", refs: ["crate"] }).issue.code).toBe("op-invalid");
    expect(run({ op: "setZ", refs: ["crate"], z: 1, by: 1 }).issue.code).toBe("op-invalid");
    const far = run({ op: "setZ", refs: ["crate"], by: 10_001 });
    expect(far.issue.code).toBe("op-invalid");
    expect(far.issue.message).toMatch(/10000/);
  });

  it("keeps an instance's z when it is removed and restored", () => {
    const def = ok(
      applyOps(engineYard(), { ops: [{ op: "setZ", refs: ["gate-1"], z: -4 }] }, engine, {
        prefabs,
      }),
    ).def;
    const r = ok(applyOps(def, { ops: [{ op: "remove", refs: ["gate-1"] }] }, engine, { prefabs }));
    expect(ok(applyOps(r.def, r.inverse, engine, { prefabs })).def).toEqual(def);
  });

  it("bakes the instance's z into its children on unpack", () => {
    const def = ok(
      applyOps(engineYard(), { ops: [{ op: "setZ", refs: ["gate-1"], z: 2 }] }, engine, {
        prefabs,
      }),
    ).def;
    const r = ok(applyOps(def, { ops: [{ op: "unpack", ref: "gate-1" }] }, engine, { prefabs }));
    expect(r.def.entities!.filter((e) => e.z === 2).map((e) => e.type)).toEqual([
      "follower",
      "sensor",
    ]);
    expect(text(ok(applyOps(r.def, r.inverse, engine, { prefabs })).def)).toBe(text(def));
  });
});

describe("applyOps: useAssets", () => {
  it("keeps the header sorted and unique, with an exact inverse", () => {
    const def = engineYard();
    const r = roundTrip(def, {
      ops: [
        { op: "useAssets", add: ["zap", "boom", "boom"] },
        { op: "useAssets", add: ["hud-font"] },
      ],
    });
    expect(r.def.assets).toEqual(["boom", "hud-font", "zap"]);
    expect(r.inverse.ops).toEqual([{ op: "useAssets", remove: ["boom", "hud-font", "zap"] }]);
    expect("assets" in ok(apply(r.def, r.inverse)).def).toBe(false);
    expect(r.diff).toEqual([
      { kind: "scene", field: "assets", from: undefined, to: ["boom", "hud-font", "zap"] },
    ]);
    expect(text(r.def)).toContain('\n  "assets": ["boom", "hud-font", "zap"],\n  "groups"');
  });

  it("removes ids, takes adding a present id or removing an absent one as no change", () => {
    const def = { ...engineYard(), assets: ["boom", "hud-font"] };
    const r = roundTrip(def, {
      ops: [{ op: "useAssets", add: ["boom", "aura"], remove: ["hud-font", "gone"] }],
    });
    expect(r.def.assets).toEqual(["aura", "boom"]);
    expect(r.inverse.ops).toEqual([{ op: "useAssets", add: ["hud-font"], remove: ["aura"] }]);
    const empty = roundTrip(def, { ops: [{ op: "useAssets", remove: ["boom", "hud-font"] }] });
    expect("assets" in empty.def).toBe(false);
  });

  it("refuses an empty op and an id both added and removed", () => {
    const def = engineYard();
    expect(failed(apply(def, { ops: [{ op: "useAssets" }] })).issue.code).toBe("op-invalid");
    expect(
      failed(apply(def, { ops: [{ op: "useAssets", add: ["boom"], remove: ["boom"] }] })).issue
        .code,
    ).toBe("op-invalid");
    expect(failed(apply(def, { ops: [{ op: "useAssets", add: ["Not An Id"] }] })).issue.code).toBe(
      "op-invalid",
    );
  });
});

// ─── Property test ───────────────────────────────────────

/** Ops the random generator doesn't produce, so no random batch holds one. */
const game = createRegistry(testGame);
const GLOW = "test-game/glow";
const SPIN = "test-game/spin";

/** A test-game scene on a square grid: a lamp, a painted floor and an instance of a prefab holding both. */
function gameYard(): SceneDefinition {
  return {
    v: 3,
    game: "test-game",
    name: "game-yard",
    bounds: [0, 0, 1000, 1000],
    settings: { grid: { kind: "square", cell: [32, 32] } },
    instances: [{ id: "room-1", prefab: "room", at: [200, 200] }],
    entities: [
      { id: "lamp", type: "lamp", at: [100, 100] },
      { id: "floor", type: "paint", at: [0, 640], cells: { "0,0": ["1*4", "", "2"] } },
    ],
  };
}

const gamePrefabs = prefabLibrary([
  {
    kind: "prefab",
    v: 3,
    game: "test-game",
    id: "room",
    entities: [
      { id: "light", type: "lamp", at: [10, 10] },
      { id: "rug", type: "paint", at: [0, 0], cells: { "0,0": ["3*2"] } },
    ],
  },
]);

const gameApply = (def: SceneDefinition, batch: OpBatch) =>
  applyOps(def, batch, game, { prefabs: gamePrefabs });

/** Applies `batch` on the test game, then its inverse, and checks the text comes back exactly. */
function gameRoundTrip(def: SceneDefinition, batch: OpBatch) {
  const forward = ok(gameApply(def, batch));
  const back = ok(gameApply(forward.def, forward.inverse));
  expect(text(back.def)).toBe(text(def));
  return forward;
}

/** `roundTrip` with the yard's prefabs loaded, for ops that check instances against them. */
function yardRoundTrip(def: SceneDefinition, batch: OpBatch) {
  const prefabs = yardPrefabs();
  const forward = ok(applyOps(def, batch, engine, { prefabs }));
  const back = ok(applyOps(forward.def, forward.inverse, engine, { prefabs }));
  expect(text(back.def)).toBe(text(def));
  return forward;
}

describe("applyOps: behaviors", () => {
  it("adds a block with set, removes it with unset, and creates it when a field is set", () => {
    const added = gameRoundTrip(gameYard(), {
      ops: [{ op: "update", ref: "lamp", set: { [`behaviors.${SPIN}`]: {} } }],
    });
    expect(entity(added.def, "lamp")!.behaviors).toEqual({ [SPIN]: {} });

    const removed = gameRoundTrip(added.def, {
      ops: [{ op: "update", ref: "lamp", unset: [`behaviors.${SPIN}`] }],
    });
    expect("behaviors" in entity(removed.def, "lamp")!).toBe(false);
    expect(text(removed.def)).toBe(text(gameYard()));

    const field = gameRoundTrip(gameYard(), {
      ops: [{ op: "update", ref: "lamp", set: { [`behaviors.${SPIN}.speed`]: 45 } }],
    });
    expect(entity(field.def, "lamp")!.behaviors).toEqual({ [SPIN]: { speed: 45 } });
  });

  it("keeps the other blocks when one goes, and checks block fields against the behavior", () => {
    const def = ok(
      gameApply(gameYard(), {
        ops: [
          {
            op: "update",
            ref: "lamp",
            set: { [`behaviors.${SPIN}`]: { speed: 10 }, [`behaviors.${GLOW}`]: { intensity: 3 } },
          },
        ],
      }),
    ).def;
    const r = gameRoundTrip(def, {
      ops: [{ op: "update", ref: "lamp", unset: [`behaviors.${SPIN}`] }],
    });
    expect(entity(r.def, "lamp")!.behaviors).toEqual({ [GLOW]: { intensity: 3 } });
    const bad = failed(
      gameApply(gameYard(), {
        ops: [{ op: "update", ref: "lamp", set: { [`behaviors.${GLOW}.color`]: "red" } }],
      }),
    );
    expect(bad.issue.code).toBe("schema");
  });

  it("refuses a path outside the field-path grammar", () => {
    const r = failed(
      gameApply(gameYard(), { ops: [{ op: "update", ref: "lamp", set: { "behaviors..x": 1 } }] }),
    );
    expect(r.issue.code).toBe("op-invalid");
    expect(r.issue.message).toMatch(/field path/);
  });

  it("reaches into a child's blocks through override keys", () => {
    const r = gameRoundTrip(gameYard(), {
      ops: [{ op: "override", ref: "room-1", set: { [`light.behaviors.${GLOW}.intensity`]: 4 } }],
    });
    expect(r.def.instances![0]!.overrides).toEqual({ [`light.behaviors.${GLOW}.intensity`]: 4 });
    const light = resolveScene(r.def, game, gamePrefabs).entities!.find(
      (e) => e.id === "room-1/light",
    )!;
    expect(light.behaviors).toEqual({ [GLOW]: { intensity: 4 } });
  });
});

describe("applyOps: grid fields", () => {
  const cells = (def: SceneDefinition, id = "floor") => entity(def, id)!.cells as GridCells;

  it("paints cells and rects, erases with 0, and undoes exactly", () => {
    const r = gameRoundTrip(gameYard(), {
      ops: [
        {
          op: "paintCells",
          ref: "floor",
          field: "cells",
          cells: [
            [0, 0, 0],
            [5, 1, 3],
            [-1, -1, 2],
          ],
          rects: [[30, 30, 33, 31, 1]],
        },
      ],
    });
    const g = cells(r.def);
    expect(readCell(g, 0, 0)).toBe(0);
    expect(readCell(g, 1, 0)).toBe(1);
    expect(readCell(g, 5, 1)).toBe(3);
    expect(readCell(g, -1, -1)).toBe(2);
    for (const [c, row] of [
      [30, 30],
      [33, 31],
      [32, 30],
    ] as const)
      expect(readCell(g, c, row)).toBe(1);
    expect(r.inverse.ops.every((op) => op.op === "paintCells")).toBe(true);
  });

  it("refuses more than 65,536 cells in one op and takes exactly that many", () => {
    const def = gameYard();
    const over = failed(
      gameApply(def, {
        ops: [{ op: "paintCells", ref: "floor", field: "cells", rects: [[0, 0, 256, 255, 1]] }],
      }),
    );
    expect(over.issue.code).toBe("op-invalid");
    expect(over.issue.message).toMatch(/65536/);
    const r = gameRoundTrip(def, {
      ops: [{ op: "paintCells", ref: "floor", field: "cells", rects: [[0, 0, 255, 255, 2]] }],
    });
    expect(readCell(cells(r.def), 255, 255)).toBe(2);
    expect(r.inverse.ops.filter((op) => op.op === "paintCells")).toHaveLength(1);
  });

  it("splits an inverse past the cap into several ops and keeps it exact", () => {
    const r = gameRoundTrip(gameYard(), {
      ops: [
        { op: "paintCells", ref: "floor", field: "cells", rects: [[0, 0, 255, 255, 2]] },
        { op: "paintCells", ref: "floor", field: "cells", rects: [[0, 256, 255, 300, 3]] },
      ],
    });
    expect(r.inverse.ops.filter((op) => op.op === "paintCells").length).toBeGreaterThan(1);
  });

  it("undoes a paint and a move of the same entity together", () => {
    const r = gameRoundTrip(gameYard(), {
      ops: [
        { op: "paintCells", ref: "floor", field: "cells", cells: [[2, 2, 3]] },
        { op: "move", refs: ["floor"], by: [32, 0] },
      ],
    });
    expect(r.inverse.ops.map((op) => op.op).sort()).toEqual(["move", "paintCells"]);
  });

  it("refuses an instance child, with the prefab to open, and a field that isn't a grid", () => {
    const def = gameYard();
    const child = failed(
      gameApply(def, {
        ops: [{ op: "paintCells", ref: "room-1/rug", field: "cells", cells: [[0, 0, 1]] }],
      }),
    );
    expect(child.issue.code).toBe("op-invalid");
    expect(child.issue.message).toMatch(/open the prefab "room"/);
    const notGrid = failed(
      gameApply(def, {
        ops: [{ op: "paintCells", ref: "floor", field: "at", cells: [[0, 0, 1]] }],
      }),
    );
    expect(notGrid.issue.code).toBe("op-invalid");
    expect(notGrid.issue.message).toMatch(/isn't a grid field/);
    const instance = failed(
      gameApply(def, {
        ops: [{ op: "paintCells", ref: "room-1", field: "cells", cells: [[0, 0, 1]] }],
      }),
    );
    expect(instance.issue.code).toBe("op-invalid");
    const lamp = failed(
      gameApply(def, {
        ops: [{ op: "paintCells", ref: "lamp", field: "cells", cells: [[0, 0, 1]] }],
      }),
    );
    expect(lamp.issue.message).toMatch(/has none/);
  });

  it("sets a grid field whole through update, and refuses paths below it", () => {
    const r = gameRoundTrip(gameYard(), {
      ops: [{ op: "update", ref: "floor", set: { cells: { "1,0": ["2*3"] } } }],
    });
    expect(cells(r.def)).toEqual({ "1,0": ["2*3"] });
    const below = failed(
      gameApply(gameYard(), { ops: [{ op: "update", ref: "floor", set: { "cells.x": [] } }] }),
    );
    expect(below.issue.code).toBe("op-invalid");
    expect(below.issue.message).toMatch(/grid field/);
    expect(below.issue.hint).toMatch(/paintCells/);
  });

  it("refuses an override of a child's grid field", () => {
    const r = failed(
      gameApply(gameYard(), {
        ops: [{ op: "override", ref: "room-1", set: { "rug.cells": { "0,0": ["1"] } } }],
      }),
    );
    expect(r.issue.code).toBe("grid-invalid");
    expect(r.issue.message).toMatch(/prefab "room"/);
  });
});

describe("applyOps: transform", () => {
  const prefabs = yardPrefabs();
  const run = (def: SceneDefinition, ops: SceneOp[]) => ok(apply(def, { ops }, { prefabs }));
  const resolved = (def: SceneDefinition, id: string) =>
    resolveScene(def, engine, prefabs).entities!.find((e) => e.id === id)!;
  /** The world points a resolved entity's geometry puts down: a point, a path's points, else a shape's center. */
  const points = (e: EntityDef): Pt[] => {
    const path = (e.path as { pts?: Pt[] } | undefined)?.pts;
    return [
      ...(Array.isArray(e.shape) && !path ? [[e.shape[1], e.shape[2]] as Pt] : []),
      ...(Array.isArray(e.at) ? [e.at as Pt] : []),
      ...(path ?? []),
    ];
  };
  const ELEMENTS: { turn?: 1 | 2 | 3 | -1; flip?: "x" | "y" }[] = [
    { turn: 1 },
    { turn: 2 },
    { turn: 3 },
    { turn: -1 },
    { flip: "x" },
    { flip: "y" },
    { turn: 1, flip: "x" },
    { turn: 3, flip: "y" },
  ];
  const worldOf = ({ turn, flip }: { turn?: number; flip?: "x" | "y" }): Dihedral => {
    const turned: Dihedral = { rot: (((turn ?? 0) + 4) % 4) as Dihedral["rot"], flip: false };
    return flip ? flipWorld(turned, flip) : turned;
  };
  const about = (d: Dihedral, p: Pt) =>
    compose(dihedral(d, p), { ...IDENTITY_2D, tx: -p[0], ty: -p[1] });

  it("turns an instance in place, -1 meaning three quarter turns, with an exact inverse", () => {
    const r = yardRoundTrip(engineYard(), {
      ops: [{ op: "transform", refs: ["gate-1"], turn: -1 }],
    });
    expect(r.def.instances![0]).toEqual({ id: "gate-1", prefab: "gate", at: [1100, 900], rot: 3 });
    expect(r.inverse.ops).toEqual([{ op: "update", ref: "gate-1", unset: ["rot"] }]);
  });

  it("composes in world terms: every element about the origin and about a point", () => {
    for (const el of ELEMENTS) {
      for (const pivot of [undefined, [1000, 800] as Pt]) {
        let def = engineYard();
        def = run(def, [{ op: "transform", refs: ["gate-1"], turn: 1, flip: "x" }]).def;
        const before = ["door", "trigger", "~solid:0"].map((c) => resolved(def, `gate-1/${c}`));
        const r = ok(
          apply(
            def,
            {
              ops: [
                { op: "transform", refs: ["gate-1"], ...el, ...(pivot ? { about: pivot } : {}) },
              ],
            },
            { prefabs },
          ),
        );
        const t = about(worldOf(el), pivot ?? [1100, 900]);
        before.forEach((b) => {
          const after = resolved(r.def, b.id);
          expect(points(after), `${JSON.stringify(el)} ${b.id}`).toEqual(
            points(b).map((p) => applyPt(t, p)),
          );
        });
        expect(text(ok(apply(r.def, r.inverse, { prefabs })).def)).toBe(text(def));
      }
    }
  });

  it("conjugates an instance through its turned group, keeping its group-local at", () => {
    let def = run(engineYard(), [{ op: "setGroup", id: "raised", rot: 1, flip: true }]).def;
    const top = resolved(def, "post-1/top");
    const r = ok(
      apply(
        def,
        { ops: [{ op: "transform", refs: ["post-1"], turn: 1, about: [0, 0] }] },
        { prefabs },
      ),
    );
    expect(points(resolved(r.def, "post-1/top"))).toEqual(
      points(top).map((p) => applyPt(about(worldOf({ turn: 1 }), [0, 0]), p)),
    );
    def = r.def;
    expect(text(ok(apply(def, r.inverse, { prefabs })).def)).toBe(
      text(run(engineYard(), [{ op: "setGroup", id: "raised", rot: 1, flip: true }]).def),
    );
  });

  it("turns and flips groups about a point, moving their members with them", () => {
    const def = engineYard();
    const top = resolved(def, "post-1/top");
    const r = yardRoundTrip(def, {
      ops: [{ op: "transform", groups: ["raised"], turn: 2, flip: "x", about: [0, 0] }],
    });
    expect(r.def.groups!.raised).toEqual({ at: [40, 20], rot: 2, flip: true, name: "Raised" });
    const t = about(worldOf({ turn: 2, flip: "x" }), [0, 0]);
    const after = resolveScene(r.def, engine, prefabs).entities!.find(
      (e) => e.id === "post-1/top",
    )!;
    expect(points(after)).toEqual(points(top).map((p) => applyPt(t, p)));
  });

  it("refuses nothing to transform, no turn or flip, an unknown group, an entity, and a group with its member", () => {
    const def = engineYard();
    const bad = (op: SceneOp) => failed(apply(def, { ops: [op] }, { prefabs })).issue;
    expect(bad({ op: "transform", turn: 1 }).code).toBe("op-invalid");
    expect(bad({ op: "transform", refs: ["gate-1"] }).code).toBe("op-invalid");
    const group = bad({ op: "transform", groups: ["raise"], turn: 1 });
    expect(group.code).toBe("ref-not-found");
    expect(group.message).toMatch(/did you mean "raised"/);
    expect(bad({ op: "transform", refs: ["crate"], turn: 1 }).code).toBe("op-invalid");
    expect(bad({ op: "transform", refs: ["post-1"], groups: ["raised"], turn: 1 }).code).toBe(
      "op-invalid",
    );
  });

  it("restores random transform batches exactly", () => {
    const rand = rng(0x7a5f);
    let def = engineYard();
    for (let i = 0; i < 80; i++) {
      const el = ELEMENTS[Math.floor(rand() * ELEMENTS.length)]!;
      const op: SceneOp =
        rand() < 0.5
          ? { op: "transform", refs: [rand() < 0.5 ? "gate-1" : "post-1"], ...el }
          : { op: "transform", groups: ["raised"], ...el, about: [Math.floor(rand() * 200), 0] };
      const r = ok(apply(def, { ops: [op] }, { prefabs }));
      expect(text(ok(apply(r.def, r.inverse, { prefabs })).def)).toBe(text(def));
      def = r.def;
    }
  });
});

describe("applyOps: setGroup, instantiate and unpack with transforms", () => {
  const prefabs = yardPrefabs();

  it("sets rot and flip absolutely, writing 0 and false as absent", () => {
    const r = yardRoundTrip(engineYard(), {
      ops: [{ op: "setGroup", id: "raised", rot: 3, flip: true }],
    });
    expect(r.def.groups!.raised).toEqual({ at: [40, -20], rot: 3, flip: true, name: "Raised" });
    const back = yardRoundTrip(r.def, {
      ops: [{ op: "setGroup", id: "raised", rot: 0, flip: false }],
    });
    expect(back.def.groups!.raised).toEqual({ at: [40, -20], name: "Raised" });
    expect(back.inverse.ops).toEqual([
      { op: "setGroup", id: "raised", at: [40, -20], rot: 3, flip: true, name: "Raised" },
    ]);
    expect(
      failed(apply(engineYard(), { ops: [{ op: "setGroup", id: "raised", remove: true, rot: 1 }] }))
        .issue.code,
    ).toBe("op-invalid");
  });

  it("stores an instance's rot, flip, z and params", () => {
    const r = ok(
      apply(
        engineYard(),
        {
          ops: [
            {
              op: "instantiate",
              instance: {
                id: "gate-2",
                prefab: "gate",
                at: [0, 0],
                rot: 2,
                flip: true,
                z: 3,
                params: { speed: 9 },
              },
            },
          ],
        },
        { prefabs },
      ),
    );
    expect(r.def.instances!.at(-1)).toEqual({
      id: "gate-2",
      prefab: "gate",
      at: [0, 0],
      rot: 2,
      flip: true,
      z: 3,
      params: { speed: 9 },
    });
    expect(text(ok(apply(r.def, r.inverse, { prefabs })).def)).toBe(text(engineYard()));
  });

  it("updates an instance's rot, flip and params, writing 0 and false as absent", () => {
    const r = yardRoundTrip(engineYard(), {
      ops: [{ op: "update", ref: "gate-1", set: { rot: 1, flip: true, "params.speed": 2 } }],
    });
    expect(r.def.instances![0]).toMatchObject({ rot: 1, flip: true, params: { speed: 2 } });
    const off = ok(
      apply(
        r.def,
        {
          ops: [
            { op: "update", ref: "gate-1", set: { rot: 0, flip: false }, unset: ["params.speed"] },
          ],
        },
        { prefabs },
      ),
    );
    expect(off.def.instances![0]).toEqual(engineYard().instances![0]);
  });

  it("bakes a turned, flipped instance into plain entities with the resolved geometry", () => {
    for (const [rot, flip, group] of [
      [1, true, undefined],
      [2, false, undefined],
      [3, true, "raised"],
    ] as const) {
      let def = engineYard();
      def = ok(
        apply(
          def,
          {
            ops: [
              { op: "setGroup", id: "raised", rot: 1 },
              {
                op: "update",
                ref: "gate-1",
                set: { rot, ...(flip ? { flip } : {}), ...(group ? { group } : {}) },
              },
            ],
          },
          { prefabs },
        ),
      ).def;
      const before = resolveScene(def, engine, prefabs).entities!.filter((e) =>
        e.id.startsWith("gate-1/"),
      );
      const r = ok(apply(def, { ops: [{ op: "unpack", ref: "gate-1" }] }, { prefabs }));
      const after = resolveScene(r.def, engine, prefabs);
      const strip = ({ id: _, ...rest }: EntityDef) => rest;
      for (const b of before) {
        const child = b.id.slice("gate-1/".length);
        if (child.startsWith("~")) {
          expect((after.solid as unknown[]).at(-1), `${rot} ${flip} ${child}`).toEqual(b.shape);
          continue;
        }
        const got = strip(after.entities!.find((e) => e.id === child)!);
        expect(got, `${rot} ${flip} ${child}`).toEqual(strip(b));
      }
      expect(text(ok(apply(r.def, r.inverse, { prefabs })).def)).toBe(text(def));
    }
  });
});

describe("applyOps: nested prefabs", () => {
  /** A door, a room holding two doors (one turned, one overridden), and a wing holding a room: three levels. */
  const library = (): PrefabLibrary =>
    prefabLibrary([
      {
        kind: "prefab",
        v: 3,
        id: "door",
        entities: [
          {
            id: "panel",
            type: "follower",
            shape: ["box", 0, 0, 10, 40],
            path: {
              pts: [
                [0, 0],
                [0, -40],
              ],
              mode: "ping_pong",
              speed: 60,
            },
          },
          { id: "knob", type: "marker", at: [8, 20] },
        ],
        bulk: { solid: [["box", 0, 40, 10, 4]] },
      },
      {
        kind: "prefab",
        v: 3,
        id: "room",
        entities: [{ id: "floor", type: "solid", shape: ["box", 0, 60, 100, 10] }],
        instances: [
          { id: "door-1", prefab: "door", at: [10, 0], rot: 1 },
          {
            id: "door-2",
            prefab: "door",
            at: [60, 0],
            z: 2,
            overrides: { "panel.path.speed": 5 },
          },
        ],
      },
      {
        kind: "prefab",
        v: 3,
        id: "wing",
        entities: [],
        instances: [{ id: "room-1", prefab: "room", at: [0, 100] }],
      },
    ]);

  const hall = (): SceneDefinition => ({
    v: 3,
    name: "hall",
    bounds: [0, 0, 2000, 1000],
    groups: { turned: { at: [500, 500], rot: 1 } },
    instances: [{ id: "room-1", prefab: "room", at: [100, 100] }],
    entities: [
      { id: "crate", type: "prop", shape: ["box", 400, 400, 20, 20], density: 1, restitution: 0 },
    ],
  });

  /** The room as its prefab doc reads: a scene named after it. */
  const roomView = (prefabs: PrefabLibrary): SceneDefinition => {
    const room = prefabs.get("room")!;
    return {
      v: 3,
      name: "room",
      bounds: [-500, -500, 1000, 1000],
      entities: structuredClone(room.entities),
      instances: structuredClone(room.instances),
    };
  };

  /** Every resolved entity but its id and group (world geometry is resolved), keyed by the id `rename` maps it to. */
  const resolved = (
    def: SceneDefinition,
    prefabs: PrefabLibrary,
    rename: (id: string) => string = (id) => id,
  ) =>
    new Map(
      (resolveScene(def, engine, prefabs).entities ?? []).map(({ id, group: _, ...rest }) => [
        rename(id),
        rest,
      ]),
    );

  /** Applies `batch`, then its inverse, and checks the scene and the library come back exactly. */
  function nestedRoundTrip(
    def: SceneDefinition,
    batch: OpBatch,
    prefabs: PrefabLibrary,
    opts: { prefab?: string } = {},
  ) {
    const forward = ok(applyOps(def, batch, engine, { prefabs, ...opts }));
    const after = forward.prefabs ?? prefabs;
    const back = ok(applyOps(forward.def, forward.inverse, engine, { prefabs: after, ...opts }));
    expect(text(back.def)).toBe(text(def));
    expect(formatPrefabs(back.prefabs ?? after)).toEqual(formatPrefabs(prefabs));
    return forward;
  }

  it("instantiates in a prefab's view, and refuses an instance that would make a cycle", () => {
    const prefabs = library();
    const view = roomView(prefabs);
    const r = nestedRoundTrip(
      view,
      { ops: [{ op: "instantiate", instance: { id: "door-3", prefab: "door", at: [90, 0] } }] },
      prefabs,
      { prefab: "room" },
    );
    expect(r.def.instances!.map((n) => n.id)).toEqual(["door-1", "door-2", "door-3"]);

    for (const prefab of ["room", "wing"]) {
      const refused = failed(
        applyOps(view, { ops: [{ op: "instantiate", instance: { prefab, at: [0, 0] } }] }, engine, {
          prefabs,
          prefab: "room",
        }),
      );
      expect(refused.issue.code, prefab).toBe("prefab-cycle");
      expect(refused.failedAt).toBe(0);
      expect(refused.issue.path).toBe("/ops/0");
    }
    const swapped = failed(
      applyOps(view, { ops: [{ op: "update", ref: "door-1", set: { prefab: "wing" } }] }, engine, {
        prefabs,
        prefab: "room",
      }),
    );
    expect(swapped.issue.code).toBe("prefab-cycle");
    expect(swapped.issue.message).toContain("room → wing → room");

    // A scene holds no prefab, so the same instance is fine there.
    ok(
      applyOps(
        hall(),
        { ops: [{ op: "instantiate", instance: { prefab: "wing", at: [0, 0] } }] },
        engine,
        {
          prefabs,
        },
      ),
    );
  });

  it("refuses a prefab body that contains itself", () => {
    const prefabs = library();
    const refused = failed(
      applyOps(
        hall(),
        {
          ops: [
            {
              op: "definePrefab",
              id: "door",
              prefab: { entities: [], instances: [{ id: "wing-1", prefab: "wing", at: [0, 0] }] },
            },
          ],
        },
        engine,
        { prefabs },
      ),
    );
    expect(refused.issue.code).toBe("prefab-cycle");
  });

  it("defines a prefab with nested instances, with an exact inverse", () => {
    const prefabs = library();
    const r = nestedRoundTrip(
      hall(),
      {
        ops: [
          {
            op: "definePrefab",
            id: "room",
            prefab: {
              entities: [],
              instances: [{ id: "door-9", prefab: "door", at: [0, 0], flip: true }],
            },
          },
        ],
      },
      prefabs,
    );
    expect(r.prefabs!.get("room")!.instances).toEqual([
      { id: "door-9", prefab: "door", at: [0, 0], flip: true },
    ]);
    expect(r.touched).toContain("room-1");
  });

  it("overrides a nested child and a nested instance's own fields", () => {
    const prefabs = library();
    const r = nestedRoundTrip(
      hall(),
      {
        ops: [
          {
            op: "override",
            ref: "room-1",
            set: {
              "door-1/panel.path.speed": 9,
              "door-2.at": [70, 0],
              "door-2.rot": 2,
              "door-1/~solid:0.shape": ["box", 0, 40, 10, 8],
            },
          },
        ],
      },
      prefabs,
    );
    const view = resolveScene(r.def, engine, prefabs).entities!;
    const byId = (id: string) => view.find((e) => e.id === id)!;
    expect(byId("room-1/door-1/panel").path).toMatchObject({ speed: 9 });
    expect(byId("room-1/door-2/knob").at).toEqual([100 + 70 - 8, 100 + 0 - 20]);

    const bad = (set: Record<string, unknown>) =>
      failed(
        applyOps(hall(), { ops: [{ op: "override", ref: "room-1", set }] }, engine, { prefabs }),
      ).issue;
    expect(bad({ "door-1.prefab": "wing" }).code).toBe("op-invalid");
    expect(bad({ "door-1.rot": 7 }).code).toBe("schema");
    expect(bad({ "door-1/panel.path.speed": "fast" }).code).toBe("schema");
  });

  it("applies overrides to the instance's own prefab: a nested child's lands on the nested instance", () => {
    const prefabs = library();
    const def = ok(
      applyOps(
        hall(),
        {
          ops: [
            {
              op: "override",
              ref: "room-1",
              set: { "door-1/panel.path.speed": 9, "door-2.z": 4, "floor.oneWay": true },
            },
          ],
        },
        engine,
        { prefabs },
      ),
    ).def;
    const before = resolved(def, prefabs);
    const r = nestedRoundTrip(def, { ops: [{ op: "applyToPrefab", ref: "room-1" }] }, prefabs);
    const room = r.prefabs!.get("room")!;
    expect(room.entities[0]).toMatchObject({ id: "floor", oneWay: true });
    expect(room.instances![0]!.overrides).toEqual({ "panel.path.speed": 9 });
    expect(room.instances![1]!.z).toBe(4);
    expect(r.prefabs!.get("door")).toEqual(prefabs.get("door"));
    expect(r.def.instances![0]!.overrides).toBeUndefined();
    expect(resolved(r.def, r.prefabs!)).toEqual(before);
  });

  it("applies overrides to a deeper prefab named by to", () => {
    const prefabs = library();
    const def: SceneDefinition = {
      ...hall(),
      instances: [
        {
          id: "wing-1",
          prefab: "wing",
          at: [0, 0],
          overrides: {
            "room-1/door-1/panel.path.speed": 9,
            "room-1/door-1/knob.at": [6, 20],
            "room-1/door-2/panel.path.speed": 7,
          },
        },
      ],
    };
    const before = resolved(def, prefabs);

    const toDoor = nestedRoundTrip(
      def,
      {
        ops: [
          {
            op: "applyToPrefab",
            ref: "wing-1",
            paths: ["room-1/door-1/panel.path.speed", "room-1/door-1/knob.at"],
            to: "door",
          },
        ],
      },
      prefabs,
    );
    expect(toDoor.prefabsChanged).toEqual(["door"]);
    const door = toDoor.prefabs!.get("door")!;
    expect(door.entities[0]!.path).toMatchObject({ speed: 9 });
    expect(door.entities[1]).toEqual({ id: "knob", type: "marker", at: [6, 20] });
    expect(toDoor.def.instances![0]!.overrides).toEqual({ "room-1/door-2/panel.path.speed": 7 });
    const after = resolved(toDoor.def, toDoor.prefabs!);
    for (const [id, e] of before) {
      // door-2 has no knob override, so its knob follows the door prefab's.
      if (id === "wing-1/room-1/door-2/knob") expect(after.get(id)).not.toEqual(e);
      else expect(after.get(id), id).toEqual(e);
    }

    const toRoom = nestedRoundTrip(
      def,
      {
        ops: [
          {
            op: "applyToPrefab",
            ref: "wing-1",
            paths: ["room-1/door-1/panel.path.speed"],
            to: "room",
          },
        ],
      },
      prefabs,
    );
    expect(toRoom.prefabsChanged).toEqual(["room"]);
    expect(toRoom.prefabs!.get("room")!.instances![0]!.overrides).toEqual({
      "panel.path.speed": 9,
    });

    const refuse = (paths: string[], to: string) =>
      failed(
        applyOps(def, { ops: [{ op: "applyToPrefab", ref: "wing-1", paths, to }] }, engine, {
          prefabs,
        }),
      ).issue;
    const unreached = refuse(["room-1/door-1/panel.path.speed"], "post");
    expect(unreached.code).toBe("op-invalid");
    expect(unreached.message).toContain('"wing", "room", "door"');
    // room's door-2 overrides the same field, so writing it into door wouldn't show.
    const hidden = refuse(["room-1/door-2/panel.path.speed"], "door");
    expect(hidden.code).toBe("op-invalid");
    expect(hidden.message).toContain('apply it to "room"');
  });

  it("unpacks one level: the nested instances become instances, their transforms baked", () => {
    const prefabs = library();
    for (const [extra, label] of [
      [{}, "plain"],
      [{ rot: 1, flip: true, z: 3, layer: "front", group: "turned" }, "turned, flipped, grouped"],
      [{ overrides: { "door-1.at": [20, 0], "door-2/panel.path.speed": 1 } }, "overridden"],
    ] as const) {
      const def: SceneDefinition = {
        ...hall(),
        instances: [{ id: "room-1", prefab: "room", at: [100, 100], ...extra }],
        entities: [...hall().entities!, { id: "door-1", type: "marker", at: [0, 0] }],
      };
      const before = resolved(def, prefabs, (id) => id.replace(/^room-1\//, ""));
      const r = nestedRoundTrip(def, { ops: [{ op: "unpack", ref: "room-1" }] }, prefabs);
      expect(
        r.def.instances!.map((n) => [n.id, n.prefab]),
        label,
      ).toEqual([
        ["door-2", "door"],
        ["door-3", "door"],
      ]);
      const renamed = (id: string) =>
        id.replace(/^door-2\//, "door-1/").replace(/^door-3\//, "door-2/");
      expect(resolved(r.def, prefabs, renamed), label).toEqual(before);
      expect(
        r.def.entities!.map((e) => e.id),
        label,
      ).toContain("floor");
    }
  });

  it("creates a prefab from entities and instances, the instances nested in it", () => {
    const prefabs = library();
    const def: SceneDefinition = {
      ...hall(),
      instances: [
        { id: "room-1", prefab: "room", at: [100, 100] },
        { id: "room-2", prefab: "room", at: [100, 300], rot: 2, group: "turned" },
      ],
    };
    const before = resolved(def, prefabs);
    const r = nestedRoundTrip(
      def,
      { ops: [{ op: "createPrefab", refs: ["room-1", "room-2", "crate"], id: "block" }] },
      prefabs,
    );
    const block = r.prefabs!.get("block")!;
    expect(r.def.instances).toEqual([{ id: "block-1", prefab: "block", at: [100, 100] }]);
    expect(block.instances).toEqual([
      { id: "room-1", prefab: "room", at: [0, 0] },
      { id: "room-2", prefab: "room", at: [100, 500], rot: 3 },
    ]);
    expect(resolved(r.def, r.prefabs!, (id) => id.replace(/^block-1\//, ""))).toEqual(before);
  });
});

describe("applyOps: prefab header and params", () => {
  const speed = {
    description: "How fast the panel slides.",
    targets: ["panel.path.speed"],
    default: 60,
  };
  const library = (): PrefabLibrary =>
    prefabLibrary([
      {
        kind: "prefab",
        v: 3,
        id: "door",
        entities: [
          {
            id: "panel",
            type: "follower",
            shape: ["box", 0, 0, 10, 40],
            path: {
              pts: [
                [0, 0],
                [0, -40],
              ],
              mode: "ping_pong",
              speed: 60,
            },
          },
          { id: "knob", type: "marker", at: [8, 20] },
        ],
        bulk: { solid: [["box", 0, 40, 10, 4]] },
        params: { speed },
      },
      {
        kind: "prefab",
        v: 3,
        id: "red-door",
        base: "door",
        entities: [{ id: "lamp", type: "marker", at: [0, -10] }],
      },
      {
        kind: "prefab",
        v: 3,
        id: "room",
        entities: [{ id: "floor", type: "solid", shape: ["box", 0, 60, 100, 10] }],
        instances: [{ id: "door-1", prefab: "door", at: [10, 0] }],
      },
    ]);

  /** A prefab as its doc reads: a scene of its children, named after it. */
  const viewOf = (prefabs: PrefabLibrary, id: string): SceneDefinition => {
    const p = prefabs.get(id)!;
    return {
      v: 3,
      name: id,
      bounds: [-500, -500, 1000, 1000],
      ...structuredClone(p.bulk ?? {}),
      ...(p.instances ? { instances: structuredClone(p.instances) } : {}),
      entities: structuredClone(p.entities),
    };
  };

  const hall = (extra: Partial<InstanceDef> = {}): SceneDefinition => ({
    v: 3,
    name: "hall",
    bounds: [0, 0, 2000, 1000],
    instances: [{ id: "door-1", prefab: "door", at: [100, 100], ...extra }],
    entities: [{ id: "spot", type: "marker", at: [5, 5] }],
  });

  /** Applies `batch` and its inverse, checking the document and the library come back exactly. */
  function headerRoundTrip(
    def: SceneDefinition,
    batch: OpBatch,
    prefabs: PrefabLibrary,
    opts: { prefab?: string } = {},
  ) {
    const forward = ok(applyOps(def, batch, engine, { prefabs, ...opts }));
    const after = forward.prefabs ?? prefabs;
    const back = ok(applyOps(forward.def, forward.inverse, engine, { prefabs: after, ...opts }));
    expect(text(back.def)).toBe(text(def));
    expect(formatPrefabs(back.prefabs ?? after)).toEqual(formatPrefabs(prefabs));
    const again = ok(
      applyOps(back.def, back.inverse, engine, { prefabs: back.prefabs ?? after, ...opts }),
    );
    expect(text(again.def)).toBe(text(forward.def));
    expect(formatPrefabs(again.prefabs ?? back.prefabs ?? after)).toEqual(formatPrefabs(after));
    return forward;
  }

  it("refuses the header ops on a scene", () => {
    const prefabs = library();
    for (const op of [
      { op: "setPrefabBase", base: "door" },
      { op: "setPrefabBase", base: null },
      { op: "exposeParam", name: "speed", param: speed },
      { op: "exposeParam", name: "speed", param: null },
      { op: "override", set: { "panel.path.speed": 9 } },
      { op: "revertOverride" },
    ] satisfies SceneOp[]) {
      const refused = failed(applyOps(hall(), { ops: [op] }, engine, { prefabs }));
      expect(refused.issue.code, op.op).toBe("op-invalid");
      expect(refused.issue.message).toContain("prefab's document");
      expect(refused.failedAt).toBe(0);
    }
  });

  it("sets and clears a prefab's base on its view, with an exact inverse", () => {
    const prefabs = library();
    const view = viewOf(prefabs, "room");
    const r = headerRoundTrip(view, { ops: [{ op: "setPrefabBase", base: "door" }] }, prefabs, {
      prefab: "room",
    });
    expect(r.prefabsChanged).toEqual(["room"]);
    expect(r.prefabs!.get("room")).toEqual({ ...prefabs.get("room"), base: "door" });
    expect(r.inverse.ops).toEqual([{ op: "setPrefabBase", base: null }]);
    expect(text(r.def)).toBe(text(view));

    const variant = viewOf(prefabs, "red-door");
    const cleared = headerRoundTrip(
      variant,
      { ops: [{ op: "setPrefabBase", base: null }] },
      prefabs,
      { prefab: "red-door" },
    );
    expect(cleared.prefabs!.get("red-door")!.base).toBeUndefined();
    expect(cleared.inverse.ops).toEqual([{ op: "setPrefabBase", base: "door" }]);
  });

  it("refuses an unknown base, the prefab itself, and a base that contains the prefab", () => {
    const prefabs = library();
    const set = (id: string, base: string) =>
      failed(
        applyOps(viewOf(prefabs, id), { ops: [{ op: "setPrefabBase", base }] }, engine, {
          prefabs,
          prefab: id,
        }),
      ).issue;
    const unknown = set("room", "dor");
    expect(unknown.code).toBe("variant-base-unknown");
    expect(unknown.message).toContain('did you mean "door"');
    expect(unknown.path).toBe("/ops/0/base");
    const itself = set("room", "room");
    expect([itself.code, itself.path]).toEqual(["prefab-cycle", "/ops/0/base"]);
    const through = set("door", "room");
    expect([through.code, through.path]).toEqual(["prefab-cycle", "/ops/0/base"]);
    expect(through.message).toContain('Prefab "door" would contain itself: door → room');
  });

  it("declares, replaces and removes params on a prefab's view, with exact inverses", () => {
    const prefabs = library();
    const view = viewOf(prefabs, "door");
    const knob = { description: "Where the knob sits.", targets: ["knob.at"] };
    const r = headerRoundTrip(
      view,
      {
        ops: [
          { op: "exposeParam", name: "knob", param: knob },
          { op: "exposeParam", name: "speed", param: { ...speed, default: 30 } },
        ],
      },
      prefabs,
      { prefab: "door" },
    );
    expect(r.prefabs!.get("door")!.params).toEqual({ knob, speed: { ...speed, default: 30 } });
    expect(r.inverse.ops).toEqual([
      { op: "exposeParam", name: "knob", param: null },
      { op: "exposeParam", name: "speed", param: speed },
    ]);

    const removed = headerRoundTrip(
      view,
      { ops: [{ op: "exposeParam", name: "speed", param: null }] },
      prefabs,
      { prefab: "door" },
    );
    expect(removed.prefabs!.get("door")!.params).toBeUndefined();

    const missing = failed(
      applyOps(view, { ops: [{ op: "exposeParam", name: "sped", param: null }] }, engine, {
        prefabs,
        prefab: "door",
      }),
    ).issue;
    expect(missing.code).toBe("op-invalid");
    expect(missing.path).toBe("/ops/0/name");
    expect(missing.message).toContain('did you mean "speed"');
  });

  it("sets and drops a variant's own overrides with no ref, with exact inverses", () => {
    const prefabs = prefabLibrary([
      ...library().values(),
      {
        kind: "prefab",
        v: 3,
        id: "blue-door",
        base: "door",
        entities: [],
        overrides: { "panel.path.speed": 20, "knob.at": [1, 1] },
      },
    ]);
    const view = viewOf(prefabs, "blue-door");
    const set = headerRoundTrip(
      view,
      { ops: [{ op: "override", set: { "panel.path": { mode: "loop" }, "lamp.at": [2, 2] } }] },
      prefabs,
      { prefab: "blue-door" },
    );
    expect(set.prefabs!.get("blue-door")!.overrides).toEqual({
      "knob.at": [1, 1],
      "panel.path": { mode: "loop" },
      "lamp.at": [2, 2],
    });
    expect(set.inverse.ops).toEqual([
      { op: "revertOverride", paths: ["lamp.at", "panel.path"] },
      { op: "override", set: { "panel.path.speed": 20 } },
    ]);

    const dropped = headerRoundTrip(
      view,
      { ops: [{ op: "revertOverride", paths: ["panel.path"] }] },
      prefabs,
      { prefab: "blue-door" },
    );
    expect(dropped.prefabs!.get("blue-door")!.overrides).toEqual({ "knob.at": [1, 1] });
    const all = headerRoundTrip(view, { ops: [{ op: "revertOverride" }] }, prefabs, {
      prefab: "blue-door",
    });
    expect(all.prefabs!.get("blue-door")!.overrides).toBeUndefined();
    expect(all.prefabs!.get("blue-door")!.base).toBe("door");

    const empty = failed(
      applyOps(view, { ops: [{ op: "override", set: {} }] }, engine, {
        prefabs,
        prefab: "blue-door",
      }),
    ).issue;
    expect([empty.code, empty.path]).toEqual(["op-invalid", "/ops/0/set"]);
  });

  it("keeps the view's own edits in the prefab a header op reports", () => {
    const prefabs = library();
    const r = headerRoundTrip(
      viewOf(prefabs, "door"),
      {
        ops: [
          { op: "add", entity: { id: "hinge", type: "marker", at: [0, 0] } },
          { op: "useAssets", add: ["tiles"] },
          { op: "exposeParam", name: "speed", param: null },
        ],
      },
      prefabs,
      { prefab: "door" },
    );
    const door = r.prefabs!.get("door")!;
    expect(door.entities.map((e) => e.id)).toEqual(["panel", "knob", "hinge"]);
    expect(door.bulk).toEqual(prefabs.get("door")!.bulk);
    expect(door.assets).toEqual(["tiles"]);

    // Without a header op the viewed prefab isn't reported, as before.
    const plain = ok(
      applyOps(
        viewOf(prefabs, "door"),
        { ops: [{ op: "add", entity: { id: "hinge", type: "marker", at: [0, 0] } }] },
        engine,
        { prefabs, prefab: "door" },
      ),
    );
    expect(plain.prefabsChanged).toBeUndefined();
  });

  it("sets and clears an instance's param with setParam, the inverse one setParam per param", () => {
    const prefabs = library();
    const set = headerRoundTrip(
      hall(),
      { ops: [{ op: "setParam", ref: "door-1", name: "speed", value: 9 }] },
      prefabs,
    );
    expect(set.def.instances![0]!.params).toEqual({ speed: 9 });
    expect(set.inverse.ops).toEqual([
      { op: "setParam", ref: "door-1", name: "speed", value: null },
    ]);
    expect(set.touched).toEqual(["door-1"]);
    const panel = resolveScene(set.def, engine, prefabs).entities!.find(
      (e) => e.id === "door-1/panel",
    );
    expect(panel).toBeDefined();

    const cleared = headerRoundTrip(
      hall({ params: { speed: 9 } }),
      { ops: [{ op: "setParam", ref: "door-1", name: "speed", value: null }] },
      prefabs,
    );
    expect(cleared.def.instances![0]!.params).toBeUndefined();
    expect(cleared.inverse.ops).toEqual([
      { op: "setParam", ref: "door-1", name: "speed", value: 9 },
    ]);

    // It works inside a prefab's view too, on a nested instance.
    const nested = headerRoundTrip(
      viewOf(prefabs, "room"),
      { ops: [{ op: "setParam", ref: "door-1", name: "speed", value: 12 }] },
      prefabs,
      { prefab: "room" },
    );
    expect(nested.def.instances![0]!.params).toEqual({ speed: 12 });
    expect(nested.prefabsChanged).toBeUndefined();
  });

  it("checks a param's value against its targets and refuses a ref that isn't an instance", () => {
    const prefabs = library();
    const run = (ops: SceneOp[]) => applyOps(hall(), { ops }, engine, { prefabs });
    const bad = failed(run([{ op: "setParam", ref: "door-1", name: "speed", value: "fast" }]));
    expect(bad.issue.code).toBe("schema");
    expect(bad.issue.path).toBe("/ops/0/value");
    // An override of the same target beats the param, so its value is the one that stands.
    ok(
      applyOps(
        hall({ overrides: { "panel.path.speed": 5 } }),
        { ops: [{ op: "setParam", ref: "door-1", name: "speed", value: 7 }] },
        engine,
        { prefabs },
      ),
    );
    expect(failed(run([{ op: "setParam", ref: "spot", name: "speed", value: 1 }])).issue.code).toBe(
      "op-invalid",
    );
    expect(failed(run([{ op: "setParam", ref: "nope", name: "speed", value: 1 }])).issue.code).toBe(
      "ref-not-found",
    );
    // A param the prefab doesn't expose is left to validation (param-unknown), so its fix applies.
    const unknown = ok(run([{ op: "setParam", ref: "door-1", name: "colour", value: "red" }]));
    expect(unknown.def.instances![0]!.params).toEqual({ colour: "red" });
  });

  it("sets params.<name> through update, null clearing it, with an exact inverse", () => {
    const prefabs = library();
    const set = headerRoundTrip(
      hall({ params: { colour: "red" } }),
      { ops: [{ op: "update", ref: "door-1", set: { "params.speed": 4, "params.colour": null } }] },
      prefabs,
    );
    expect(set.def.instances![0]!.params).toEqual({ speed: 4 });
    expect(set.inverse.ops).toEqual([
      { op: "setParam", ref: "door-1", name: "colour", value: "red" },
      { op: "setParam", ref: "door-1", name: "speed", value: null },
    ]);
    const bad = failed(
      applyOps(
        hall(),
        { ops: [{ op: "update", ref: "door-1", set: { "params.speed": "x" } }] },
        engine,
        {
          prefabs,
        },
      ),
    );
    expect(bad.issue.code).toBe("schema");
  });
});

/** Ops randomOp draws only with its `v3` option (the convergence fuzz), or never: the header ops need a prefab view. */
const NOT_GENERATED: readonly string[] = [
  "transform",
  "setZ",
  "useAssets",
  "paintCells",
  "setPrefabBase",
  "exposeParam",
  "setParam",
];

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
      expect([...kinds].sort()).toEqual(
        OP_NAMES.filter((name) => !NOT_GENERATED.includes(name)).sort(),
      );
    }, 30_000);
  }
});

describe("applyOps: place an instance", () => {
  const prefabs = prefabLibrary([
    {
      kind: "prefab",
      v: 3,
      id: "ell",
      entities: [
        { id: "arm", type: "solid", shape: ["box", 0, 0, 100, 10] },
        { id: "leg", type: "solid", shape: ["box", 90, 10, 10, 30] },
      ],
    },
    { kind: "prefab", v: 3, id: "ell-red", base: "ell", entities: [] },
  ]);
  const scene = (inst: Partial<InstanceDef>): SceneDefinition => ({
    v: 3,
    name: "place",
    bounds: [-1000, -1000, 1000, 1000],
    instances: [{ id: "x", prefab: "ell", at: [7, 3], ...inst }],
  });
  /** The world box around the resolved children of instance `x`. */
  const worldBox = (def: SceneDefinition) =>
    resolveScene(def, engine, prefabs)
      .entities!.filter((e) => e.id.startsWith("x/"))
      .map((e) => {
        const parsed = parseShape(e.shape as never);
        if (!parsed.ok) throw new Error(parsed.issue.message);
        return aabb(parsed.shape);
      })
      .reduce((a, b) => ({
        minX: Math.min(a.minX, b.minX),
        minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX),
        maxY: Math.max(a.maxY, b.maxY),
      }));
  const anchorOf = (def: SceneDefinition, anchor: string): Pt => {
    const b = worldBox(def);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    if (anchor === "top") return [cx, b.minY];
    if (anchor === "bottom") return [cx, b.maxY];
    if (anchor === "left") return [b.minX, cy];
    if (anchor === "right") return [b.maxX, cy];
    return [cx, cy];
  };

  const ORIENTATIONS: Partial<InstanceDef>[] = [
    {},
    { rot: 1 },
    { rot: 2 },
    { flip: true },
    { rot: 3, flip: true },
    { prefab: "ell-red" },
    { prefab: "ell-red", rot: 1, flip: true },
  ];
  for (const inst of ORIENTATIONS)
    for (const anchor of ["top", "bottom", "left", "right", "center"] as const)
      it(`puts the ${anchor} of a ${JSON.stringify(inst)} instance on the point`, () => {
        const def = scene(inst);
        const r = ok(
          apply(def, based(def, [{ op: "place", ref: "x", at: [200, 300], anchor }]), { prefabs }),
        );
        expect(anchorOf(r.def, anchor)).toEqual([200, 300]);
        expect(text(ok(apply(r.def, r.inverse, { prefabs })).def)).toBe(text(def));
      });
});

describe("applyOps: assets and sprites against the project", () => {
  const entry = (id: string, kind: string, extra: Partial<AssetEntry> = {}): AssetEntry => ({
    key: `k-${id}`,
    id,
    kind,
    path: `${id}.${kind}`,
    created: { at: 0, by: "t" },
    ...extra,
  });
  const project = projectView({
    meta: { projectId: "p", layout: 2, name: "P" },
    assets: Object.fromEntries(
      [
        entry("crate", "texture", {
          sha256: "a".repeat(64),
          meta: { format: "png", width: 32, height: 32 },
        }),
        entry("hero", "atlas", {
          sha256: "b".repeat(64),
          meta: {
            tool: "aseprite",
            frames: { "idle-0": { x: 0, y: 0, w: 16, h: 16 } },
            tags: [],
            slices: [],
            order: ["idle-0"],
          },
          import: { texture: "crate" },
        }),
        entry("boom", "sound"),
      ].map((e) => [e.key, e]),
    ),
    history: {},
    code: {},
    build: {},
  });
  const def: SceneDefinition = {
    v: 1,
    name: "t",
    bounds: [0, 0, 1000, 1000],
    entities: [{ id: "pic", type: "marker", at: [10, 10] }],
  };
  const withSprite = (sprite: Record<string, unknown>): OpBatch => ({
    ops: [{ op: "update", ref: "pic", set: { "behaviors.sprite": sprite } }],
  });
  const codes = (sprite: Record<string, unknown>, opts: ApplyOptions) =>
    ok(apply(def, withSprite(sprite), opts)).issues.map((i) => [i.code, i.severity]);

  it("reports each asset code with the project", () => {
    expect(codes({ asset: "nope" }, { project })).toEqual([["asset-missing", "error"]]);
    expect(codes({ asset: "boom" }, { project })).toEqual([["asset-kind", "error"]]);
    expect(codes({ asset: "hero", frame: "idle-9" }, { project })).toEqual([
      ["asset-frame-unknown", "error"],
    ]);
    expect(codes({ alpha: 0.5 }, { project })).toEqual([["sprite-no-asset", "warn"]]);
    expect(codes({ asset: "hero", frame: "idle-0" }, { project })).toEqual([]);
  });

  it("checks no asset ids without one", () => {
    for (const sprite of [
      { asset: "nope" },
      { asset: "boom" },
      { asset: "hero", frame: "idle-9" },
      { alpha: 0.5 },
    ])
      expect(codes(sprite, {})).toEqual([]);
  });
});

describe("spawn-only types in ops", () => {
  const ember = defineEntityType({
    type: "ember",
    description: "A spark game code makes.",
    base: "marker",
    spawnOnly: true,
    fields: { at: pointField("Where it glows.") },
  });
  const spawned = createRegistry({ ...testGame, types: [...testGame.types, ember] });
  const yard = (): SceneDefinition => ({ ...gameYard(), entities: [] });

  it("an add naming one fails with unknown-type, spawned by game code only", () => {
    const r = failed(
      applyOps(yard(), { ops: [{ op: "add", entity: { type: "ember", at: [0, 0] } }] }, spawned),
    );
    expect(r.issue.code).toBe("unknown-type");
    expect(r.issue.got).toMatch(/^"?ember"?$/);
    expect(r.issue.message).toContain("spawned by game code only");
    expect(r.issue.expected!.split(" | ")).not.toContain("ember");
    expect(r.issue.expected!.split(" | ")).toContain("lamp");
  });

  it("an add's did-you-mean never names one", () => {
    const r = failed(
      applyOps(yard(), { ops: [{ op: "add", entity: { type: "embr", at: [0, 0] } }] }, spawned),
    );
    expect(r.issue.code).toBe("unknown-type");
    expect(r.issue.message).not.toContain("ember");
    expect(r.issue.hint ?? "").not.toContain("ember");
  });
});
