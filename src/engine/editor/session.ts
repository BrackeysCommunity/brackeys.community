import type { Store } from "@tanstack/store";
import type * as Y from "yjs";

import { applyOpsToDoc, refsOfView, type DocApplyResult } from "../collab/apply";
import { readDoc, type DocView } from "../collab/convert";
import type { KeyGen } from "../collab/keys";
import { observeLog, readLog } from "../collab/log";
import { observePeers, setPresence, type PeerPresence } from "../collab/presence";
import { revertEntry, type RevertResult } from "../collab/revert";
import type { AwarenessLike, LogEntry, SceneOrigin, ScenePresence } from "../collab/types";
import { createSceneUndo } from "../collab/undo";
import { watchIssues } from "../collab/watch-issues";
import type { Registry } from "../game/types";
import { sceneHash } from "../scene/hash";
import { toSourceBatch } from "../scene/ops";
import { CHILD_SEPARATOR, parseChildRef, resolveScene } from "../scene/resolve";
import type { OpBatch, PrefabLibrary, Pt, Ref, SceneDefinition, SceneHash } from "../scene/types";
import { select as nextSelection, type SelectMode } from "./selection";
import { createEditorStore, type EditorMode, type EditorStoreState } from "./store";

export type EditorSessionEvent = {
  doc: SceneDefinition;
  /** Refs of the new document that changed; empty for a remote or undo change, which may touch anything. */
  touched: Ref[];
  source: "dispatch" | "undo" | "redo" | "remote";
  /** History entries the change added, oldest first. */
  logged: LogEntry[];
};

export type EditorSessionOptions = {
  /** The shared document; a provider (or a test) keeps it in sync with everyone else's. */
  doc: Y.Doc;
  /** This client's origin. Undo tracks this object, so pass the same one for the session's life. */
  origin: SceneOrigin;
  name: string;
  /** The types, bulk keys and settings the document is edited against. */
  registry: Registry;
  /** Presence; without it the session is local-only. */
  awareness?: AwarenessLike;
  /** How this client appears to others. */
  user?: ScenePresence["user"];
  key?: KeyGen;
  /** Validation after remote changes waits this long for them to settle. Default 150ms. */
  issuesDebounceMs?: number;
  /** Undo, redo, revert and the history list from elsewhere; the doc's own by default. */
  history?: SessionHistory;
};

/**
 * Undo and history kept somewhere other than the session's doc: a session
 * on a scratch doc whose batches are written through to another (a prefab
 * edited in isolation) undoes there, so one history covers both.
 */
export type SessionHistory = {
  state(): Pick<EditorStoreState, "canUndo" | "canRedo" | "undoLabel" | "redoLabel" | "history">;
  undo(): boolean;
  redo(): boolean;
  revert(entryId: string): RevertResult;
  /** Calls back whenever `state()` may have changed. */
  subscribe(listener: () => void): () => void;
};

export type DispatchOptions = {
  /** Default: the current selection, minus what the batch removed; renames and shifted indices are followed. */
  selectionAfter?: Ref[];
  /**
   * The batch was written against `getResolved()` (world coordinates,
   * instance children as `gate-3/door`); it is mapped onto the document
   * with `toSourceBatch` first.
   */
  resolved?: boolean;
};

export type EditorSession = {
  registry: Registry;
  store: Store<EditorStoreState>;
  doc: Y.Doc;
  origin: SceneOrigin;
  getDoc(): SceneDefinition;
  /** The document's resolved view: instances inlined, group offsets applied. What tools draw and pick. */
  getResolved(): SceneDefinition;
  /** The prefabs the doc holds. */
  getPrefabs(): PrefabLibrary;
  getHash(): SceneHash;
  /**
   * The doc key behind a ref, and back; keys stay put while bulk refs shift.
   * An instance child's key is its instance's key, a slash, and the child's
   * id in the prefab.
   */
  keyOf(ref: Ref): string | undefined;
  refOf(key: string): Ref | undefined;
  dispatch(batch: OpBatch, opts?: DispatchOptions): DocApplyResult;
  /** Undoes this client's last batch only; false when there is none. */
  undo(): boolean;
  redo(): boolean;
  /** Applies a history entry's inverse as a new batch from this client. */
  revert(entryId: string): RevertResult;
  select(refs: Ref[], mode?: SelectMode, order?: readonly Ref[]): void;
  setMode(mode: EditorMode): void;
  /** Presence fields besides selection and mode, which the session publishes itself. */
  setCursor(at: Pt | undefined): void;
  setTool(tool: string): void;
  setGhost(ghost: ScenePresence["ghost"]): void;
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
      return `Add ${op.entity.id ?? op.entity.type}`;
    case "addBulk":
      return `Add ${"points" in op ? op.points.length : op.shapes.length} ${op.key}`;
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
    case "setScene":
      return "Edit scene";
    case "setSettings":
      return "Edit settings";
    case "reorder":
      return `Reorder ${many(op.refs.length, op.refs[0]!)}`;
    case "instantiate":
      return `Place ${op.instance.id ?? op.instance.prefab}`;
    case "setGroup":
      return op.remove ? `Delete group ${op.id}` : `Edit group ${op.id}`;
    case "override":
      return `Override ${op.ref}`;
    case "revertOverride":
      return op.paths ? `Revert ${op.ref}'s overrides` : `Revert all of ${op.ref}`;
    case "applyToPrefab":
      return `Apply ${op.ref} to its prefab`;
    case "unpack":
      return `Unpack ${op.ref}`;
    case "createPrefab":
      return `Create prefab ${op.id}`;
    case "definePrefab":
      return op.prefab ? `Edit prefab ${op.id}` : `Delete prefab ${op.id}`;
  }
}

