import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { applyOps } from "../../scene/ops";
import type { EntityDef, Pt, SceneDefinition } from "../../scene/types";
import { validateScene } from "../../scene/validate";
import { behaviorMarks } from "../gizmos/behavior-marks";
import {
  FORCE_PX,
  REACH_PX,
  shapeToPose,
  shapeToWorld,
  VELOCITY_PX,
} from "../gizmos/behavior-target";
import { targetHandles } from "../gizmos/handles";
import { dragHandle, type DragOptions } from "../gizmos/index";
import { gizmoTarget, type GizmoTarget } from "../gizmos/target";
import { DEFAULT_SNAP } from "../tools";

const registry = createRegistry();
/** Screen px per metre: the default 100 px per metre at 1:1. */
const SCALE = 100;
const opts: DragOptions = {
  mods: { shift: false, alt: false, mod: false },
  snap: { ...DEFAULT_SNAP, enabled: false, geometry: false },
  scale: SCALE,
  pxPerMetre: 100,
};

const scene = (...entities: EntityDef[]): SceneDefinition => ({
  v: 1,
  name: "gizmos",
  bounds: [0, 0, 20, 20],
  settings: { physics: "rapier" },
  entities,
});

const marker = (behaviors: Record<string, unknown>, at: Pt = [5, 5]): EntityDef => ({
  id: "m",
  type: "marker",
  at,
  behaviors,
});

function targetOf(def: SceneDefinition, ref = "m"): GizmoTarget {
  const t = gizmoTarget(def, registry, ref);
  if (!t) throw new Error(`no target ${ref}`);
  return t;
}

const handleAt = (t: GizmoTarget, id: string): Pt => {
  const h = targetHandles(t, { scale: SCALE }).find((x) => x.id === id);
  if (!h) throw new Error(`no handle ${id}`);
  return h.at;
};

/** The one update a drag writes, applied: it must leave the scene valid. */
function drag(def: SceneDefinition, id: string, to: Pt, from?: Pt) {
  const t = targetOf(def);
  const start = from ?? handleAt(t, id);
  const edit = dragHandle(t, id, start, to, opts);
  if (!edit?.batch) throw new Error(`${id} wrote nothing`);
  const r = applyOps(def, edit.batch, registry);
  if (!r.ok) throw new Error(r.issue.message);
  return { edit, ops: edit.batch.ops, def: r.def };
}

describe("behavior gizmo handles", () => {
  it("leaves a target without standard behaviors with its own handles only", () => {
    const def = scene({ id: "m", type: "marker", at: [5, 5] });
    const t = targetOf(def);
    expect(t.behaviors).toBeUndefined();
    expect(targetHandles(t, { scale: SCALE }).map((h) => h.id)).toEqual(["move"]);
  });

  it("gives a collider the shape handles but move, beneath the entity's own", () => {
    const def = scene(marker({ collider: { shape: ["box", 0, 0, 0.25, 0.5] } }));
    const handles = targetHandles(targetOf(def), { scale: SCALE });
    expect(handles.map((h) => h.id)).toEqual([
      "collider:resize:nw",
      "collider:resize:n",
      "collider:resize:ne",
      "collider:resize:e",
      "collider:resize:se",
      "collider:resize:s",
      "collider:resize:sw",
      "collider:resize:w",
      "collider:rotate",
      "move",
    ]);
    expect(handles.find((h) => h.id === "collider:resize:se")!.at).toEqual([5.25, 5.5]);
  });

  it("places a circle's radius and a capsule's length and radius at the pose", () => {
    const circle = scene(marker({ collider: { shape: ["circle", 0, 0, 0.5] } }));
    expect(handleAt(targetOf(circle), "collider:radius")).toEqual([5.5, 5]);
    const capsule = scene(marker({ collider: { shape: ["capsule", 0, 0, 0.5, 0.25] } }));
    expect(handleAt(targetOf(capsule), "collider:length")).toEqual([5, 4.25]);
    expect(handleAt(targetOf(capsule), "collider:radius")).toEqual([5.25, 5]);
  });

  it("puts the joint's anchors on each body, the second only when written", () => {
    const crate: EntityDef = { id: "crate", type: "prop", shape: ["box", 8, 5, 0.5, 0.5] };
    const one = scene(
      marker({
        collider: { shape: ["box", 0, 0, 0.25, 0.25] },
        body: {},
        joint: { kind: "revolute", to: "crate", anchorA: [0.5, 0] },
      }),
      crate,
    );
    expect(handleAt(targetOf(one), "joint:anchorA")).toEqual([5.5, 5]);
    expect(
      targetHandles(targetOf(one), { scale: SCALE }).some((h) => h.id === "joint:anchorB"),
    ).toBe(false);
    const two = scene(
      marker({
        collider: { shape: ["box", 0, 0, 0.25, 0.25] },
        body: {},
        joint: { kind: "revolute", to: "crate", anchorB: [-0.5, 0] },
      }),
      crate,
    );
    expect(handleAt(targetOf(two), "joint:anchorB")).toEqual([7.5, 5]);
  });

  it("draws a force as an arrow tip, a point force as a ring, a spawner's spread as a ring", () => {
    const sensor = { shape: ["box", 0, 0, 1, 1], sensor: true };
    const dir = scene(marker({ collider: sensor, "force-area": { force: [0, -20] } }));
    expect(handleAt(targetOf(dir), "force-area:force")).toEqual([5, 5 - (20 * FORCE_PX) / SCALE]);
    const point = scene(
      marker({ collider: sensor, "force-area": { kind: "point", strength: -10 } }),
    );
    expect(handleAt(targetOf(point), "force-area:strength")).toEqual([
      5 + (10 * FORCE_PX) / SCALE,
      5,
    ]);
    const spawn = scene(marker({ spawner: { type: "marker", spread: 0.5, velocity: [2, 0] } }));
    expect(handleAt(targetOf(spawn), "spawner:spread")).toEqual([5.5, 5]);
    expect(handleAt(targetOf(spawn), "spawner:velocity")).toEqual([
      5 + (2 * VELOCITY_PX) / SCALE,
      5,
    ]);
  });

  it("keeps a zero spread's handle a reach away from the move handle", () => {
    const def = scene(marker({ spawner: { type: "marker" } }));
    expect(handleAt(targetOf(def), "spawner:spread")).toEqual([5 + REACH_PX / SCALE, 5]);
  });
});

