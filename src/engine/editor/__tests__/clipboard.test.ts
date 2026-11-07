import { describe, expect, it } from "vite-plus/test";

import { fake } from "../../scene/__tests__/fixtures/fake-game";
import { applyOps } from "../../scene/ops";
import type { OpBatch, SceneDefinition } from "../../scene/types";
import {
  copySelection,
  cutSelection,
  duplicateSelection,
  nextFreeId,
  pasteFragment,
} from "../clipboard";
import { DEFAULT_SNAP } from "../tools";

const scene = (over: Partial<SceneDefinition> = {}): SceneDefinition => ({
  v: 2,
  game: "fake",
  name: "c",
  bounds: [0, 0, 2000, 2000],
  ...over,
});

const def = scene({
  solid: [["box", 100, 100, 50, 10]],
  flag: [[10, 10]],
  entities: [
    { id: "door", type: "door", shape: ["box", 500, 500, 10, 40], opens: "btn", speed: 60 },
    { id: "btn", type: "button", shape: ["box", 400, 540, 10, 4] },
  ],
});

const apply = (to: SceneDefinition, batch: OpBatch) => {
  const r = applyOps(to, batch, fake);
  if (!r.ok) throw new Error(r.issue.message);
  return r;
};

describe("copySelection", () => {
  it("writes the fragment as pretty JSON text", () => {
    const text = copySelection(def, ["btn"], fake);
    expect(text).toContain('\n  "kind": "scene-fragment"');
    expect(JSON.parse(text)).toEqual({
      kind: "scene-fragment",
      v: 2,
      game: "fake",
      entities: [def.entities![1]],
    });
  });
});

describe("pasteFragment", () => {
  it("round-trips a selection into another scene in one batch", () => {
    const text = copySelection(def, ["door", "btn", "~solid:0", "~flag:0"], fake);
    const target = scene({ solid: [["box", 0, 0, 5, 5]] });
    const r = pasteFragment(text, { def: target, registry: fake });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.issues).toEqual([]);
    expect(r.batch.ops.map((o) => o.op)).toEqual(["addBulk", "addBulk", "add", "add"]);
    expect(r.select).toEqual(["~flag:0", "~solid:1", "door", "btn"]);
    const after = apply(target, r.batch).def;
    expect(after.entities).toEqual(def.entities);
    expect(after.solid).toEqual([
      ["box", 0, 0, 5, 5],
      ["box", 100, 100, 50, 10],
    ]);
    expect(after.flag).toEqual([[10, 10]]);
  });

  it("centres the fragment under the cursor, moving by whole grid steps", () => {
    const text = copySelection(def, ["btn"], fake);
    const r = pasteFragment(text, {
      def: scene(),
      registry: fake,
      at: [1000, 1000],
      snap: DEFAULT_SNAP,
    });
    if (!r.ok) throw new Error();
    // The button's box centre (400, 540) moves by (600, 460), rounded to 64s: (576, 448).
    expect(r.batch.ops).toEqual([
      { op: "add", entity: { id: "btn", type: "button", shape: ["box", 976, 988, 10, 4] } },
    ]);
    const unsnapped = pasteFragment(text, { def: scene(), registry: fake, at: [1000.4, 1000] });
    expect(unsnapped.ok && unsnapped.batch.ops[0]).toMatchObject({
      entity: { shape: ["box", 1000, 1000, 10, 4] },
    });
  });

  it("renames clashing ids and remaps references inside the fragment", () => {
    const r = duplicateSelection(def, ["door", "btn"], fake, 64);
    if (!r.ok) throw new Error();
    expect(r.batch.label).toBe("Duplicate");
    expect(r.select).toEqual(["door-2", "btn-2"]);
    expect(r.batch.ops).toEqual([
      {
        op: "add",
        entity: {
          id: "door-2",
          type: "door",
          shape: ["box", 564, 564, 10, 40],
          opens: "btn-2",
          speed: 60,
        },
      },
      { op: "add", entity: { id: "btn-2", type: "button", shape: ["box", 464, 604, 10, 4] } },
    ]);
    expect(apply(def, r.batch).def.entities!.map((e) => e.id)).toEqual([
      "door",
      "btn",
      "door-2",
      "btn-2",
    ]);
  });

  it("keeps a reference out of the fragment when its target exists here", () => {
    const r = duplicateSelection(def, ["door"], fake, 16);
    expect(r.ok && r.issues).toEqual([]);
    expect(r.ok && r.batch.ops[0]).toMatchObject({ entity: { id: "door-2", opens: "btn" } });
  });

  it("clears a reference whose target isn't here, with a warning", () => {
    const text = copySelection(def, ["door"], fake);
    const r = pasteFragment(text, { def: scene(), registry: fake });
    if (!r.ok) throw new Error();
    expect(r.batch.ops[0]).toEqual({
      op: "add",
      entity: { id: "door", type: "door", shape: ["box", 500, 500, 10, 40], speed: 60 },
    });
    expect(r.issues).toMatchObject([
      { code: "dangling-ref", severity: "warn", path: "/ops/0/entity/opens", entityIds: ["door"] },
    ]);
  });

  it("refuses text that isn't a fragment, or an empty one", () => {
    expect(pasteFragment("hello", { def, registry: fake }).ok).toBe(false);
    const empty = JSON.stringify({ kind: "scene-fragment", v: 1, entities: [] });
    expect(pasteFragment(empty, { def, registry: fake }).ok).toBe(false);
  });
});

describe("cutSelection", () => {
  it("copies the selection and removes it in one batch", () => {
    const { text, batch } = cutSelection(def, ["btn", "~solid:0"], fake);
    expect(JSON.parse(text).entities).toEqual([def.entities![1]]);
    const after = apply(def, batch).def;
    expect(after.entities!.map((e) => e.id)).toEqual(["door"]);
    expect(after.solid ?? []).toEqual([]);
  });
});

describe("nextFreeId", () => {
  it("counts up from the id's own suffix", () => {
    expect(nextFreeId("lift", new Set())).toBe("lift");
    expect(nextFreeId("lift", new Set(["lift"]))).toBe("lift-2");
    expect(nextFreeId("lift", new Set(["lift", "lift-2"]))).toBe("lift-3");
    expect(nextFreeId("lift-2", new Set(["lift-2"]))).toBe("lift-3");
    const long = "a".repeat(48);
    expect(nextFreeId(long, new Set([long]))).toBe(`${"a".repeat(46)}-2`);
  });
});
