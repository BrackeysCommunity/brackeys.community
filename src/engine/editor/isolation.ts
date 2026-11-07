import { applyOpsToDoc, type DocApplyResult } from "../collab/apply";
import { sceneToDoc } from "../collab/convert";
import type { KeyGen } from "../collab/keys";
import { diffToOps } from "../scene/diff-to-ops";
import { formatPrefab } from "../scene/format";
import { FRAGMENT_KIND, fragmentBounds } from "../scene/fragment";
import { makeIssue } from "../scene/issues";
import { prefabBody, prefabOf, prefabScene, sceneBody } from "../scene/prefab";
import type { Bounds, Prefab, PrefabBody, SceneOp } from "../scene/types";
import { createEditorSession, labelFor, type EditorSession, type SessionHistory } from "./session";

/** Ops that only mean something in a scene, so editing a prefab in isolation refuses them. */
const SCENE_ONLY: Readonly<Partial<Record<SceneOp["op"], true>>> = {
  setScene: true,
  setSettings: true,
  instantiate: true,
  setGroup: true,
  override: true,
  revertOverride: true,
  applyToPrefab: true,
  unpack: true,
  createPrefab: true,
  definePrefab: true,
};

/** Room around a prefab's children in its isolation scene. */
const MARGIN = 64;

export type PrefabIsolationOptions = {
  /**
   * The prefab was deleted from the scene's doc (by a collaborator, an
   * undo, the file); the isolation has already closed itself.
   */
  onGone?: () => void;
  key?: KeyGen;
  issuesDebounceMs?: number;
};

export type PrefabIsolation = {
  prefab: string;
  /** The scene's session, which every batch made here is written through to. */
  scene: EditorSession;
  /** An editor on the prefab as a scene of its own, at its local coordinates. */
  session: EditorSession;
  close(): void;
};

/**
 * The scene an isolation edits in: the parent scene's size centred on the
 * prefab's origin, grown to hold its children.
 */
export function isolationBounds(
  prefab: Prefab,
  parent: Bounds,
  registry: EditorSession["registry"],
): Bounds {
  const w = parent[2] - parent[0];
  const h = parent[3] - parent[1];
  const out: Bounds = [-Math.floor(w / 2), -Math.floor(h / 2), Math.ceil(w / 2), Math.ceil(h / 2)];
  const box = fragmentBounds(
    {
      kind: FRAGMENT_KIND,
      v: prefab.v,
      entities: prefab.entities,
      ...(prefab.bulk ? { bulk: prefab.bulk } : {}),
    },
    registry,
  );
  if (!box) return out;
  return [
    Math.min(out[0], Math.floor(box.minX) - MARGIN),
    Math.min(out[1], Math.floor(box.minY) - MARGIN),
    Math.max(out[2], Math.ceil(box.maxX) + MARGIN),
    Math.max(out[3], Math.ceil(box.maxY) + MARGIN),
  ];
}

/**
 * Opens `prefab` for editing on its own: a scratch doc seeded with
 * `prefabScene`, and a session on it whose every batch lands in the scene's
 * doc as one `definePrefab` from `scene`, so every instance follows and the
 * scene's history holds the edit. Undo and redo step the scene's history,
 * back through the edits made in this isolation only. Changes to the prefab
 * from anywhere else (a collaborator, an undo, the file) are diffed onto the
 * scratch doc. Null when the scene holds no such prefab.
 */
