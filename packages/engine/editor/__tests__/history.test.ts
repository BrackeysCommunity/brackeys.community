import { describe, expect, it } from "vite-plus/test";

import type { OpBatch } from "../../scene/types";
import { createHistory, type HistoryEntry } from "../history";

function entry(
  label: string,
  batch: OpBatch,
  at: number,
  actor = "human",
): Omit<HistoryEntry, "at"> & { at: number } {
  return {
    label,
    batch,
    inverse: { ops: [{ op: "setScene", set: { name: `before ${label}` } }] },
    touched: [],
    selectionBefore: [],
    selectionAfter: [],
    actor,
    at,
  };
}

const rename = (name: string): OpBatch => ({ ops: [{ op: "setScene", set: { name } }] });
const moveLift = (dx: number): OpBatch => ({ ops: [{ op: "move", refs: ["lift"], by: [dx, 0] }] });

describe("createHistory", () => {
  it("undoes and redoes in order, with labels", () => {
    const h = createHistory();
    h.push(entry("A", rename("a"), 0));
    h.push(entry("B", rename("b"), 1000));
    expect(h.undoLabel()).toBe("B");
    expect(h.undo()!.label).toBe("B");
    expect(h.redoLabel()).toBe("B");
    expect(h.undo()!.label).toBe("A");
    expect(h.undo()).toBeNull();
    expect(h.canUndo()).toBe(false);
    expect(h.redo()!.label).toBe("A");
    expect(h.canRedo()).toBe(true);
  });

  it("clears redo on push", () => {
    const h = createHistory();
    h.push(entry("A", rename("a"), 0));
    h.push(entry("B", rename("b"), 1000));
    h.undo();
    h.push(entry("C", rename("c"), 2000));
    expect(h.canRedo()).toBe(false);
    expect(h.entries().map((e) => e.label)).toEqual(["A", "C"]);
  });

  it("coalesces quick single-op moves of the same ref, inverse newest first", () => {
    const h = createHistory({ coalesceMs: 500 });
    const first = entry("Move lift", moveLift(1), 0);
    first.inverse = { ops: [{ op: "move", refs: ["lift"], by: [-1, 0] }] };
    const second = entry("Move lift", moveLift(2), 300);
    second.inverse = { ops: [{ op: "move", refs: ["lift"], by: [-2, 0] }] };
    h.push(first);
    h.push(second);
    expect(h.entries()).toHaveLength(1);
    const merged = h.entries()[0]!;
    expect(merged.batch.ops).toEqual([...moveLift(1).ops, ...moveLift(2).ops]);
    expect(merged.inverse.ops).toEqual([...second.inverse.ops, ...first.inverse.ops]);
    expect(merged.at).toBe(300);

    h.push(entry("Move lift", moveLift(3), 1000));
    expect(h.entries()).toHaveLength(2);
  });

  it("does not coalesce different refs, different actors, or multi-op batches", () => {
    const h = createHistory();
    h.push(entry("a", moveLift(1), 0));
    h.push(entry("b", { ops: [{ op: "move", refs: ["cheese"], by: [1, 0] }] }, 10));
    h.push(entry("c", { ops: [{ op: "move", refs: ["cheese"], by: [1, 0] }] }, 20, "agent"));
    h.push(entry("d", { ops: [...moveLift(1).ops, ...moveLift(1).ops] }, 30, "agent"));
    expect(h.entries()).toHaveLength(4);
  });

  it("drops the oldest entries past the cap", () => {
    const h = createHistory({ cap: 3 });
    for (let i = 0; i < 5; i++) h.push(entry(`E${i}`, rename(`n${i}`), i * 1000));
    expect(h.entries().map((e) => e.label)).toEqual(["E2", "E3", "E4"]);
    expect(h.undo()!.label).toBe("E4");
  });

  describe("dirty", () => {
    it("is clean at the saved marker, including after undoing back to it", () => {
      const h = createHistory();
      expect(h.isDirty()).toBe(false);
      h.push(entry("A", rename("a"), 0));
      expect(h.isDirty()).toBe(true);
      h.markSaved();
      expect(h.isDirty()).toBe(false);
      h.push(entry("B", rename("b"), 1000));
      expect(h.isDirty()).toBe(true);
      h.undo();
      expect(h.isDirty()).toBe(false);
      h.undo();
      expect(h.isDirty()).toBe(true);
    });

    it("never coalesces into the saved entry", () => {
      const h = createHistory();
      h.push(entry("a", moveLift(1), 0));
      h.markSaved();
      h.push(entry("b", moveLift(1), 10));
      expect(h.entries()).toHaveLength(2);
      expect(h.isDirty()).toBe(true);
    });

    it("stays dirty until the next save once the saved point is gone", () => {
      const h = createHistory({ cap: 2 });
      h.markSaved();
      for (let i = 0; i < 3; i++) h.push(entry(`E${i}`, rename(`n${i}`), i * 1000));
      while (h.undo());
      expect(h.isDirty()).toBe(true);
      h.markSaved();
      expect(h.isDirty()).toBe(false);
    });

    it("is dirty when a push discards the redo branch that held the save", () => {
      const h = createHistory();
      h.push(entry("A", rename("a"), 0));
      h.markSaved();
      h.undo();
      h.push(entry("B", rename("b"), 1000));
      h.undo();
      expect(h.isDirty()).toBe(true);
    });
  });
});
