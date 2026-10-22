import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyJsonCanvas } from "../json-canvas";
import { CANVAS_LIMITS } from "../limits";
import { checkLiveStore, snapshotOfState } from "../live-store";

function stateWith(...ids: string[]): Uint8Array {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, {
    nodes: ids.map((id) => ({ id, type: "text", text: id, x: 0, y: 0, width: 10, height: 10 })),
  });
  return Y.encodeStateAsUpdate(doc);
}

describe("checkLiveStore", () => {
  it("refuses over the size and card caps", () => {
    const stored = stateWith();
    const huge = new Uint8Array(CANVAS_LIMITS.maxStateBytes + 1);
    expect(checkLiveStore(stored, huge, 1, false)).toEqual({
      kind: "refused",
      reason: "too-large",
    });
    expect(checkLiveStore(stored, stateWith("a"), CANVAS_LIMITS.maxNodes + 1, false)).toEqual({
      kind: "refused",
      reason: "too-many-nodes",
    });
    expect(checkLiveStore(stored, stateWith("a"), CANVAS_LIMITS.maxNodes, false).kind).toBe(
      "changed",
    );
  });

  it("notices nothing changed", () => {
    const stored = stateWith("a");
    expect(checkLiveStore(stored, stored, 1, false)).toMatchObject({ kind: "unchanged" });
  });

  it("derives the snapshot only when asked", () => {
    const merged = stateWith("a", "b");
    expect(checkLiveStore(stateWith(), merged, 2, false)).toMatchObject({ snapshot: undefined });
    const result = checkLiveStore(stateWith(), merged, 2, true);
    expect(result.kind === "changed" && result.snapshot?.nodes.map((n) => n.text).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(snapshotOfState(merged).nodes).toHaveLength(2);
  });
});
