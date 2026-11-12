import { useCallback, useSyncExternalStore } from "react";

import type { EditorSession, EditorStoreState } from "../../editor/index";
import { useStoreValue } from "./use-store-value";

export function useEditorStore<T>(session: EditorSession, selector: (s: EditorStoreState) => T): T {
  return useStoreValue(session.store, selector);
}

/**
 * A value the session holds outside its store, re-read whenever the store
 * changes. Read through `useSyncExternalStore` so React (and its compiler,
 * which caches a plain `session.getX()` call for as long as `session` is the
 * same object) sees it as state. `read` must return the same value until
 * the session replaces it.
 */
function useSessionValue<T>(session: EditorSession, read: (session: EditorSession) => T): T {
  const subscribe = useCallback(
    (changed: () => void) => session.store.subscribe(changed),
    [session],
  );
  const snapshot = useCallback(() => read(session), [session, read]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const docOf = (session: EditorSession) => session.getDoc();
const resolvedOf = (session: EditorSession) => session.getResolved();

/** The session's document, re-read whenever it changes. */
export function useEditorDoc(session: EditorSession) {
  return useSessionValue(session, docOf);
}

/** The session's document in world coordinates, with its prefab instances resolved, re-read whenever it changes. */
export function useEditorResolved(session: EditorSession) {
  return useSessionValue(session, resolvedOf);
}

/** The session's prefab library, re-read whenever it changes. */
export function useEditorPrefabs(session: EditorSession) {
  const subscribe = useCallback(
    (changed: () => void) => session.prefabs.subscribe(changed),
    [session],
  );
  const read = useCallback(() => session.getPrefabs(), [session]);
  return useSyncExternalStore(subscribe, read, read);
}
