import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../../game/define";
import type { EntityDef, Pt, SceneDefinition } from "../../../scene/types";
import { DEFAULT_SNAP } from "../../tools";
import { behaviorMarks } from "../behavior-marks";
import { HANDLE_HIT_PX, hitHandle, targetHandles } from "../handles";
import { dragHandle, type DragOptions } from "../index";
import { gizmoTarget, type GizmoTarget } from "../target";

const registry = createRegistry();

const scene = (...entities: EntityDef[]): SceneDefinition => ({
  v: 1,
  name: "chain",
  bounds: [0, 0, 20, 20],
  settings: { physics: "rapier" },
  entities,
});

const anchor: EntityDef = {
  id: "chain-anchor",
  type: "marker",
  at: [10, 1.5],
  behaviors: { collider: { shape: ["box", 0, 0, 0.1, 0.1] } },
};
const link = (anchorB: Pt): EntityDef => ({
  id: "link-1",
  type: "marker",
  at: [10.4, 1.5],
  behaviors: {
    body: {},
    collider: { shape: ["box", 0, 0, 0.4, 0.05] },
    joint: { kind: "revolute", to: "chain-anchor", anchorA: [-0.4, 0], anchorB },
  },
});

function targetOf(def: SceneDefinition): GizmoTarget {
  const t = gizmoTarget(def, registry, "link-1");
  if (!t) throw new Error("no target");
  return t;
}

const near = (a: Pt, b: Pt) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

describe("a joint's anchor handles where the anchors meet", () => {
  for (const scale of [32, 100]) {
    it(`can each be grabbed at ${scale} px per metre`, () => {
      const t = targetOf(scene(anchor, link([0, 0])));
      const handles = targetHandles(t, { scale });
      const a = handles.find((h) => h.id === "joint:anchorA")!;
      const b = handles.find((h) => h.id === "joint:anchorB")!;
      near(b.at, [10, 1.5]);
      expect(hitHandle(handles, b.at, scale)?.id).toBe("joint:anchorB");
      expect(hitHandle(handles, a.at, scale)?.id).toBe("joint:anchorA");
      const gap = Math.max(Math.abs(a.at[0] - b.at[0]), Math.abs(a.at[1] - b.at[1])) * scale;
      expect(gap).toBeGreaterThanOrEqual(2 * HANDLE_HIT_PX);
      // The collider's west edge handle sat under the anchors; its corners stay.
      const ids = handles.map((h) => h.id);
      expect(ids).not.toContain("collider:resize:w");
      expect(ids).toContain("collider:resize:nw");
      expect(ids).toContain("collider:resize:sw");
      expect(ids).toContain("collider:resize:e");
      for (const h of handles)
        if (h.id !== "joint:anchorA")
          expect(
            Math.max(Math.abs(h.at[0] - a.at[0]), Math.abs(h.at[1] - a.at[1])) * scale,
          ).toBeGreaterThanOrEqual(2 * HANDLE_HIT_PX - 1e-6);
    });
  }

  it("stay at their anchors once apart", () => {
    const t = targetOf(scene(anchor, link([0.5, 0])));
    const handles = targetHandles(t, { scale: 100 });
    near(handles.find((h) => h.id === "joint:anchorA")!.at, [10, 1.5]);
    near(handles.find((h) => h.id === "joint:anchorB")!.at, [10.5, 1.5]);
    expect(handles.map((h) => h.id)).not.toContain("collider:resize:w");
  });

  it("move anchorA by the pointer's travel from its moved-aside handle", () => {
    const def = scene(anchor, link([0, 0]));
    const t = targetOf(def);
    const opts: DragOptions = {
      mods: { shift: false, alt: false, mod: false },
      snap: { ...DEFAULT_SNAP, enabled: false, geometry: false },
      scale: 100,
      pxPerMetre: 100,
    };
    const at = targetHandles(t, { scale: 100 }).find((h) => h.id === "joint:anchorA")!.at;
    const edit = dragHandle(t, "joint:anchorA", at, [at[0], at[1] + 0.5], opts);
    expect(edit?.batch?.ops).toEqual([
      { op: "update", ref: "link-1", set: { "behaviors.joint.anchorA": [-0.4, 0.5] } },
    ]);
  });

  it("draw no line between anchors that meet, though anchorA's handle moved aside", () => {
    const t = targetOf(scene(anchor, link([0, 0])));
    const handles = targetHandles(t, { scale: 32 });
    const marks = behaviorMarks(t.behaviors!, 32, handles);
    expect(marks.lines.map((l) => l.kind)).toEqual(["link"]);
  });
});
