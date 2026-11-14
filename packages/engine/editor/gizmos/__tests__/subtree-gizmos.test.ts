import { describe, expect, it } from "vite-plus/test";

import { applyOps } from "../../../scene/ops";
import type { EntityDef, Pt } from "../../../scene/types";
import { DEFAULT_SNAP } from "../../tools";
import { dragHandle, moveTarget } from "../drag";
import type { DragOptions } from "../edit";
import { dragSelection, rootTargets, rotateTargetsBatch } from "../multi";
import { gizmoTarget } from "../target";
import { editTree, enclosingInstances } from "../tree";
import { commit, doc, previewed, registry, source, view, viewOf } from "./tree-fixture";

const opts: DragOptions = {
  mods: { shift: false, alt: false, mod: false },
  snap: { ...DEFAULT_SNAP, enabled: false },
  scale: 100,
  pxPerMetre: 50,
};

const entity = (def: { entities?: EntityDef[] }, id: string) =>
  def.entities!.find((e) => e.id === id)!;

/** The view entities' geometry, by id, rounded so float noise from a turn compares equal. */
function geometry(def: { entities?: EntityDef[] }, ids: readonly string[]) {
  const round = (v: unknown): unknown =>
    typeof v === "number"
      ? Math.round(v * 1e4) / 1e4 + 0
      : Array.isArray(v)
        ? v.map(round)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
          : v;
  return Object.fromEntries(
    ids.map((id) => {
      const e = entity(def, id);
      return [id, round({ shape: e.shape, at: e.at, rot: e.rot ?? 0 })];
    }),
  );
}

describe("the view's tree", () => {
  it("finds what sits under a node, an instance and an instance's child", () => {
    const tree = editTree(view, source);
    expect(tree.instances()).toEqual(["turret-a", "tilt-turret"]);
    expect(tree.below(["tilt"])).toEqual([
      "tilt-board",
      "tilt-mark",
      "tilt-turret/base",
      "tilt-turret/barrel",
    ]);
    expect(tree.below(["turret-a"])).toEqual(["flag", "turret-a/base", "turret-a/barrel"]);
    expect(tree.below(["turret-a/barrel"])).toEqual(["flag"]);
    expect(tree.below(["lone"])).toEqual([]);
  });

  it("misses an instance under a node without the document, and finds the rest by the view", () => {
    const tree = editTree(view);
    expect(tree.below(["tilt"])).toEqual(["tilt-board", "tilt-mark"]);
    expect(tree.isInstance("turret-a")).toBe(true);
  });

  it("names the instances a prefab child sits in, outermost first", () => {
    expect(enclosingInstances("room-1/door-1/panel")).toEqual(["room-1", "room-1/door-1"]);
    expect(enclosingInstances("room-1/~solid:0")).toEqual(["room-1"]);
    expect(enclosingInstances("lone")).toEqual([]);
    expect(enclosingInstances("~solid:0")).toEqual([]);
  });
});

describe("gizmoTarget for nodes and instances", () => {
  it("makes a node a point target with its frame and subtree", () => {
    const t = gizmoTarget(view, registry, "tilt", source)!;
    expect(t).toMatchObject({ type: "node", at: [10, 5], pointField: "at" });
    expect(t.frame).toEqual({ at: [10, 5], rot: 0, flip: false });
    expect(t.subtree).toContain("tilt-turret/barrel");
    expect(t.box).toEqual({ minX: 9.5, minY: 4.4, maxX: 12, maxY: 6.1 });
  });

  it("makes an instance's id a point target at its origin, with the document", () => {
    expect(gizmoTarget(view, registry, "turret-a")).toBeUndefined();
    const t = gizmoTarget(view, registry, "turret-a", source)!;
    expect(t).toMatchObject({ ref: "turret-a", type: "node", prefab: "turret", at: [2, 6] });
    expect(t.pointField).toBeUndefined();
    expect(t.frame).toEqual({ at: [2, 6], rot: 0, flip: false });
    expect(t.subtree).toEqual(["flag", "turret-a/base", "turret-a/barrel"]);
  });

  it("places an instance under a node by the node's frame", () => {
    const turned = {
      ...doc,
      entities: doc.entities!.map((e) => (e.id === "tilt" ? { ...e, rot: 90 } : e)),
    };
    const t = gizmoTarget(viewOf(turned), registry, "tilt-turret", { ...source, doc: turned })!;
    expect(t.frame).toEqual({ at: [10, 6], rot: 90, flip: false });
  });
});

