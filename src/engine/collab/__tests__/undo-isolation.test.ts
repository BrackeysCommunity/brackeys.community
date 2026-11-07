import { describe, expect, it } from "vite-plus/test";

import { engine, engineYard } from "../../scene/__tests__/fixtures/random-ops";
import { createSceneUndo } from "../undo";
import { ada, agent, apply, bo, entity, keyOf, link, pair, text } from "./helpers";

describe("undo isolation", () => {
  it("undoes only your own batches, after someone edited another field of the same entity", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const undoA = createSceneUndo(a, ada);
    const undoB = createSceneUndo(b, bo);

    apply(a, { ops: [{ op: "move", refs: ["crate"], by: [100, 0] }] }, ada, engine);
    undoA.commit({ before: [], after: [keyOf(a, "crate")!] });
    apply(b, { ops: [{ op: "update", ref: "crate", set: { density: 8 } }] }, bo, engine);
    undoB.commit({ before: [], after: [] });

    expect(undoA.undo()).toEqual({ before: [], after: [keyOf(a, "crate")!] });
    expect(entity(a, "crate")).toMatchObject({ shape: ["circle", 1200, 940, 20], density: 8 });
    expect(entity(b, "crate")).toMatchObject({ shape: ["circle", 1200, 940, 20], density: 8 });
    expect(undoA.canUndo()).toBe(false);
    expect(undoB.canUndo()).toBe(true);
    unlink();
  });

  it("redo still works after remote edits", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const undoA = createSceneUndo(a, ada);

    apply(a, { ops: [{ op: "update", ref: "lift", set: { "path.speed": 200 } }] }, ada, engine);
    undoA.commit({ before: [], after: [] });
    undoA.undo();
    apply(b, { ops: [{ op: "update", ref: "lift", set: { "path.pauseMs": 50 } }] }, bo, engine);
    apply(b, { ops: [{ op: "remove", refs: ["zone"] }] }, bo, engine);

    expect(undoA.canRedo()).toBe(true);
    undoA.redo();
    expect(entity(b, "lift")!.path).toMatchObject({ speed: 200, pauseMs: 50 });
    expect(entity(b, "zone")).toBeUndefined();
    expect(text(a)).toBe(text(b));
    unlink();
  });

  it("one batch is one step, and an agent's or the disk's batches are never on your stack", () => {
    const [a, b] = pair(engineYard());
    const unlink = link(a, b);
    const undoA = createSceneUndo(a, ada);
    apply(
      a,
      {
        ops: [
          { op: "move", refs: ["crate"], by: [1, 0] },
          { op: "remove", refs: ["zone"] },
        ],
      },
      ada,
      engine,
    );
    undoA.commit({ before: [], after: [] });
    apply(a, { ops: [{ op: "move", refs: ["crate"], by: [1, 0] }] }, agent, engine);
    apply(a, { ops: [{ op: "move", refs: ["crate"], by: [1, 0] }] }, { kind: "disk" }, engine);
    expect(undoA.manager.undoStack).toHaveLength(1);
    undoA.undo();
    expect(entity(a, "zone")).toBeDefined();
    // Later writes to the shape by others stand; undo doesn't override them.
    expect(entity(a, "crate")!.shape).toEqual(["circle", 1203, 940, 20]);
    unlink();
  });

  it("keeps the selection around each step", () => {
    const [a] = pair(engineYard());
    const undoA = createSceneUndo(a, ada);
    apply(a, { ops: [{ op: "remove", refs: ["zone"] }] }, ada, engine);
    undoA.commit({ before: ["k-zone"], after: [] });
    expect(undoA.undo()).toEqual({ before: ["k-zone"], after: [] });
    expect(undoA.redo()).toEqual({ before: ["k-zone"], after: [] });
    expect(undoA.undo()).toEqual({ before: ["k-zone"], after: [] });
  });
});
