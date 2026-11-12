import * as Y from "yjs";

import { contentMaps } from "./convert";
import type { SceneOrigin } from "./types";

/** The selection before and after a step, kept on its stack item so undo and redo restore it. */
export type SelectionMeta = { before: string[]; after: string[]; label?: string };

export type SceneUndo = {
  manager: Y.UndoManager;
  /**
   * Marks the end of one batch, recording the selection around it. Call after
   * every write from this client's origin, so one batch is one step.
   */
  commit(selection: SelectionMeta): void;
  /** Undoes this client's last batch; returns the selection to restore, or null when there's nothing to undo. */
  undo(): SelectionMeta | null;
  redo(): SelectionMeta | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** The label of the step undo or redo would take next. */
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  destroy(): void;
};

const SELECTION = "selection";

/**
 * A `Y.UndoManager` over the scene's maps (`contentMaps`) that tracks only
 * `origin` (compared by identity, so pass the same object to every write),
 * so undo never reverts a collaborator's, an agent's or the disk's change.
 * One batch is one step: `captureTimeout` is 0 and `commit` stops capturing.
 * The `log` isn't in scope, so undoing a batch leaves its history row.
 */
export function createSceneUndo(doc: Y.Doc, origin: SceneOrigin): SceneUndo {
  const manager = new Y.UndoManager(contentMaps(doc), {
    trackedOrigins: new Set([origin]),
    captureTimeout: 0,
  });
  const metaOf = (item: { meta: Map<string, unknown> } | undefined): SelectionMeta =>
    (item?.meta.get(SELECTION) as SelectionMeta | undefined) ?? { before: [], after: [] };

  const pop = (stack: "undo" | "redo"): SelectionMeta | null => {
    const from = stack === "undo" ? manager.undoStack : manager.redoStack;
    const to = stack === "undo" ? manager.redoStack : manager.undoStack;
    const meta = metaOf(from[from.length - 1]);
    const item = stack === "undo" ? manager.undo() : manager.redo();
    if (!item) return null;
    to[to.length - 1]?.meta.set(SELECTION, meta);
    return meta;
  };

  return {
    manager,
    commit(selection) {
      const last = manager.undoStack[manager.undoStack.length - 1];
      if (last && !last.meta.has(SELECTION)) last.meta.set(SELECTION, selection);
      manager.stopCapturing();
    },
    undo: () => pop("undo"),
    redo: () => pop("redo"),
    canUndo: () => manager.undoStack.length > 0,
    canRedo: () => manager.redoStack.length > 0,
    undoLabel: () => metaOf(manager.undoStack[manager.undoStack.length - 1]).label,
    redoLabel: () => metaOf(manager.redoStack[manager.redoStack.length - 1]).label,
    destroy: () => manager.destroy(),
  };
}
