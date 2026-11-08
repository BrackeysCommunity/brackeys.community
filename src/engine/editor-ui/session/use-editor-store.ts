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
