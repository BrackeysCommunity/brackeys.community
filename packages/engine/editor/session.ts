import type { Store } from "@tanstack/store";
import type * as Y from "yjs";

import { applyOpsToDoc, refsOfView, type DocApplyResult } from "../collab/apply";
import { readDoc, type DocView } from "../collab/convert";
import type { KeyGen } from "../collab/keys";
import { observeLog, readLog } from "../collab/log";
import { EMPTY_PREFAB_SOURCE, type PrefabSource } from "../collab/prefab-source";
import { observePeers, setPresence, type PeerPresence } from "../collab/presence";
import { observeProjectLog, historyRows, readProjectLog } from "../collab/project-log";
import type { ProjectSession } from "../collab/project-session";
import { revertEntry, revertOpenProjectEntry, type RevertResult } from "../collab/revert";
import type { AwarenessLike, LogEntry, SceneOrigin, ScenePresence } from "../collab/types";
import { createSceneUndo, type SelectionMeta } from "../collab/undo";
import type { UndoneStep } from "../collab/undo-coordinator";
import { issueEngine, watchIssues, type IssueProject } from "../collab/watch-issues";
import type { Registry } from "../game/types";
import { sceneHash } from "../scene/hash";
import { toSourceBatch } from "../scene/ops";
import { CHILD_SEPARATOR, parseChildRef, resolveScene } from "../scene/resolve";
import type {
  Bounds,
  OpBatch,
  PrefabLibrary,
  Pt,
  Ref,
  SceneDefinition,
  SceneHash,
} from "../scene/types";
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
  /**
   * Where instances' prefabs come from, and (when it has a writer) where
   * Apply to prefab, Create prefab and Unpack write. Default none, which
   * refuses those ops.
   */
  prefabs?: PrefabSource;
  /** On a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
  parentBounds?: Bounds;
  /** The project the doc belongs to (a `ProjectSession` fits); with it, issues include the doc's asset ids and settings resolve through its engine block. */
  project?: IssueProject;
};

/**
 * Undo and history kept somewhere other than the session's doc: a session
 * on a scratch doc whose batches are written through to another (a prefab
 * edited in isolation) undoes there, so one history covers both.
 */
export type SessionHistory = {
  state(): Pick<EditorStoreState, "canUndo" | "canRedo" | "undoLabel" | "redoLabel" | "history">;
  /** False when there was nothing to undo; the selection to restore when the step was this session's doc's. */
  undo(): boolean | SelectionMeta;
  redo(): boolean | SelectionMeta;
  revert(entryId: string): RevertResult;
  /** Ends the step a batch this session wrote to its own doc made; the session calls it after each one. */
  commit?(selection: SelectionMeta): void;
  /** Calls back whenever `state()` may have changed. */
  subscribe(listener: () => void): () => void;
};

/**
 * History backed by the project session's undo coordinator, for an editor
 * on one of its docs: undo steps back through this client's last step
 * wherever it was (`onUndone` hears of each, to say where), and the rows
 * are the doc's log merged with the project entries that name it. Open
 * `docName` in the project session first, and give the editor session the
 * project's origin. While subscribed, the docs those project entries wrote
 * stay open, so Revert can write them all.
 */
