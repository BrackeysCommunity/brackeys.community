import { describe, expect, it } from "vite-plus/test";

import {
  engine,
  engineYard,
  testGameRegistry as game,
  testGameYard,
  yardPrefabs,
} from "../../scene/__tests__/fixtures/random-ops";
import { readCell, type GridCells } from "../../scene/grid";
import { createSceneUndo } from "../undo";
import { ada, agent, apply, bo, entity, instance, keyOf, link, pair, text } from "./helpers";

const withParams = { prefabs: yardPrefabs("test-game", { params: true }) };
const cell = (doc: Parameters<typeof entity>[0], col: number, row: number) =>
  readCell(entity(doc, "floor")!.cells as GridCells, col, row);

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

  it("paintCells, transform and setParam undo per client after someone else painted the same chunk", () => {
    const [a, b] = pair(testGameYard());
    const unlink = link(a, b);
    const undoA = createSceneUndo(a, ada);
    const undoB = createSceneUndo(b, bo);
    const step = (
      doc: typeof a,
      undo: typeof undoA,
      origin: typeof ada,
      ops: Parameters<typeof apply>[1]["ops"],
    ) => {
      apply(doc, { ops }, origin, game, withParams);
      undo.commit({ before: [], after: [] });
    };

    step(a, undoA, ada, [
      {
        op: "paintCells",
        ref: "floor",
        field: "cells",
        cells: [
          [1, 1, 3],
          [2, 1, 3],
        ],
      },
    ]);
    step(b, undoB, bo, [{ op: "paintCells", ref: "floor", field: "cells", cells: [[1, 2, 2]] }]);
    step(b, undoB, bo, [{ op: "setParam", ref: "gate-1", name: "pause", value: 200 }]);
    step(a, undoA, ada, [{ op: "transform", refs: ["gate-1"], turn: 1 }]);
    step(a, undoA, ada, [{ op: "setParam", ref: "gate-1", name: "speed", value: 150 }]);
    step(b, undoB, bo, [
      { op: "paintCells", ref: "floor", field: "cells", rects: [[4, 3, 6, 3, 1]] },
      { op: "setParam", ref: "post-1", name: "top", value: [0, -70] },
    ]);
    expect(instance(a, "gate-1")).toMatchObject({ rot: 1, params: { pause: 200, speed: 150 } });

    undoA.undo();
    expect(instance(b, "gate-1")).toMatchObject({ rot: 1, params: { pause: 200 } });
    undoA.undo();
    expect(instance(b, "gate-1")).toEqual({
      id: "gate-1",
      prefab: "gate",
      at: [1100, 900],
      params: { pause: 200 },
    });
    undoA.undo();
    expect(undoA.canUndo()).toBe(false);
    for (const doc of [a, b]) {
      expect([cell(doc, 1, 1), cell(doc, 2, 1)]).toEqual([0, 0]);
      expect([cell(doc, 0, 0), cell(doc, 0, 2), cell(doc, 1, 2)]).toEqual([1, 2, 2]);
      expect([cell(doc, 4, 3), cell(doc, 6, 3)]).toEqual([1, 1]);
    }
    expect(text(a)).toBe(text(b));

    expect(undoB.manager.undoStack).toHaveLength(3);
    undoB.undo();
    expect(cell(a, 5, 3)).toBe(0);
    expect(instance(a, "post-1")!.params).toBeUndefined();
    expect(instance(a, "gate-1")!.params).toEqual({ pause: 200 });
    expect(cell(a, 1, 2)).toBe(2);
    expect(text(a)).toBe(text(b));
    unlink();
  }, 60_000);

  it("undoing a paint leaves a later paint by someone else to the same row standing", () => {
    const [a, b] = pair(testGameYard());
    const unlink = link(a, b);
    const undoA = createSceneUndo(a, ada);
    apply(
      a,
      { ops: [{ op: "paintCells", ref: "floor", field: "cells", cells: [[3, 1, 3]] }] },
      ada,
      game,
      withParams,
    );
    undoA.commit({ before: [], after: [] });
    apply(
      b,
      { ops: [{ op: "paintCells", ref: "floor", field: "cells", cells: [[7, 1, 2]] }] },
      bo,
      game,
      withParams,
    );
    undoA.undo();
    expect([cell(a, 3, 1), cell(a, 7, 1)]).toEqual([3, 2]);
    expect(text(a)).toBe(text(b));
    unlink();
  }, 60_000);
});