describe("behavior gizmo drags", () => {
  it("resizes a collider in the pose's frame, writing behaviors.collider.shape", () => {
    const def = scene(marker({ collider: { shape: ["box", 0, 0, 0.25, 0.25] } }));
    const { ops, edit, def: next } = drag(def, "collider:resize:e", [5.75, 5]);
    expect(ops).toEqual([
      { op: "update", ref: "m", set: { "behaviors.collider.shape": ["box", 0.25, 0, 0.5, 0.25] } },
    ]);
    expect(edit.readout).toBe("W 1 H 0.5 m");
    expect(validateScene(next, registry)).toEqual([]);
  });

  it("grows a circle collider by its radius and turns a box by its stalk", () => {
    const circle = scene(marker({ collider: { shape: ["circle", 0, 0, 0.5] } }));
    expect(drag(circle, "collider:radius", [6, 5]).ops).toEqual([
      { op: "update", ref: "m", set: { "behaviors.collider.shape": ["circle", 0, 0, 1] } },
    ]);
    const box = scene(marker({ collider: { shape: ["box", 0, 0, 0.25, 0.25] } }));
    const t = targetOf(box);
    const stalk = handleAt(t, "collider:rotate");
    expect(drag(box, "collider:rotate", [6, 5], stalk).ops).toEqual([
      {
        op: "update",
        ref: "m",
        set: { "behaviors.collider.shape": ["box", 0, 0, 0.25, 0.25, 90] },
      },
    ]);
  });

  it("writes a collider local to a turned pose", () => {
    const pose = { at: [5, 5] as Pt, rotDeg: 90 };
    const local = { type: "box" as const, cx: 0.5, cy: 0, hw: 0.25, hh: 0.125, rotDeg: 0 };
    const world = shapeToWorld(pose, local);
    expect(world).toMatchObject({ cx: 5, cy: 5.5, rotDeg: 90 });
    expect(shapeToPose(pose, world)).toMatchObject({ cx: 0.5, cy: 0, rotDeg: 0 });
  });

  it("moves the joint's anchor, written from the entity's pose", () => {
    const def = scene(
      marker({
        collider: { shape: ["box", 0, 0, 0.25, 0.25] },
        body: {},
        joint: { kind: "revolute", to: "crate", anchorA: [0.5, 0] },
      }),
      { id: "crate", type: "prop", shape: ["box", 8, 5, 0.5, 0.5] },
    );
    const { ops, def: next } = drag(def, "joint:anchorA", [5.5, 4.75]);
    expect(ops).toEqual([
      { op: "update", ref: "m", set: { "behaviors.joint.anchorA": [0.5, -0.25] } },
    ]);
    expect(validateScene(next, registry)).toEqual([]);
  });

  it("points a force area's force along its arrow, in m/s²", () => {
    const sensor = { shape: ["box", 0, 0, 1, 1], sensor: true };
    const def = scene(marker({ collider: sensor, "force-area": { force: [0, -20] } }));
    const { ops, edit } = drag(def, "force-area:force", [5.4, 5]);
    expect(ops).toEqual([
      {
        op: "update",
        ref: "m",
        set: { "behaviors.force-area.force": [(0.4 * SCALE) / FORCE_PX, 0] },
      },
    ]);
    expect(edit.readout).toBe("10, 0 m/s²");
  });

  it("sizes a point force area's strength by its ring, keeping its sign", () => {
    const sensor = { shape: ["circle", 0, 0, 2], sensor: true };
    const pull = scene(marker({ collider: sensor, "force-area": { kind: "point", strength: 10 } }));
    expect(drag(pull, "force-area:strength", [5.8, 5]).ops).toEqual([
      { op: "update", ref: "m", set: { "behaviors.force-area.strength": 20 } },
    ]);
    const push = scene(
      marker({ collider: sensor, "force-area": { kind: "point", strength: -10 } }),
    );
    expect(drag(push, "force-area:strength", [5.8, 5]).ops).toEqual([
      { op: "update", ref: "m", set: { "behaviors.force-area.strength": -20 } },
    ]);
  });

  it("sets a spawner's spread from its ring and its velocity from its arrow", () => {
    const def = scene(marker({ spawner: { type: "marker", velocity: [2, 0] } }));
    const spread = drag(def, "spawner:spread", [6, 5]);
    expect(spread.ops).toEqual([
      { op: "update", ref: "m", set: { "behaviors.spawner.spread": 1 } },
    ]);
    expect(spread.edit.readout).toBe("R 1 m");
    expect(drag(def, "spawner:velocity", [5.64, 5]).ops).toEqual([
      { op: "update", ref: "m", set: { "behaviors.spawner.velocity": [4, 0] } },
    ]);
  });

  it("writes nothing for a drag that ends where it started, or a handle the entity lacks", () => {
    const def = scene(marker({ spawner: { type: "marker", spread: 0.5 } }));
    const t = targetOf(def);
    const at = handleAt(t, "spawner:spread");
    expect(dragHandle(t, "spawner:spread", at, at, opts)?.batch).toBeNull();
    expect(dragHandle(t, "joint:anchorA", at, [6, 6], opts)).toBeNull();
    expect(dragHandle(t, "collider:resize:e", at, [6, 6], opts)).toBeNull();
  });
});

