/**
 * Stored Yjs state: merging, diffing, and restoring a version as a new
 * change. Shared by the web server's solo `save` and `canvas-sync`, so no
 * `@/` imports.
 */
import * as Y from "yjs";

import { canvasEdges, canvasMeta, canvasNodes, yEdgeFrom, yNodeFrom } from "./json-canvas";

export function docFromState(...states: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc({ gc: true });
  for (const state of states) if (state.length > 0) Y.applyUpdate(doc, state);
  return doc;
}

/**
 * Stored state plus an incoming update, merged through a scratch doc and
 * re-encoded. Not `Y.mergeUpdates`: that never discards deleted content,
 * so a canvas with churn would grow without bound.
 */
export function mergeStates(...states: Uint8Array[]): Uint8Array {
  const doc = docFromState(...states);
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** What a client holding `stateVector` is missing from `state`. */
export function missingFrom(state: Uint8Array, stateVector: Uint8Array | null): Uint8Array {
  return Y.diffUpdate(state, stateVector ?? new Uint8Array([0]));
}

export function stateVectorOf(state: Uint8Array): Uint8Array {
  return Y.encodeStateVectorFromUpdate(state);
}

/**
 * Rewrites `target` to hold `text`, touching only the span that differs,
 * so concurrent edits outside it survive.
 */
export function replaceText(target: Y.Text, text: string): void {
  const current = target.toJSON();
  if (current === text) return;
  let start = 0;
  const max = Math.min(current.length, text.length);
  while (start < max && current[start] === text[start]) start++;
  let end = 0;
  while (end < max - start && current[current.length - 1 - end] === text[text.length - 1 - end]) {
    end++;
  }
  const removed = current.length - start - end;
  if (removed > 0) target.delete(start, removed);
  const inserted = text.slice(start, text.length - end);
  if (inserted) target.insert(start, inserted);
}

function plainFields(map: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  map.forEach((value, key) => {
    out[key] = value instanceof Y.Text ? value.toJSON() : value;
  });
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Brings one live map in line with a version's copy, field by field. */
function syncMap(live: Y.Map<unknown>, version: Y.Map<unknown>): void {
  const wanted = plainFields(version);
  live.forEach((_, key) => {
    if (!(key in wanted)) live.delete(key);
  });
  for (const [key, value] of Object.entries(wanted)) {
    const current = live.get(key);
    if (current instanceof Y.Text && typeof value === "string") {
      replaceText(current, value);
    } else if (key === "text" && typeof value === "string") {
      live.set(key, new Y.Text(value));
    } else if (!sameValue(current, value)) {
      live.set(key, value);
    }
  }
}

function syncCollection(
  live: Y.Map<Y.Map<unknown>>,
  version: Y.Map<Y.Map<unknown>>,
  build: (fields: Record<string, unknown>) => Y.Map<unknown>,
): void {
  for (const id of Array.from(live.keys())) {
    if (!version.has(id)) live.delete(id);
  }
  version.forEach((versionItem, id) => {
    if (!(versionItem instanceof Y.Map)) return;
    const liveItem = live.get(id);
    if (liveItem instanceof Y.Map) syncMap(liveItem, versionItem);
    else live.set(id, build(plainFields(versionItem)));
  });
}

/**
 * Makes `live` look like `version` by editing it: cards and edges set and
 * deleted, text diffed in. Replacing stored state instead would be undone
 * by the next client that syncs; an edit reaches every browser and vault.
 */
export function restoreCanvasInto(live: Y.Doc, version: Y.Doc, origin?: unknown): void {
  live.transact(() => {
    syncCollection(canvasNodes(live), canvasNodes(version), yNodeFrom);
    syncCollection(canvasEdges(live), canvasEdges(version), yEdgeFrom);
    syncMap(canvasMeta(live), canvasMeta(version));
  }, origin);
}