export function projectHistory(
  project: ProjectSession,
  docName: string,
  opts: { onUndone?: (step: UndoneStep, how: "undo" | "redo") => void } = {},
): SessionHistory {
  const open = project.get(docName);
  if (!open) throw new Error(`projectHistory: open "${docName}" in the project session first`);
  const { doc } = open;
  const rows = () => historyRows(readLog(doc), readProjectLog(project.projectDoc), docName);
  const step = (how: "undo" | "redo"): boolean | SelectionMeta => {
    const done = how === "undo" ? project.undo() : project.redo();
    if (!done) return false;
    opts.onUndone?.(done, how);
    if (done.refused !== undefined) return true;
    return done.selection?.doc === docName ? done.selection : true;
  };
  return {
    state() {
      const undoLabel = project.undoLabel();
      const redoLabel = project.redoLabel();
      return {
        canUndo: project.canUndo(),
        canRedo: project.canRedo(),
        ...(undoLabel === undefined ? {} : { undoLabel }),
        ...(redoLabel === undefined ? {} : { redoLabel }),
        history: rows(),
      };
    },
    undo: () => step("undo"),
    redo: () => step("redo"),
    revert(entryId) {
      const row = rows().find((r) => r.id === entryId);
      if (!row) return missingEntry(entryId);
      if (row.project) {
        const result = revertOpenProjectEntry(project, row.project.entry);
        return result.ok ? { ok: true, keys: result.keys } : result;
      }
      const result = revertEntry(
        doc,
        row,
        project.origin,
        open.layout ? { layout: open.layout } : {},
      );
      if (result.ok) project.commit({ docs: [docName], label: `Revert ${row.label}` });
      return result;
    },
    commit(selection) {
      project.commit({
        docs: [docName],
        label: selection.label ?? "Edit",
        selection: { ...selection, doc: docName },
      });
    },
    subscribe(listener) {
      const held = new Set<string>();
      let live = true;
      const hold = () => {
        for (const r of rows())
          for (const name of r.project?.docs ?? []) {
            if (name === docName || name === project.name || held.has(name)) continue;
            held.add(name);
            project.open(name).then(
              () => {
                if (!live) project.release(name);
              },
              () => held.delete(name),
            );
          }
      };
      const changed = () => {
        hold();
        listener();
      };
      hold();
      const offs = [
        project.subscribe((e) => {
          if (e.type === "history") listener();
        }),
        observeLog(doc, changed),
        observeProjectLog(project.projectDoc, changed),
      ];
      return () => {
        live = false;
        for (const off of offs) off();
        for (const name of held) if (project.get(name)) project.release(name);
      };
    },
  };
}