describe("moving a parent", () => {
  it("writes one move of the node and previews its whole subtree", () => {
    const t = gizmoTarget(view, registry, "tilt", source)!;
    const edit = moveTarget(t, [10, 5], [11, 5], opts);
    expect(edit.batch!.ops).toEqual([{ op: "move", refs: ["tilt"], by: [1, 0] }]);
    const shown = previewed(edit.preview!);
    const after = viewOf(commit(edit.batch!));
    const ids = ["tilt", "tilt-board", "tilt-mark", "tilt-turret/base", "tilt-turret/barrel"];
    expect(geometry(shown, ids)).toEqual(geometry(after, ids));
    expect(entity(shown, "tilt-turret/base").shape).toEqual(["box", 12, 4.8, 0.4, 0.2]);
  });

  it("writes one move of an instance, whose preview is its children", () => {
    const t = gizmoTarget(view, registry, "turret-a", source)!;
    const edit = dragHandle(t, "move", [2, 6], [2, 5], opts)!;
    expect(edit.batch!.ops).toEqual([{ op: "move", refs: ["turret-a"], by: [0, -1] }]);
    expect(edit.preview!.ops).toEqual([
      { op: "move", refs: ["flag", "turret-a/base", "turret-a/barrel"], by: [0, -1] },
    ]);
    const ids = ["flag", "turret-a/base", "turret-a/barrel"];
    expect(geometry(previewed(edit.preview!), ids)).toEqual(
      geometry(viewOf(commit(edit.batch!)), ids),
    );
  });

  it("snaps the box over the subtree, never to the subtree itself", () => {
    const t = gizmoTarget(view, registry, "tilt", source)!;
    const snapped = moveTarget(t, [10, 5], [10.37, 5], {
      ...opts,
      snap: { ...DEFAULT_SNAP, enabled: true, step: 0.5, geometry: false },
    });
    // The box's left edge, 9.5, lands on the grid at 10, and its top, 4.4, at 4.5.
    expect(snapped.batch!.ops).toEqual([{ op: "move", refs: ["tilt"], by: [0.5, 0.1] }]);
  });

  it("still writes an override for a drag on a child inside an instance", () => {
    const t = gizmoTarget(view, registry, "turret-a/base", source)!;
    const edit = moveTarget(t, [2, 5.8], [2.5, 5.8], opts);
    expect(edit.batch!.ops).toEqual([{ op: "move", refs: ["turret-a/base"], by: [0.5, 0] }]);
    const after = commit(edit.batch!);
    expect(after.instances![0]).toMatchObject({
      id: "turret-a",
      at: [2, 6],
      overrides: { "base.shape": ["box", 0.5, -0.2, 0.4, 0.2] },
    });
    // The document entity under the child's sibling stays put.
    expect(entity(previewed(edit.preview ?? edit.batch!), "flag").at).toEqual(
      entity(view, "flag").at,
    );
  });
});

