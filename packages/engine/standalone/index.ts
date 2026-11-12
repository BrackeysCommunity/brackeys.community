/** The standalone host: boots a released game from its `release.json` in any browser page. No node:, no editor. */
export {
  bootStandalone,
  mirrorRenderState,
  type RenderState,
  type StandaloneGame,
  type StandaloneOptions,
} from "./boot";
export { fetchReleaseTexts, type FetchText } from "./data";
export { showBootError, StandaloneBootError } from "./errors";
export { manifestRuntimeView, manifestView } from "./manifest-view";
export {
  connectHost,
  HostRequestError,
  hostRequested,
  type ConnectHostOptions,
  type HostChannel,
} from "./host-channel";
export {
  frameMessageSchema,
  frameReadySchema,
  HOST_DOWNLOAD_MAX_BYTES,
  HOST_HANDSHAKE_TIMEOUT_MS,
  HOST_WELCOME_TIMEOUT_MS,
  HOST_MESSAGE_MAX_BYTES,
  HOST_PROTOCOL_VERSION,
  HOST_REQUEST_TIMEOUT_MS,
  HOST_REQUESTS,
  hostHandshakeSchema,
  hostIssueSchema,
  hostMessageBytes,
  hostMessageSchema,
  hostSavesSchema,
  saveLimitsSchema,
  saveModeSchema,
  saveSummarySchema,
  saveWriteResultSchema,
  welcomeSchema,
  withinHostMessageCap,
  type FrameMessage,
  type HostEvents,
  type HostMessage,
  type HostRequestMethod,
  type HostRequestParams,
  type HostRequestResult,
  type HostSaves,
  type HostWelcome,
} from "./host-protocol";
export { channelSaveStore } from "../saves/store";
