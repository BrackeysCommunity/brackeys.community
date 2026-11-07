import type { EditorSession, EditorStoreState } from "@jams/engine/editor";
import { useStore } from "@tanstack/react-store";

export function useEditorStore<T>(session: EditorSession, selector: (s: EditorStoreState) => T): T {
  return useStore(session.store, selector);
}

/** The session's document, re-read whenever its hash changes. */
export function useEditorDoc(session: EditorSession) {
  useEditorStore(session, (s) => s.hash);
  return session.getDoc();
}