/**
 * An editor on a shared `Y.Doc`. Every batch goes through `applyOpsToDoc`
 * with this client's origin; undo and redo step only this client's
 * batches; history is the doc's `log`, so it names every actor, remote
 * ones included. Selection is kept as doc keys, so it survives other
 * people's edits shifting bulk refs.
 */
export function createEditorSession({
  doc,
  origin,
  name,
  registry,
  awareness,
  user,
  key,
  issuesDebounceMs,
  history,
}: EditorSessionOptions): EditorSession {
  const listeners = new Set<(e: EditorSessionEvent) => void>();
  const undo = history ? null : createSceneUndo(doc, origin);
  let view: DocView = readDoc(doc);
  let hash = sceneHash(view.def);
  let refByKey = refsOfView(view);
  let keyByRef = invert(refByKey);
  let resolved: SceneDefinition | null = null;
  let prefabSig = librarySig(view.prefabs);
  const getResolved = () => (resolved ??= resolveScene(view.def, registry, view.prefabs));
  const keyOfRef = (ref: Ref): string | undefined => {
    const child = parseChildRef(ref);
    if (!child) return keyByRef.get(ref);
    const base = keyByRef.get(child.instance);
    return base === undefined ? undefined : `${base}${CHILD_SEPARATOR}${child.child}`;
  };
  const refOfKey = (key: string): Ref | undefined => {
    const at = key.indexOf(CHILD_SEPARATOR);
    if (at < 0) return refByKey.get(key);
    const base = refByKey.get(key.slice(0, at));
    return base === undefined ? undefined : `${base}${key.slice(at)}`;
  };
  const liveKey = (key: string) => {
    const at = key.indexOf(CHILD_SEPARATOR);
    return refByKey.has(at < 0 ? key : key.slice(0, at));
  };
  let selectedKeys: string[] = [];
  let source: EditorSessionEvent["source"] | null = null;
  let seenLog = new Set(readLog(doc).map((e) => e.id));
  let mode: EditorMode = "edit";

  const store = createEditorStore({
    sceneName: name,
    hash,
    history: history ? history.state().history : readLog(doc),
  });

  const undoState = (): Partial<EditorStoreState> =>
    history
      ? history.state()
      : {
          canUndo: undo!.canUndo(),
          canRedo: undo!.canRedo(),
          undoLabel: undo!.undoLabel(),
          redoLabel: undo!.redoLabel(),
        };

  const refsOf = (keys: readonly string[]) =>
    keys.map((k) => refOfKey(k)).filter((r): r is Ref => r !== undefined);
  const keysOf = (refs: readonly Ref[]) =>
    refs.map((r) => keyOfRef(r)).filter((k): k is string => k !== undefined);

  const syncUndo = (patch: Partial<EditorStoreState> = {}) =>
    store.setState((s) => ({
      ...s,
      hash,
      ...undoState(),
      selection: refsOf(selectedKeys),
      ...patch,
    }));

  const publish = (patch: Partial<ScenePresence>) => {
    if (!awareness) return;
    setPresence(awareness, {
      ...(user ? { user } : {}),
      selection: selectedKeys,
      mode,
      ...patch,
    });
  };

  const issues = watchIssues(
    doc,
    registry,
    (next) => store.setState((s) => ({ ...s, issues: next })),
    {
      debounceMs: issuesDebounceMs,
    },
  );
  store.setState((s) => ({ ...s, issues: issues.flush() }));

  const onTransaction = (tr: Y.Transaction) => {
    const next = readDoc(doc);
    const changed = sceneHash(next.def);
    const log = readLog(doc);
    const logged = log.filter((e) => !seenLog.has(e.id));
    seenLog = new Set(log.map((e) => e.id));
    const library = librarySig(next.prefabs);
    if (changed === hash && library === prefabSig && logged.length === 0) return;
    prefabSig = library;
    view = next;
    hash = changed;
    resolved = null;
    refByKey = refsOfView(view);
    keyByRef = invert(refByKey);
    selectedKeys = selectedKeys.filter(liveKey);
    const lastActor = logged.length > 0 ? logged[logged.length - 1]!.actor : undefined;
    syncUndo({ ...(history ? {} : { history: log }), ...(lastActor ? { lastActor } : {}) });
    // A dispatch or revert reports itself once it knows what it touched.
    if (source === "dispatch") return;
    const kind = source ?? (undo && tr.origin === undo.manager ? "undo" : "remote");
    for (const l of listeners) l({ doc: view.def, touched: [], source: kind, logged });
  };
  doc.on("afterTransaction", onTransaction);
  const unobserveLog = history
    ? history.subscribe(() => syncUndo())
    : observeLog(doc, (log) => store.setState((s) => ({ ...s, history: log })));
  const unobservePeers = awareness
    ? observePeers(awareness, (peers: PeerPresence[]) => store.setState((s) => ({ ...s, peers })))
    : () => {};
  publish({});

  /** Runs a local write with its event marked as `kind`, then reports what it touched. */
  function local<T>(kind: EditorSessionEvent["source"], write: () => T): T {
    source = kind;
    try {
      return write();
    } finally {
      source = null;
    }
  }

  function restore(meta: { before: string[]; after: string[] } | null, side: "before" | "after") {
    if (!meta) return false;
    selectedKeys = meta[side].filter(liveKey);
    syncUndo();
    publish({});
    return true;
  }

  return {
    registry,
    store,
    doc,
    origin,
    getDoc: () => view.def,
    getResolved,
    getPrefabs: () => view.prefabs,
    getHash: () => hash,
    keyOf: keyOfRef,
    refOf: refOfKey,

    dispatch(given, opts = {}) {
      let batch = given;
      if (opts.resolved) {
        const mapped = toSourceBatch(view.def, given, registry, view.prefabs);
        if (!mapped.ok) return { ok: false, hash, failedAt: 0, issue: mapped.issue };
        batch = mapped.batch;
      }
      const before = [...selectedKeys];
      let afterKeys: string[] | null = null;
      const result = local("dispatch", () =>
        applyOpsToDoc(doc, batch, origin, registry, {
          ...(key ? { key } : {}),
          label: labelFor(given),
        }),
      );
      if (!result.ok) return result;
      if (opts.selectionAfter) afterKeys = keysOf(opts.selectionAfter);
      selectedKeys = afterKeys ?? selectedKeys.filter(liveKey);
      undo?.commit({ before, after: [...selectedKeys], label: labelFor(given) });
      syncUndo({ issues: result.issues, lastActor: origin });
      publish({});
      for (const l of listeners)
        l({ doc: view.def, touched: [...result.touched], source: "dispatch", logged: [] });
      return result;
    },

    undo: () =>
      history
        ? history.undo()
        : restore(
            local("undo", () => undo!.undo()),
            "before",
          ),
    redo: () =>
      history
        ? history.redo()
        : restore(
            local("redo", () => undo!.redo()),
            "after",
          ),

    revert(entryId) {
      if (history) return history.revert(entryId);
      const entry = readLog(doc).find((e) => e.id === entryId);
      if (!entry) {
        return {
          ok: false,
          issue: {
            severity: "error",
            code: "ref-not-found",
            message: `No history entry ${entryId}; it may have aged out of the log.`,
            entityIds: [],
          },
        };
      }
      const before = [...selectedKeys];
      const result = local("dispatch", () => revertEntry(doc, entry, origin));
      if (!result.ok) return result;
      undo!.commit({ before, after: [...selectedKeys], label: `Revert ${entry.label}` });
      syncUndo();
      for (const l of listeners) l({ doc: view.def, touched: [], source: "dispatch", logged: [] });
      return result;
    },

    select(refs, selectMode = "replace", order) {
      const next = nextSelection(refsOf(selectedKeys), refs, selectMode, order);
      selectedKeys = keysOf(next);
      store.setState((s) => ({ ...s, selection: refsOf(selectedKeys) }));
      publish({});
    },

    setMode(next) {
      mode = next;
      store.setState((s) => ({ ...s, mode: next }));
      publish({});
    },
    setCursor: (cursor) => publish({ cursor }),
    setTool: (tool) => publish({ tool }),
    setGhost: (ghost) => publish({ ghost }),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy() {
      listeners.clear();
      doc.off("afterTransaction", onTransaction);
      unobserveLog();
      unobservePeers();
      issues.stop();
      undo?.destroy();
    },
  };
}

const librarySig = (prefabs: PrefabLibrary) => JSON.stringify([...prefabs]);

function invert(m: Map<string, Ref>): Map<Ref, string> {
  const out = new Map<Ref, string>();
  // With duplicate ids (a merge), the first in document order answers for the ref.
  for (const [k, r] of m) if (!out.has(r)) out.set(r, k);
  return out;
}
