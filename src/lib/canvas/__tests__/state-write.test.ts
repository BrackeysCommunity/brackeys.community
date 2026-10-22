import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyJsonCanvas } from "../json-canvas";
import { CANVAS_LIMITS } from "../limits";
import { prepareState, snapshotOfState } from "../state-write";

function stateWith(...ids: string[]): Uint8Array {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, {
    nodes: ids.map((id) => ({ id, type: "text", text: id, x: 0, y: 0, width: 10, height: 10 })),
  });
  return Y.encodeStateAsUpdate(doc);
}

describe("prepareState", () => {
  it("refuses over the size and card caps", () => {
    const stored = stateWith();
    const huge = new Uint8Array(CANVAS_LIMITS.maxStateBytes + 1);
    expect(prepareState(stored, huge, { nodeCount: 1, snapshot: "never" })).toMatchObject({
      kind: "refused",
      reason: "too-large",
      bytes: huge.length,
    });
    expect(
      prepareState(stored, stateWith("a"), {
        nodeCount: CANVAS_LIMITS.maxNodes + 1,
        snapshot: "never",
      }),
    ).toMatchObject({
      kind: "refused",
      reason: "too-many-nodes",
      nodes: CANVAS_LIMITS.maxNodes + 1,
    });
    expect(
      prepareState(stored, stateWith("a"), { nodeCount: CANVAS_LIMITS.maxNodes, snapshot: "never" })
        .kind,
    ).toBe("changed");
  });

  it("counts the cards itself when not told", () => {
    const ids = Array.from({ length: CANVAS_LIMITS.maxNodes + 1 }, (_, i) => `n${i}`);
    expect(prepareState(stateWith(), stateWith(...ids), { snapshot: "never" })).toMatchObject({
      kind: "refused",
      reason: "too-many-nodes",
      nodes: ids.length,
    });
  });

  it("notices nothing changed", () => {
    const stored = stateWith("a");
    expect(prepareState(stored, stored, { nodeCount: 1, snapshot: "never" })).toMatchObject({
      kind: "unchanged",
    });
  });

  it("derives the snapshot only when asked", () => {
    const stored = stateWith();
    const merged = stateWith("a", "b");
    expect(prepareState(stored, merged, { nodeCount: 2, snapshot: "never" })).not.toHaveProperty(
      "snapshot",
    );
    const result = prepareState(stored, merged, { nodeCount: 2, snapshot: "always" });
    expect(result.kind === "changed" && result.snapshot?.nodes.map((n) => n.text).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(snapshotOfState(merged).nodes).toHaveLength(2);
  });

  it("skips the snapshot of an unchanged state unless it's always wanted", () => {
    const stored = stateWith("a");
    const skipped = prepareState(stored, stored, { snapshot: "when-changed" });
    expect(skipped.kind).toBe("unchanged");
    expect(skipped).not.toHaveProperty("snapshot");
    const refreshed = prepareState(stored, stored, { snapshot: "always" });
    expect(refreshed.kind === "unchanged" && refreshed.snapshot?.nodes).toHaveLength(1);
  });
});
