/**
 * A DOM-free runtime for tools and tests: load a scene, step it, and read
 * reports; compile input scripts, run playtests and fuzz rollouts the way
 * the editor's Play starts a world.
 */
export {
  createHeadlessRuntime,
  probeConfigHash,
  runProbe,
  simActionError,
  unknownActionError,
} from "./headless";
export type {
  HeadlessLive,
  HeadlessRuntime,
  HeadlessRuntimeOptions,
  ProbeInput,
  ProbeOptions,
  ProbeReport,
} from "./types";
export { memorySaveStore } from "../saves/store";
export {
  fileSchemaIssue,
  swapCheck,
  type SwapCheckOptions,
  type SwapCheckReport,
  type SwapCheckRun,
} from "./swap-check";
export {
  captureSave,
  restoreSave,
  worldSaveBlockers,
  type SaveBlocker,
} from "../runtime/save-state";
export {
  createPersistCell,
  gamePersistCell,
  plainJsonProblem,
  type PersistCellOptions,
} from "../runtime/persist";
export type {
  AssetReloadError,
  LoadFailureReason,
  LoadReport,
  PersistCell,
  RuntimeRequests,
  RuntimeStats,
  SceneRuntime,
  SceneRuntimeHandle,
  StepEvent,
  StepResult,
  SwapReport,
} from "../runtime/types";
export {
  CONTACT_END,
  CONTACT_START,
  ENTITY_DESTROYED,
  ENTITY_DISABLED,
  ENTITY_ENABLED,
  ENTITY_SPAWNED,
  PLAYER_JOINED,
  PLAYER_LEFT,
  SENSOR_ENTER,
  SENSOR_EXIT,
} from "../runtime/types";
export {
  decodeStreams,
  mergeTick,
  type DecodeOptions,
  type SeatChange,
  type SeatEvent,
  type StreamTables,
  type SystemEvent,
  type TickInput,
} from "../input/stream";
export { defaultSeed } from "../runtime/seed";
export {
  createRunTiming,
  type RunTiming,
  type TimingBucket,
  type TimingReport,
  type TimingScope,
  type TimingSpan,
} from "../runtime/timing";
export type { RapierModule } from "../types";
export type { ProjectRuntimeView } from "../project/runtime-view";
export { assetInfo, type AssetInfo } from "../project/asset-info";
export {
  loadHeadless,
  type FilesLoadInput,
  type HeadlessLoad,
  type HeadlessLoadInput,
  type HeadlessLoadOptions,
  type SnapshotLoadInput,
} from "./load";
export { SnapshotError, type ProjectSnapshot } from "../project/snapshot";
export {
  analogActions,
  analogValues,
  compileInputScript,
  compiledPointer,
  heldEdges,
  pointerAt,
  pointerHeld,
  scriptSource,
  type AnalogValues,
  type CompiledPointer,
  type CompiledScript,
  type CompiledScriptStep,
  type CompiledTrack,
  type PointerBindings,
  type ScriptSource,
  type ScriptStepLog,
} from "./compile-input-script";
export { playWorld, preparePlay, type PreparedPlay } from "../runtime/play-session";
export { runPlaytest, untilHolds, type PlaytestHooks, type PlaytestStart } from "./playtest";
export {
  platformIssues,
  recordingDivergence,
  replayRecording,
  type ReplayOptions,
  type ReplayReport,
  type ReplayRun,
} from "./recording";
export {
  createRunRecorder,
  recordedSwap,
  REPLAY_ACROSS_PLATFORMS,
  type RecorderOptions,
  type RecordingEnd,
  type RecordingHost,
  type RunRecorder,
} from "../runtime/recorder";
export {
  parseRecording,
  RECORDING_VERSION,
  type ParseRecordingResult,
  type RecordingCommand,
  type RecordingIssue,
  type RecordingMarker,
  type RecordingPlatform,
  type RecordingStream,
  type RunRecording,
  type RunRecordingV1,
  type RunRecordingV2,
} from "../scene/recording-schema";
export { defaultFuzzMacro, fuzz } from "./fuzz";
export type { FuzzMacroInputs } from "./fuzz";
export { runBlocked, STUCK_METRES, STUCK_TICKS, tickWakes, type SaveStart } from "./play-loop";
export {
  physicalEnv,
  runPhysicalChecks,
  validatePhysical,
  type PhysicalOptions,
  type ValidatePhysicalOptions,
} from "./validate-physical";
export {
  runChecks,
  type CheckResult,
  type ChecksReport,
  type RunChecksOptions,
} from "./run-checks";
export type { CheckEnv, CheckVerdict, PhysicalEnv, PhysicalHit } from "../game/types";
export type {
  CompiledInputScript,
  CompiledStep,
  CompileResult,
  EventMatch,
  FuzzLegal,
  FuzzOptions,
  FuzzReport,
  FuzzRun,
  FuzzTouch,
  InputEdge,
  InputScript,
  InputScriptStep,
  InputScriptStepV2,
  InputScriptTrack,
  InputScriptV2,
  PlaytestBlocked,
  PlaytestOptions,
  PlaytestOutcomeReport,
  PersistMatch,
  PlaytestReport,
  PlaytestRun,
  PlaytestSegment,
  PlaytestSegmentEnd,
  PlaytestStep,
  PlayOptions,
  ScriptIssue,
  StepDuration,
  UntilClause,
} from "./playtest-types";