export function openPrefabIsolation(
  scene: EditorSession,
  prefab: string,
  opts: PrefabIsolationOptions = {},
): PrefabIsolation | null {
  const seed = scene.getPrefabs().get(prefab);
  if (!seed) return null;
  const { registry } = scene;
  const bounds = isolationBounds(seed, scene.getDoc().bounds, registry);
  const game = seed.game;
  const sceneOf = (p: Prefab) => prefabScene({ ...p, game }, bounds);
  const text = (body: PrefabBody) => formatPrefab(prefabOf(prefab, body));
  /** The scratch doc's children as `current`'s body, and whether they already match it. */
  const compare = (current: Prefab) => {
    const body = sceneBody(local.getDoc(), registry, current.contract);
    return { body, same: text(body) === text(prefabBody(current)) };
  };
  const doc = sceneToDoc(sceneOf(seed), opts.key ? { key: opts.key } : {});

  let undoable = 0;
  let redoable = 0;
  let closed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  const history: SessionHistory = {
    state() {
      const s = scene.store.state;
      const canUndo = undoable > 0 && s.canUndo;
      const canRedo = redoable > 0 && s.canRedo;
      return {
        canUndo,
        canRedo,
        ...(canUndo && s.undoLabel !== undefined ? { undoLabel: s.undoLabel } : {}),
        ...(canRedo && s.redoLabel !== undefined ? { redoLabel: s.redoLabel } : {}),
        history: s.history,
      };
    },
    undo() {
      if (undoable === 0 || !scene.undo()) return false;
      undoable--;
      redoable++;
      notify();
      return true;
    },
    redo() {
      if (redoable === 0 || !scene.redo()) return false;
      redoable--;
      undoable++;
      notify();
      return true;
    },
    revert(entryId) {
      const result = scene.revert(entryId);
      if (result.ok) {
        undoable++;
        redoable = 0;
        notify();
      }
      return result;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const local = createEditorSession({
    doc,
    origin: scene.origin,
    name: prefab,
    registry,
    history,
    ...(opts.key ? { key: opts.key } : {}),
    ...(opts.issuesDebounceMs !== undefined ? { issuesDebounceMs: opts.issuesDebounceMs } : {}),
  });

  /** Brings the scratch doc to the scene's copy of the prefab; false when it's gone. */
  function follow(): boolean {
    const current = scene.getPrefabs().get(prefab);
    if (!current) return false;
    if (compare(current).same) return true;
    const batch = diffToOps(local.getDoc(), sceneOf(current), registry);
    if (batch.ops.length > 0) {
      applyOpsToDoc(doc, batch, scene.origin, registry, {
        noLog: true,
        ...(opts.key ? { key: opts.key } : {}),
      });
    }
    return true;
  }

  const unsubscribeScene = scene.subscribe(() => {
    if (!follow()) {
      close();
      opts.onGone?.();
    }
  });
  const unsubscribeStore = scene.store.subscribe(notify);

  function close() {
    if (closed) return;
    closed = true;
    unsubscribeScene();
    unsubscribeStore();
    listeners.clear();
    local.destroy();
    doc.destroy();
  }

  const refuse = (at: number, message: string): DocApplyResult => ({
    ok: false,
    hash: local.getHash(),
    failedAt: at,
    issue: makeIssue("op-invalid", { message, path: `/ops/${at}` }),
  });

  const session: EditorSession = {
    ...local,
    dispatch(batch, dispatchOpts) {
      if (closed) return refuse(0, `${prefab} is no longer open.`);
      const at = batch.ops.findIndex((op) => SCENE_ONLY[op.op]);
      if (at >= 0) {
        return refuse(at, `${batch.ops[at]!.op} only works in a scene, not inside a prefab.`);
      }
      const result = local.dispatch(batch, dispatchOpts);
      if (!result.ok) return result;
      if (local.getDoc().entities?.some((e) => e.group !== undefined)) {
        follow();
        return refuse(0, "A prefab's children can't join a group; an instance takes its group.");
      }
      const current = scene.getPrefabs().get(prefab);
      if (!current) return result;
      const { body, same } = compare(current);
      if (same) return result;
      const written = scene.dispatch({
        ops: [{ op: "definePrefab", id: prefab, prefab: body }],
        label: `${labelFor(batch)} in ${prefab}`,
      });
      if (!written.ok) {
        follow();
        return { ok: false, hash: local.getHash(), failedAt: 0, issue: written.issue };
      }
      undoable++;
      redoable = 0;
      notify();
      return result;
    },
    destroy: close,
  };

  return { prefab, scene, session, close };
}
