import type { Store } from "@tanstack/store";

import { usesBulkRefs } from "../scene/ops-schema";
import type {
  ApplyOptions,
  ApplyResult,
  OpBatch,
  Ref,
  SceneDefinition,
  SceneHash,
} from "../scene/types";
import { createHistory, type History } from "./history";
import { docRefs } from "./refs";
import { prune, remap, select as nextSelection, type SelectMode } from "./selection";
import { createEditorStore, type EditorMode, type EditorStoreState } from "./store";

export type ApplyFn = (def: SceneDefinition, batch: OpBatch, opts?: ApplyOptions) => ApplyResult;

export type EditorSessionEvent = {
  doc: SceneDefinition;
  touched: Ref[];
  source: "dispatch" | "undo" | "redo" | "replace";
};

export type EditorSessionOptions = {
  doc: SceneDefinition;
  name: string;
  /** Default `applyOps`, supplied by the entry so this module never loads the scene code it wraps. */
  apply?: ApplyFn;
  now?: () => number;
  /** History length cap and coalescing window. */
  cap?: number;
  coalesceMs?: number;
};

export type DispatchOptions = {
  /** Default "human". */
  actor?: string;
  /** Default: the current selection, minus refs the batch removed, following renames and shifts. */
  selectionAfter?: Ref[];
};

export type EditorSession = {
  store: Store<EditorStoreState>;
  history: History;
  getDoc(): SceneDefinition;
  getHash(): SceneHash;
  dispatch(batch: OpBatch, opts?: DispatchOptions): ApplyResult;
  undo(): ApplyResult | null;
  redo(): ApplyResult | null;
  select(refs: Ref[], mode?: SelectMode, order?: readonly Ref[]): void;
  markSaved(): void;
  /** Swaps in a document from outside (a reload from disk) and clears history. */
  replaceDoc(doc: SceneDefinition): void;
  setMode(mode: EditorMode): void;
  subscribe(listener: (e: EditorSessionEvent) => void): () => void;
  destroy(): void;
};

/** A history label for batches that don't bring their own. */
export function labelFor(batch: OpBatch): string {
  if (batch.label) return batch.label;
  if (batch.ops.length !== 1) return `${batch.ops.length} edits`;
  const op = batch.ops[0]!;
  const many = (n: number, one: string) => (n === 1 ? one : `${n} entities`);
  switch (op.op) {
    case "add":
      return `Add ${op.entity.id ?? op.entity.b}`;
    case "addBulk":
      return `Add ${op.key === "anchor" ? op.points.length : op.shapes.length} ${op.key}`;
    case "update":
      return `Edit ${op.ref}`;
    case "move":
      return `Move ${many(op.refs.length, op.refs[0]!)}`;
    case "place":
      return `Place ${op.ref}`;
    case "remove":
      return `Delete ${many(op.refs.length, op.refs[0]!)}`;
    case "rename":
      return `Rename ${op.from} to ${op.to}`;
    case "promote":
      return `Promote ${op.ref} to ${op.id}`;
    case "demote":
      return `Demote ${op.id}`;
    case "setSpawn":
      return "Set spawn";
    case "removeSpawn":
      return "Remove spawn";
    case "setScene":
      return "Edit scene";
  }
}

export function createSessionWith({
  doc: initial,
  name,
  apply,
  now = () => Date.now(),
  cap,
  coalesceMs,
}: EditorSessionOptions & { apply: ApplyFn }): EditorSession {
  const history = createHistory({ cap, coalesceMs, now });
  const listeners = new Set<(e: EditorSessionEvent) => void>();
  let doc = initial;
  const probe = apply(doc, { ops: [] });
  let hash = probe.hash;

  const store = createEditorStore({
    sceneName: name,
    hash,
    issues: probe.ok ? probe.issues : [probe.issue],
  });

  const sync = (patch: Partial<EditorStoreState> = {}) =>
    store.setState((s) => ({
      ...s,
      hash,
      dirty: history.isDirty(),
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      undoLabel: history.undoLabel(),
      redoLabel: history.redoLabel(),
      ...patch,
    }));

  const emit = (e: EditorSessionEvent) => {
    for (const l of listeners) l(e);
  };

  const rebase = (batch: OpBatch): OpBatch =>
    usesBulkRefs(batch) ? { ...batch, base: hash } : batch;

  const replay = (batch: OpBatch, selection: Ref[], source: "undo" | "redo"): ApplyResult => {
    const result = apply(doc, rebase(batch));
    if (!result.ok) return result;
    doc = result.def;
    hash = result.hash;
    if (source === "undo") history.undo();
    else history.redo();
    sync({ selection: prune(selection, docRefs(doc)), issues: result.issues });
    emit({ doc, touched: result.touched, source });
    return result;
  };

  return {
    store,
    history,
    getDoc: () => doc,
    getHash: () => hash,

    dispatch(batch, opts = {}) {
      const actor = opts.actor ?? batch.actor ?? "human";
      const sent: OpBatch = { ...batch, actor };
      if (sent.base === undefined && usesBulkRefs(sent)) sent.base = hash;
      const result = apply(doc, sent);
      if (!result.ok) return result;

      const before = store.state.selection;
      const after = opts.selectionAfter ?? prune(remap(before, result.remap), docRefs(result.def));

      doc = result.def;
      hash = result.hash;
      history.push({
        label: labelFor(sent),
        batch: sent,
        inverse: result.inverse,
        touched: result.touched,
        selectionBefore: before,
        selectionAfter: after,
        actor,
      });
      sync({ selection: after, issues: result.issues, lastActor: actor });
      emit({ doc, touched: result.touched, source: "dispatch" });
      return result;
    },

    undo() {
      const entry = history.peekUndo();
      return entry ? replay(entry.inverse, entry.selectionBefore, "undo") : null;
    },

    redo() {
      const entry = history.peekRedo();
      return entry ? replay(entry.batch, entry.selectionAfter, "redo") : null;
    },

    select(refs, mode = "replace", order) {
      store.setState((s) => ({ ...s, selection: nextSelection(s.selection, refs, mode, order) }));
    },

    markSaved() {
      history.markSaved();
      sync({ savedAt: now() });
    },

    replaceDoc(next) {
      doc = next;
      const result = apply(doc, { ops: [] });
      hash = result.hash;
      history.clear();
      sync({
        selection: prune(store.state.selection, docRefs(doc)),
        issues: result.ok ? result.issues : [result.issue],
        savedAt: now(),
      });
      emit({ doc, touched: [], source: "replace" });
    },

    setMode(mode) {
      store.setState((s) => ({ ...s, mode }));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy() {
      listeners.clear();
    },
  };
}
