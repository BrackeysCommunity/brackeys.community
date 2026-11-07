import { Store } from "@tanstack/store";

import type { Ref, SceneHash, SceneIssue } from "../scene/types";

export type EditorMode = "edit" | "play";
export type EditorTool = "select";

/** What the editor's panels render. Kept apart from the game store, which changes every frame. */
export type EditorStoreState = {
  sceneName: string;
  hash: SceneHash;
  dirty: boolean;
  /** When the document was last marked saved, in ms since the epoch. */
  savedAt?: number;
  mode: EditorMode;
  selection: Ref[];
  tool: EditorTool;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  issues: SceneIssue[];
  lastActor?: string;
};

export function createEditorStore(init: Partial<EditorStoreState> = {}): Store<EditorStoreState> {
  return new Store<EditorStoreState>({
    sceneName: "",
    hash: "",
    dirty: false,
    mode: "edit",
    selection: [],
    tool: "select",
    canUndo: false,
    canRedo: false,
    issues: [],
    ...init,
  });
}
