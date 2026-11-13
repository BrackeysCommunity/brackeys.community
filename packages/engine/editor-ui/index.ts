// ─── The editor ──────────────────────────────────────────

export {
  mountSceneEditor,
  SceneEditor,
  type SceneEditorHandle,
  type SceneEditorProps,
} from "./SceneEditor";

// ─── Host adapters and connectors ────────────────────────

export type {
  EditorCue,
  EditorHost,
  EditorIdentityInput,
  EditorNotify,
  EditorProjectChoice,
  EditorStorage,
  MintProjectToken,
  NotifyOptions,
  ProjectAccess,
  ProjectBlobs,
  ProjectConnection,
  ProjectConnectionState,
  ProjectConnectionStatus,
  ProjectTokenRequest,
  SceneHome,
} from "./host";
export type { CloseReason, ProjectSocket, ProjectTokenAnswer, ProjectTransport } from "./host";
export type {
  EditorLiveHost,
  EditorPublishHost,
  GameSaveMode,
  GameSettingsPatch,
  GameSettingsView,
  GameVisibility,
  LiveBaseView,
  LiveMove,
  LivePointerView,
  LivePublished,
  LivePublishOptions,
  LivePublishProgress,
  LiveUsageView,
  LiveVersionView,
  LiveWording,
  PointerMove,
  PublishChannel,
  PublishWording,
  ReleaseRollback,
  ReleaseView,
  UsageLevel,
  UsageLineView,
  UsageView,
} from "./host";

export { blobContentStore, BlobRouteError, projectBlobs } from "./connect/blobs";
export { devProjectHost } from "./connect/dev";
export { hocuspocusTransport } from "./connect/hocuspocus";
export {
  connectProjectSession,
  createProjectTokens,
  offConnection,
  type ConnectProjectSessionOptions,
  type ProjectTokens,
} from "./connect/project-session";

// ─── Building blocks ─────────────────────────────────────

export { EditorSkeleton, type EditorSkeletonProps } from "./frame/EditorSkeleton";
export {
  DEFAULT_LAYOUT,
  fitLayout,
  parseLayout,
  type EditorLayout,
  type PanelId,
} from "./layout/model";
export { createPending, type Pending, type PendingRun, type PendingTask } from "./pending/pending";

/** The stylesheet's specifier, for hosts that inject a `<link>`. */
export const EDITOR_UI_STYLESHEET = "@jams/engine/editor-ui/style.css";
