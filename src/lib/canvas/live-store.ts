/**
 * The rules `canvas-sync` applies to a live doc's merged state before it
 * stores it: the same caps as the solo save, and the JSON Canvas snapshot
 * when one is due. Bytes in, bytes out, so the service's Yjs and this
 * module's never meet. Shared with services, so no `@/` imports.
 */
import { docFromState } from "./doc-state";
import { deriveSnapshot, type JsonCanvas } from "./json-canvas";
import { CANVAS_LIMITS } from "./limits";

export type LiveStoreCheck =
  | { kind: "refused"; reason: "too-large" | "too-many-nodes" }
  | { kind: "unchanged" | "changed"; snapshot?: JsonCanvas; snapshotMs: number };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The JSON Canvas copy of a stored state, sanitised for readers. */
export function snapshotOfState(state: Uint8Array): JsonCanvas {
  const doc = docFromState(state);
  try {
    return deriveSnapshot(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * `merged` already holds everything `stored` did (the service folds the
 * stored state into the live doc before encoding it), so this only decides:
 * refuse it over a cap, skip the write when nothing changed, and derive the
 * snapshot when asked.
 */
export function checkLiveStore(
  stored: Uint8Array,
  merged: Uint8Array,
  nodeCount: number,
  withSnapshot: boolean,
): LiveStoreCheck {
  if (merged.length > CANVAS_LIMITS.maxStateBytes) return { kind: "refused", reason: "too-large" };
  if (nodeCount > CANVAS_LIMITS.maxNodes) return { kind: "refused", reason: "too-many-nodes" };
  const started = performance.now();
  const snapshot = withSnapshot ? snapshotOfState(merged) : undefined;
  const snapshotMs = withSnapshot ? performance.now() - started : 0;
  return { kind: sameBytes(merged, stored) ? "unchanged" : "changed", snapshot, snapshotMs };
}
