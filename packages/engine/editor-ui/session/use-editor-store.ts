import { useCallback, useSyncExternalStore } from "react";

import type { EditorSession, EditorStoreState } from "../../editor/index";
import { useStoreValue } from "./use-store-value";

export function useEditorStore<T>(session: EditorSession, selector: (s: EditorStoreState) => T): T {
  return useStoreValue(session.store, selector);
}

/** The session's document, re-read whenever its hash changes. */
export function useEditorDoc(session: EditorSession) {
  useEditorStore(session, (s) => s.hash);
  return session.getDoc();
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