describe("behavior marks", () => {
  it("draws the collider, the joint line, the force arrow and the spread ring", () => {
    const def = scene(
      marker({
        collider: { shape: ["box", 0, 0, 1, 1], sensor: true },
        "force-area": { force: [0, -20] },
        spawner: { type: "marker", spread: 0.5 },
      }),
    );
    const marks = behaviorMarks(targetOf(def).behaviors!, SCALE);
    expect(marks.outlines).toEqual([
      { shape: { type: "box", cx: 5, cy: 5, hw: 1, hh: 1, rotDeg: 0 }, sensor: true },
    ]);
    expect(marks.arrows).toEqual([{ from: [5, 5], to: [5, 5 - (20 * FORCE_PX) / SCALE] }]);
    expect(marks.rings).toEqual([{ at: [5, 5], r: 0.5 }]);

    const joint = scene(
      marker({
        collider: { shape: ["box", 0, 0, 0.25, 0.25] },
        body: {},
        joint: { kind: "revolute", to: "crate" },
      }),
      { id: "crate", type: "prop", shape: ["box", 8, 5, 0.5, 0.5] },
    );
    expect(behaviorMarks(targetOf(joint).behaviors!, SCALE).lines).toEqual([
      { from: [5, 5], to: [8, 5] },
    ]);
  });

  it("follows a handle the host has moved, and a previewed move of the entity", () => {
    const def = scene(marker({ collider: { shape: ["box", 0, 0, 0.25, 0.25] } }));
    const t = targetOf(def);
    const { edit } = drag(def, "collider:resize:e", [5.75, 5]);
    const previewed = targetOf(applyOk(def, edit.batch!));
    const handles = targetHandles(previewed, { scale: SCALE });
    const [outline] = behaviorMarks(t.behaviors!, SCALE, handles).outlines;
    expect(outline!.shape).toMatchObject({ type: "box", cx: 5.25, cy: 5, hw: 0.5, hh: 0.25 });

    const moved = behaviorMarks(t.behaviors!, SCALE, [], { shift: [1, 0] });
    expect(moved.outlines[0]!.shape).toMatchObject({ cx: 6, cy: 5 });
  });

  it("rings a point force with chevrons in for a pull, out for a push", () => {
    const sensor = { shape: ["circle", 0, 0, 2], sensor: true };
    const pull = scene(marker({ collider: sensor, "force-area": { kind: "point", strength: 10 } }));
    expect(behaviorMarks(targetOf(pull).behaviors!, SCALE).rings).toEqual([
      { at: [5, 5], r: (10 * FORCE_PX) / SCALE, inward: true },
    ]);
    const push = scene(
      marker({ collider: sensor, "force-area": { kind: "point", strength: -10 } }),
    );
    expect(behaviorMarks(targetOf(push).behaviors!, SCALE).rings[0]!.inward).toBe(false);
  });
});

function applyOk(def: SceneDefinition, batch: Parameters<typeof applyOps>[1]): SceneDefinition {
  const r = applyOps(def, batch, registry);
  if (!r.ok) throw new Error(r.issue.message);
  return r.def;
}
