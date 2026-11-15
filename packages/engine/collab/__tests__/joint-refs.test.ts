import { describe, expect, it } from "vite-plus/test";

import { engine, engineYard } from "../../scene/__tests__/fixtures/random-ops";
import type { SceneDefinition } from "../../scene/types";
import { createSceneUndo } from "../undo";
import { ada, apply, bo, entity, ids, link, pair, sync, text } from "./helpers";

function jointed(): SceneDefinition {
  const def = engineYard();
  def.entities = [
    ...(def.entities ?? []),
    {
      id: "arm",
      type: "marker",
      at: [1200, 880],
      behaviors: {
        collider: { shape: ["box", 0, 0, 30, 6] },
        body: {},
        joint: {
          kind: "revolute",
          to: "crate",
          limits: [-1, 1],
          motor: { velocity: 1, maxForce: 10 },
        },
      },
    },
  ];
  return def;
}

const joint = (doc: Parameters<typeof entity>[0], id = "arm") =>
  (entity(doc, id)?.behaviors as Record<string, Record<string, unknown>> | undefined)?.joint;

describe("a joint's refs under co-editing", () => {
  it("follows a rename of the `to` entity while the jointed entity moves", () => {
    const [a, b] = pair(jointed());
    apply(a, { ops: [{ op: "rename", from: "crate", to: "barrel" }] }, ada, engine);
    apply(b, { ops: [{ op: "move", refs: ["arm"], by: [50, 0] }] }, bo, engine);
    sync(a, b);

    expect(text(a)).toBe(text(b));
    expect(ids(a)).toContain("barrel");
    expect(ids(a)).not.toContain("crate");
    expect(joint(a)?.to).toBe("barrel");
    expect(entity(a, "arm")?.at).toEqual([1250, 880]);
  });

  it("keeps the joint block when the jointed entity itself is renamed", () => {
    const [a, b] = pair(jointed());
    apply(a, { ops: [{ op: "rename", from: "arm", to: "lever" }] }, ada, engine);
    apply(b, { ops: [{ op: "move", refs: ["crate"], by: [0, -20] }] }, bo, engine);
    sync(a, b);

    expect(text(a)).toBe(text(b));
    expect(entity(a, "arm")).toBeUndefined();
    expect(joint(a, "lever")).toMatchObject({
      kind: "revolute",
      to: "crate",
      limits: [-1, 1],
      motor: { velocity: 1, maxForce: 10 },
    });
  });

  it("keeps concurrent edits to the limits and to the motor", () => {
    const [a, b] = pair(jointed());
    apply(
      a,
      { ops: [{ op: "update", ref: "arm", set: { "behaviors.joint.limits": [-0.5, 0.5] } }] },
      ada,
      engine,
    );
    apply(
      b,
      {
        ops: [
          {
            op: "update",
            ref: "arm",
            set: { "behaviors.joint.motor": { velocity: 3, maxForce: 20 } },
          },
        ],
      },
      bo,
      engine,
    );
    sync(a, b);

    expect(text(a)).toBe(text(b));
    expect(joint(a)).toMatchObject({
      to: "crate",
      limits: [-0.5, 0.5],
      motor: { velocity: 3, maxForce: 20 },
    });
  });

  it("undoes the rename in one step, for the renamer only", () => {
    const [a, b] = pair(jointed());
    const unlink = link(a, b);
    const undoA = createSceneUndo(a, ada);
    const undoB = createSceneUndo(b, bo);

    apply(a, { ops: [{ op: "rename", from: "crate", to: "barrel" }] }, ada, engine);
    undoA.commit({ before: [], after: [] });
    apply(b, { ops: [{ op: "move", refs: ["arm"], by: [50, 0] }] }, bo, engine);
    undoB.commit({ before: [], after: [] });

    expect(undoA.manager.undoStack).toHaveLength(1);
    undoA.undo();
    expect(undoA.canUndo()).toBe(false);
    for (const doc of [a, b]) {
      expect(ids(doc)).toContain("crate");
      expect(ids(doc)).not.toContain("barrel");
      expect(joint(doc)?.to).toBe("crate");
      expect(entity(doc, "arm")?.at).toEqual([1250, 880]);
    }
    expect(undoB.canUndo()).toBe(true);
    unlink();
  });
});
