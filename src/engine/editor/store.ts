import { Store } from "@tanstack/store";

import type { PeerPresence } from "../collab/presence";
import type { LogEntry, SceneOrigin } from "../collab/types";
import type { Ref, SceneHash, SceneIssue } from "../scene/types";

export type EditorMode = "edit" | "play";

/** What the editor's panels render. Kept apart from the game store, which changes every frame. */
export type EditorStoreState = {
  sceneName: string;
  hash: SceneHash;
  mode: EditorMode;
  selection: Ref[];
  /** The active tool's id: one of `ENGINE_TOOL_IDS` or a game tool's. */
  tool: string;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  issues: SceneIssue[];
  /** Who made the last change that reached this client. */
  lastActor?: SceneOrigin;
  /** The doc's history, oldest first. */
  history: LogEntry[];
  /** Everyone else editing this scene, from awareness. */
  peers: PeerPresence[];
};

export function createEditorStore(init: Partial<EditorStoreState> = {}): Store<EditorStoreState> {
  return new Store<EditorStoreState>({
    sceneName: "",
    hash: "",
    mode: "edit",
    selection: [],
    tool: "select",
    canUndo: false,
    canRedo: false,
    issues: [],
    history: [],
    peers: [],
    ...init,
  });
}