function missingEntry(entryId: string): RevertResult {
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
  /** The prefabs the session's source holds. */
  getPrefabs(): PrefabLibrary;
  /** Where the session's prefabs come from. */
  prefabs: PrefabSource;
  /** Set on a session over a prefab doc: the scene size its view centres on. */
  parentBounds?: Bounds;
  /** The project's game-settings `engine` block as it is now, which issues and physical checks resolve settings through; undefined outside a project. */
  engine(): Readonly<Record<string, unknown>> | undefined;
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
    case "transform": {
      const what = op.refs;
      const verb = op.turn !== undefined || op.rotate !== undefined ? "Turn" : "Flip";
      return what.length === 1 ? `${verb} ${what[0]}` : `${verb} ${what.length} items`;
    }
    case "reparent":
      return op.parent === null
        ? `Move ${many(op.refs.length, op.refs[0]!)} to the root`
        : `Put ${many(op.refs.length, op.refs[0]!)} under ${op.parent}`;
    case "setZ":
      return `Set z of ${many(op.refs.length, op.refs[0]!)}`;
    case "useAssets":
      return "Edit assets";
    case "paintCells":
      return `Paint ${op.ref}`;
    case "setPrefabBase":
      return op.base === null ? "Clear variant base" : `Make a variant of ${op.base}`;
    case "exposeParam":
      return op.param ? `Expose ${op.name}` : `Remove parameter ${op.name}`;
    case "setParam":
      return `Set ${op.ref}'s ${op.name}`;
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
  prefabs = EMPTY_PREFAB_SOURCE,
  parentBounds,
  project,
}: EditorSessionOptions): EditorSession {
  const listeners = new Set<(e: EditorSessionEvent) => void>();
  const undo = history ? null : createSceneUndo(doc, origin);
  let library = prefabs.library();
  let prefabSig = librarySig(library);
  const read = () =>
    readDoc(doc, { registry, prefabs: library, ...(parentBounds ? { parentBounds } : {}) });
  let view: DocView = read();
  let hash = sceneHash(view.def);
  let refByKey = refsOfView(view);
  let keyByRef = invert(refByKey);
  let resolved: SceneDefinition | null = null;
  const getResolved = () => (resolved ??= resolveScene(view.def, registry, library));
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

  const undoState = (): Partial<EditorStoreState> =>
    history
      ? history.state()
      : {
          canUndo: undo!.canUndo(),
          canRedo: undo!.canRedo(),
          undoLabel: undo!.undoLabel(),
          redoLabel: undo!.redoLabel(),
        };

  // A project's stack may already hold steps from a scene opened before this one.
  const store = createEditorStore({ sceneName: name, hash, history: readLog(doc), ...undoState() });

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
      prefabs,
      ...(parentBounds ? { parentBounds } : {}),
      ...(project ? { project } : {}),
    },
  );
  store.setState((s) => ({ ...s, issues: issues.flush() }));

  const onTransaction = (tr: Y.Transaction) => {
    library = prefabs.library();
    const sig = librarySig(library);
    const next = read();
    const changed = sceneHash(next.def);
    const log = readLog(doc);
    const logged = log.filter((e) => !seenLog.has(e.id));
    seenLog = new Set(log.map((e) => e.id));
    if (changed === hash && sig === prefabSig && logged.length === 0) return;
    prefabSig = sig;
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
  const unsubscribePrefabs = prefabs.subscribe(() => {
    library = prefabs.library();
    const sig = librarySig(library);
    if (sig === prefabSig) return;
    prefabSig = sig;
    if (view.kind === "prefab") {
      view = read();
      hash = sceneHash(view.def);
      refByKey = refsOfView(view);
      keyByRef = invert(refByKey);
    }
    resolved = null;
    selectedKeys = selectedKeys.filter(liveKey);
    syncUndo();
    if (source === "dispatch") return;
    for (const l of listeners)
      l({ doc: view.def, touched: [], source: source ?? "remote", logged: [] });
  });
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

  function restore(meta: SelectionMeta | boolean | null, side: "before" | "after") {
    if (typeof meta === "boolean") return meta;
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
    getPrefabs: () => library,
    prefabs,
    ...(parentBounds ? { parentBounds } : {}),
    engine: () => (project ? issueEngine(project) : undefined),
    getHash: () => hash,
    keyOf: keyOfRef,
    refOf: refOfKey,

    dispatch(given, opts = {}) {
      let batch = given;
      if (opts.resolved) {
        const mapped = toSourceBatch(view.def, given, registry, library);
        if (!mapped.ok) return { ok: false, hash, failedAt: 0, issue: mapped.issue };
        batch = mapped.batch;
      }
      const before = [...selectedKeys];
      let afterKeys: string[] | null = null;
      const result = local("dispatch", () =>
        applyOpsToDoc(doc, batch, origin, registry, {
          ...(key ? { key } : {}),
          label: labelFor(given),
          prefabs: library,
          ...(prefabs.writer ? { prefabWriter: prefabs.writer } : {}),
          ...(parentBounds ? { parentBounds } : {}),
        }),
      );
      if (!result.ok) return result;
      if (opts.selectionAfter) afterKeys = keysOf(opts.selectionAfter);
      selectedKeys = afterKeys ?? selectedKeys.filter(liveKey);
      const step = { before, after: [...selectedKeys], label: labelFor(given) };
      if (undo) undo.commit(step);
      else history?.commit?.(step);
      syncUndo({ issues: result.issues, lastActor: origin });
      publish({});
      for (const l of listeners)
        l({ doc: view.def, touched: [...result.touched], source: "dispatch", logged: [] });
      return result;
    },

    undo: () =>
      restore(
        local("undo", () => (history ? history.undo() : undo!.undo())),
        "before",
      ),
    redo: () =>
      restore(
        local("redo", () => (history ? history.redo() : undo!.redo())),
        "after",
      ),

    revert(entryId) {
      if (history) return history.revert(entryId);
      const entry = readLog(doc).find((e) => e.id === entryId);
      if (!entry) return missingEntry(entryId);
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
      unsubscribePrefabs();
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
