import { Store } from "@tanstack/store";

import type { PeerPresence } from "../collab/presence";
import type { LogEntry, SceneOrigin } from "../collab/types";
import type { Ref, SceneHash, SceneIssue } from "../scene/types";
import type { TileBrush } from "./builtin/tile-tools";

export type EditorMode = "edit" | "play";

/** What the editor's panels render. Kept apart from the game store, which changes every frame. */
export type EditorStoreState = {
  sceneName: string;
  hash: SceneHash;
  mode: EditorMode;
  selection: Ref[];
  /** The entity under the pointer in the scene view or the outliner, highlighted in both. */
  hover: Ref | null;
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
  /** What the tile tools paint; the palette sets it, the picker and the brush keys change it. */
  tileBrush: TileBrush;
  /** The autotile rule the autotile brush paints with; `null` takes the tileset's first. */
  tileRule: string | null;
  /** Why the last command or tool action did nothing, for the status line; `null` when there is none. */
  notice: string | null;
};

/** The brush before the palette picks one: tile 0, unturned. */
export const DEFAULT_TILE_BRUSH: TileBrush = { tiles: [[1]] };

export function createEditorStore(init: Partial<EditorStoreState> = {}): Store<EditorStoreState> {
  return new Store<EditorStoreState>({
    sceneName: "",
    hash: "",
    mode: "edit",
    selection: [],
    hover: null,
    tool: "select",
    canUndo: false,
    canRedo: false,
    issues: [],
    history: [],
    peers: [],
    tileBrush: DEFAULT_TILE_BRUSH,
    tileRule: null,
    notice: null,
    ...init,
  });
}

/** Sets the shared hover; a no-op when it's already `ref`, so pointer moves don't re-render the panels. */
export function setHover(store: Store<EditorStoreState>, ref: Ref | null): void {
  if (store.state.hover !== ref) store.setState((s) => ({ ...s, hover: ref }));
}

export function setTileBrush(store: Store<EditorStoreState>, brush: TileBrush): void {
  store.setState((s) => ({ ...s, tileBrush: brush }));
}

/** Sets the autotile rule; the palette arms the autotile tool with it. */
export function setTileRule(store: Store<EditorStoreState>, rule: string | null): void {
  if (store.state.tileRule !== rule) store.setState((s) => ({ ...s, tileRule: rule }));
}