describe("turning a parent", () => {
  const snap15 = { ...opts, snap: { ...DEFAULT_SNAP, enabled: true, angleDeg: 15 } };

  it("writes one transform with rotate at the snap angle for a node", () => {
    const t = gizmoTarget(view, registry, "tilt", source)!;
    const from: Pt = [10, 4];
    // 40° clockwise about the origin snaps to 45.
    const rad = (40 * Math.PI) / 180;
    const to: Pt = [10 + Math.sin(rad), 5 - Math.cos(rad)];
    const edit = dragHandle(t, "rotate", from, to, snap15)!;
    expect(edit.batch!.ops).toEqual([{ op: "transform", refs: ["tilt"], rotate: 45 }]);
    expect(edit.readout).toBe("45°");
    const ids = ["tilt", "tilt-board", "tilt-mark", "tilt-turret/base", "tilt-turret/barrel"];
    expect(geometry(previewed(edit.preview!), ids)).toEqual(
      geometry(viewOf(commit(edit.batch!)), ids),
    );
  });

  it("writes one transform for an instance, previewing its children turned", () => {
    const t = gizmoTarget(view, registry, "turret-a", source)!;
    const edit = dragHandle(t, "rotate", [2, 5], [3, 6], snap15)!;
    expect(edit.batch!.ops).toEqual([{ op: "transform", refs: ["turret-a"], rotate: 90 }]);
    const ids = ["flag", "turret-a/base", "turret-a/barrel"];
    expect(geometry(previewed(edit.preview!), ids)).toEqual(
      geometry(viewOf(commit(edit.batch!)), ids),
    );
  });

  it("snaps the world angle, so a node already at an angle lands on the step", () => {
    const at37 = {
      ...doc,
      entities: doc.entities!.map((e) => (e.id === "tilt" ? { ...e, rot: 37 } : e)),
    };
    const t = gizmoTarget(viewOf(at37), registry, "tilt", { ...source, doc: at37 })!;
    const rad = ((37 + 5) * Math.PI) / 180;
    const up = (37 * Math.PI) / 180;
    const edit = dragHandle(
      t,
      "rotate",
      [10 + Math.sin(up), 5 - Math.cos(up)],
      [10 + Math.sin(rad), 5 - Math.cos(rad)],
      snap15,
    )!;
    expect(edit.batch!.ops).toEqual([{ op: "transform", refs: ["tilt"], rotate: 8 }]);
    expect(edit.readout).toBe("45°");
  });

  it("writes nothing for a turn that snaps back to where it was", () => {
    const t = gizmoTarget(view, registry, "tilt", source)!;
    expect(dragHandle(t, "rotate", [10, 4], [10.05, 4], snap15)!.batch).toBeNull();
  });
});

describe("a selection holding a parent and what sits under it", () => {
  const targets = ["tilt", "tilt-board", "lone"].map(
    (r) => gizmoTarget(view, registry, r, source)!,
  );

  it("moves only the roots, in one move, previewing every subtree", () => {
    expect(rootTargets(targets).map((t) => t.ref)).toEqual(["tilt", "lone"]);
    const edit = dragSelection(targets, "move", [10, 5], [10, 6], opts)!;
    expect(edit.batch!.ops).toEqual([{ op: "move", refs: ["tilt", "lone"], by: [0, 1] }]);
    const ids = ["tilt", "tilt-board", "tilt-mark", "tilt-turret/base", "lone"];
    expect(geometry(previewed(edit.preview!), ids)).toEqual(
      geometry(viewOf(commit(edit.batch!)), ids),
    );
  });

  it("turns nodes and instances by one transform about the pivot, the rest by their fields", () => {
    const batch = rotateTargetsBatch(targets, [12, 5], 90, 50)!;
    expect(batch.ops[0]).toEqual({ op: "transform", refs: ["tilt"], rotate: 90, about: [12, 5] });
    expect(batch.ops.slice(1)).toEqual([
      { op: "update", ref: "lone", set: { shape: ["box", 12, 8, 0.5, 0.5, 90] } },
    ]);
    const one = rotateTargetsBatch([targets[0]!], [10, 5], 90, 50)!;
    expect(one.ops).toEqual([{ op: "transform", refs: ["tilt"], rotate: 90 }]);
  });
});

describe("a preview the view applies as it is", () => {
  it("turns a node with plain children by updates on the view's own ids", () => {
    const plainDoc = { ...doc, instances: [] };
    const plainView = viewOf(plainDoc);
    const t = gizmoTarget(plainView, registry, "tilt", { ...source, doc: plainDoc })!;
    const edit = dragHandle(t, "rotate", [10, 4], [11, 5], {
      ...opts,
      snap: { ...DEFAULT_SNAP, angleDeg: 15 },
    })!;
    const shown = applyOps(plainView, edit.preview!, registry, { validate: "none" });
    expect(shown.ok).toBe(true);
    const ids = ["tilt", "tilt-board", "tilt-mark"];
    expect(geometry(shown.ok ? shown.def : plainView, ids)).toEqual(
      geometry(viewOf(commit(edit.batch!, plainDoc)), ids),
    );
  });
});
