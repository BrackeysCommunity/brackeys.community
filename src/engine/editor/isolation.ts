import { prefabSceneBounds } from "../collab/convert";
import type { KeyGen } from "../collab/keys";
import type { PrefabSource, SessionPrefabSource } from "../collab/prefab-source";
import type { AwarenessLike, ScenePresence } from "../collab/types";
import { makeIssue } from "../scene/issues";
import type { Bounds, Prefab } from "../scene/types";
import {
  createEditorSession,
  projectHistory,
  type EditorSession,
  type SessionHistory,
} from "./session";

export type PrefabIsolationOptions = {
  /**
   * The prefab was deleted (by a collaborator, an undo, the file); the
   * isolation has already closed itself.
   */
  onGone?: () => void;
  key?: KeyGen;
  issuesDebounceMs?: number;
  /** Presence in the prefab's doc; default the project session's awareness of that doc, when there is one. */
  awareness?: AwarenessLike;
  user?: ScenePresence["user"];
  /** Undo and history; default the project's (one stack with the scene) over a session source, else the doc's own. */
  history?: SessionHistory;
};

export type PrefabIsolation = {
  prefab: string;
  /** The scene's session the prefab was opened from. */
  scene: EditorSession;
  /** An editor on the prefab's own doc, at its local coordinates. */
  session: EditorSession;
  close(): void;
};

/**
 * The scene a prefab is edited in: the parent scene's size centred on the
 * prefab's origin, grown to hold its children and its instances' origins.
 */
export function isolationBounds(
  prefab: Prefab,
  parent: Bounds,
  registry: EditorSession["registry"],
): Bounds {
  return prefabSceneBounds(prefab, parent, registry);
}

const isSessionSource = (source: PrefabSource): source is SessionPrefabSource =>
  "session" in source && "docName" in source;

/**
 * Opens `prefab` for editing on its own: a session over the prefab's doc,
 * from the scene session's prefab source, read at its local coordinates
 * around the origin. Every edit lands in that doc, so each instance
 * follows and collaborators in the prefab see each other. The instances
 * it holds show resolved like a scene's, their children by `door-1/panel`;
 * an edit to one is an override in this prefab, and an instance that
 * would contain the prefab itself is refused with `prefab-cycle`. Ops that
 * only mean something in a scene, and children joining a group, are
 * refused with `op-invalid`. Null when the source has no such prefab to open.
 */
export async function openPrefabIsolation(
  scene: EditorSession,
  prefab: string,
  opts: PrefabIsolationOptions = {},
): Promise<PrefabIsolation | null> {
  const source = scene.prefabs;
  if (!source.library().has(prefab)) return null;
  const doc = await source.open(prefab);
  if (!doc || !source.library().has(prefab)) return null;
  const { registry } = scene;
  const parentBounds = scene.getDoc().bounds;

  const project = isSessionSource(source) ? source.session : null;
  const name = isSessionSource(source) ? source.docName(prefab) : null;
  const held = project && name ? project.get(name) : undefined;
  const history =
    opts.history ?? (project && name && held ? projectHistory(project, name) : undefined);
  const awareness = opts.awareness ?? held?.awareness;

  const local = createEditorSession({
    doc,
    origin: scene.origin,
    name: prefab,
    registry,
    prefabs: source,
    parentBounds,
    ...(project ? { project } : {}),
    ...(history ? { history } : {}),
    ...(awareness ? { awareness } : {}),
    ...(opts.user ? { user: opts.user } : {}),
    ...(opts.key ? { key: opts.key } : {}),
    ...(opts.issuesDebounceMs !== undefined ? { issuesDebounceMs: opts.issuesDebounceMs } : {}),
  });

  let closed = false;
  const unsubscribe = source.subscribe(() => {
    if (source.library().has(prefab)) return;
    close();
    opts.onGone?.();
  });

  function close() {
    if (closed) return;
    closed = true;
    unsubscribe();
    local.destroy();
  }

  const session: EditorSession = {
    ...local,
    dispatch(batch, dispatchOpts) {
      if (closed)
        return {
          ok: false,
          hash: local.getHash(),
          failedAt: 0,
          issue: makeIssue("op-invalid", {
            message: `${prefab} is no longer open.`,
            path: "/ops/0",
          }),
        };
      return local.dispatch(batch, dispatchOpts);
    },
    destroy: close,
  };

  return { prefab, scene, session, close };
}
