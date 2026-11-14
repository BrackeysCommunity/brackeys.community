// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { pivotRegistry } from "../../__tests__/fixtures/pivot-game";
import { applyOps } from "../../scene/ops";
import { resolveScene } from "../../scene/resolve";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { rotateSelectionBatch } from "../commands";
import { gizmoTarget } from "../gizmos/target";
import { isComposite } from "../outline-bounds";

const registry = pivotRegistry();

const doc = (type: string): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  game: registry.id,
  name: "hub",
  bounds: [-20, -20, 20, 20],
  entities: [
    { id: "hub", type, at: [5, 5], rot: 90, flip: true },
    { id: "kid", type: "marker", at: [1, 0], parent: "hub" },
  ],
});

describe("a type based on node in the editor", () => {
  it.each(["node", "pivot"])("gives a %s its frame gizmo", (type) => {
    const def = doc(type);
    expect(gizmoTarget(resolveScene(def, registry), registry, "hub", { doc: def })).toMatchObject({
      at: [5, 5],
      frame: { at: [5, 5], rot: 90, flip: true },
    });
  });

  it.each(["node", "pivot"])("turns a %s by one transform, its child with it", (type) => {
    const def = doc(type);
    const batch = rotateSelectionBatch(def, registry, ["hub"], 90)!;
    expect(batch.ops).toEqual([{ op: "transform", refs: ["hub"], rotate: 90 }]);
    const r = applyOps(def, batch, registry);
    if (!r.ok) throw new Error(r.issue.message);
    const kid = resolveScene(r.def, registry).entities?.find((e) => e.id === "kid");
    expect(kid?.at).toEqual([6, 5]);
  });

  it.each(["node", "pivot"])("draws the selection box around a %s with a child", (type) => {
    const def = resolveScene(doc(type), registry);
    expect(isComposite(def, "hub", { registry })).toBe(true);
  });
});
