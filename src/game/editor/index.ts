/** @experimental The editor core: session, history, selection, outline, keymap and store, with no DOM or renderer. */
import { applyOps } from "../scene/ops";
import { createSessionWith, type EditorSession, type EditorSessionOptions } from "./session";

export function createEditorSession(opts: EditorSessionOptions): EditorSession {
  return createSessionWith({ ...opts, apply: opts.apply ?? applyOps });
}

export type {
  ApplyFn,
  DispatchOptions,
  EditorSession,
  EditorSessionEvent,
  EditorSessionOptions,
} from "./session";
export { labelFor } from "./session";
export { createHistory, type History, type HistoryEntry, type HistoryOptions } from "./history";
export { prune, remap, select, type SelectMode } from "./selection";
export {
  createEditorStore,
  type EditorMode,
  type EditorStoreState,
  type EditorTool,
} from "./store";
export { buildOutline, outlineOrder, type OutlineRow } from "./outline";
export {
  resolveEditorKey,
  type EditorCommand,
  type EditorKeyContext,
  type EditorKeyEvent,
} from "./keymap";
export { bulkRef, docRefs, isBulkRef, lookupRef, type RefTarget } from "./refs";

export type {
  ApplyOptions,
  ApplyResult,
  Behavior,
  BulkKey,
  EntityDef,
  OpBatch,
  Pt,
  Ref,
  SceneChange,
  SceneDefinition,
  SceneHash,
  SceneIssue,
  SceneOp,
  ShapeTuple,
} from "../scene/types";
