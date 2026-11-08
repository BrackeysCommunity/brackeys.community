import { Store } from "@tanstack/store";
import { useEffect, useState } from "react";

import type { ProjectSession, SessionDoc } from "../../collab/index";
import { SCENE_KIND_NAME, type AssetEntry, type ProjectView } from "../../project/index";
import type { ProjectConnection, ProjectConnectionStatus } from "../host";
import { useStoreValue } from "../session/use-store-value";

/**
 * `connecting` until the project and the scene's doc have synced, then
 * `live`; `reconnecting` while the socket is down, or `offline` while the
 * browser is; `failed` when the project or the scene couldn't be opened.
 */
export type SceneDocStatus = "connecting" | "live" | "reconnecting" | "offline" | "failed";

/** The scene doc an editor edits, held open in its project session. */
export type OpenSceneDoc = {
  session: ProjectSession;
  /** The doc's name in the session. */
  name: string;
  /** The scene's asset id. */
  id: string;
  doc: SessionDoc;
};

/** The scene asked for wasn't in the project, so another was opened in its place. */
export type SceneFallback = { wanted: string; opened: string };

export type SceneDocState = {
  status: SceneDocStatus;
  ready: OpenSceneDoc | null;
  error: Error | null;
  /** Set while the open scene isn't the one asked for. */
  fellBack: SceneFallback | null;
};

/** What the link follows: a project connection, or anything with its state. */
export type SceneDocSource = Pick<ProjectConnection, "getState" | "subscribe">;

export type SceneDocLink = {
  getState(): SceneDocState;
  subscribe(listener: () => void): () => void;
  destroy(): void;
};

const EMPTY: SceneDocState = { status: "connecting", ready: null, error: null, fellBack: null };

const byPath = (a: AssetEntry, b: AssetEntry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The scene an editor opens: `wanted` when the project holds a live scene of that id, else its first scene by path. */
export function pickScene(view: ProjectView, wanted?: string | null): AssetEntry | null {
  const named = wanted ? view.byId.get(wanted) : undefined;
  if (named?.kind === SCENE_KIND_NAME) return named;
  return [...view.byId.values()].filter((e) => e.kind === SCENE_KIND_NAME).sort(byPath)[0] ?? null;
}

const WAITING: Partial<Record<ProjectConnectionStatus, SceneDocStatus>> = {
  reconnecting: "reconnecting",
  offline: "offline",
  failed: "failed",
};

/**
 * Holds one scene of a project session open. The doc is the session's, so
 * a dropped socket reconnects it in place (the server resumes it from its
 * persisted state) and `ready` keeps the same doc throughout; only a new
 * session opens the scene again.
 */
export function createSceneDocLink({
  source,
  scene,
}: {
  source: SceneDocSource;
  /** The scene's id; the project's first scene, reported in `fellBack`, when it holds none of that id. */
  scene?: string | null;
}): SceneDocLink {
  const listeners = new Set<() => void>();
  let state: SceneDocState = EMPTY;
  let session: ProjectSession | null = null;
  let held: string | null = null;
  let opening: OpenSceneDoc | Error | null = null;
  let destroyed = false;

  const emit = (next: SceneDocState) => {
    if (
      next.status === state.status &&
      next.ready === state.ready &&
      next.error === state.error &&
      next.fellBack === state.fellBack
    )
      return;
    state = next;
    for (const l of listeners) l();
  };

  const release = () => {
    if (session && held) session.release(held);
    held = null;
    opening = null;
  };

  function open(current: ProjectSession) {
    const entry = pickScene(current.view(), scene);
    const name = entry && current.docNameFor(entry);
    if (!entry || !name) {
      opening = new Error(`The project "${current.project}" holds no scene to edit.`);
      return;
    }
    current.open(name).then(
      (doc) => {
        if (destroyed || session !== current) return current.release(name);
        held = name;
        opening = { session: current, name, id: entry.id, doc };
        refresh();
      },
      (error: unknown) => {
        if (destroyed || session !== current) return;
        opening = error instanceof Error ? error : new Error(String(error));
        refresh();
      },
    );
  }

  function fallbackOf(ready: OpenSceneDoc | null): SceneFallback | null {
    if (!ready || !scene || ready.id === scene) return null;
    const last = state.fellBack;
    return last && last.wanted === scene && last.opened === ready.id
      ? last
      : { wanted: scene, opened: ready.id };
  }

  function refresh() {
    if (destroyed) return;
    const project = source.getState();
    if (project.session !== session) {
      release();
      session = project.session;
      if (session) open(session);
    }
    const ready = opening && !(opening instanceof Error) ? opening : null;
    const stopped = ready ? project.stopped[ready.name] : undefined;
    const error =
      opening instanceof Error
        ? opening
        : stopped
          ? new Error(`The scene was closed: ${stopped}`)
          : project.error;
    const status: SceneDocStatus =
      error || project.status === "failed"
        ? "failed"
        : (WAITING[project.status] ?? (ready ? "live" : "connecting"));
    emit({ status, ready, error, fellBack: fallbackOf(ready) });
  }

  const unsubscribe = source.subscribe(refresh);
  refresh();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      release();
      listeners.clear();
    },
  };
}

/**
 * The scene `scene` of the project `source` serves, held open while the
 * component is mounted. Null `source` (not connected yet, or the editor is
 * off) keeps it closed.
 */
export function useSceneDoc(source: SceneDocSource | null, scene?: string | null): SceneDocState {
  const [store] = useState(() => new Store<SceneDocState>(EMPTY));

  useEffect(() => {
    if (!source) return;
    const link = createSceneDocLink({ source, scene: scene ?? null });
    const copy = () => store.setState(() => link.getState());
    const unsubscribe = link.subscribe(copy);
    copy();
    return () => {
      unsubscribe();
      link.destroy();
      store.setState(() => EMPTY);
    };
  }, [store, source, scene]);

  return useStoreValue(store);
}
