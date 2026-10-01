import { Store } from "@tanstack/store";

/** `all`, `personal`, or a team id: the workspace panel's scope chip. */
type WorkspaceScope = string;

const STORAGE_KEY = "brackeys:workspace-scope";

function rememberedScope(): WorkspaceScope {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "all";
  } catch {
    return "all";
  }
}

export const workspaceStore = new Store<{
  open: boolean;
  scope: WorkspaceScope | null;
  /** The "New canvas" dialog, opened from the panel or from ⌘K. */
  creating: boolean;
}>({
  open: false,
  scope: null,
  creating: false,
});

/** Opens the panel, on the given scope or on the one this member picked last. */
export function openWorkspace(scope?: WorkspaceScope) {
  workspaceStore.setState((s) => ({ ...s, open: true, scope: scope ?? rememberedScope() }));
}

/** Opens "New canvas" on its own, with a scope picker. */
export function startNewCanvas() {
  workspaceStore.setState((s) => ({ ...s, open: false, scope: "all", creating: true }));
}

export function setCreatingCanvas(creating: boolean) {
  workspaceStore.setState((s) => ({ ...s, creating }));
}

export function closeWorkspace() {
  workspaceStore.setState((s) => ({ ...s, open: false }));
}

export function setWorkspaceScope(scope: WorkspaceScope) {
  workspaceStore.setState((s) => ({ ...s, scope }));
  try {
    window.localStorage.setItem(STORAGE_KEY, scope);
  } catch {
    // A blocked store just means the choice isn't remembered.
  }
}
