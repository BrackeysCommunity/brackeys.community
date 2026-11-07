/**
 * A DOM-free runtime for tools and tests: load a scene, step it, and read
 * reports; compile input scripts, run playtests and fuzz rollouts the way
 * the editor's Play starts a world.
 */
export { createHeadlessRuntime, probeConfigHash, runProbe, unknownActionError } from "./headless";
export type { HeadlessRuntimeOptions, ProbeInput, ProbeOptions, ProbeReport } from "./types";
export type {
  LoadReport,
  RuntimeStats,
  SceneRuntime,
  SceneRuntimeHandle,
  StepEvent,
  StepResult,
} from "../runtime/types";
export { SENSOR_ENTER, SENSOR_EXIT } from "../runtime/types";
export type { RapierModule } from "../types";
export { compileInputScript, heldEdges } from "./compile-input-script";
export { preparePlay, type PreparedPlay } from "../runtime/play-session";
export { runPlaytest } from "./playtest";
export {
  recordingDivergence,
  replayRecording,
  type ReplayOptions,
  type ReplayReport,
  type ReplayRun,
} from "./recording";
export {
  createRunRecorder,
  type RecorderOptions,
  type RecordingEnd,
  type RunRecorder,
} from "../runtime/recorder";
export {
  parseRecording,
  RECORDING_VERSION,
  type ParseRecordingResult,
  type RecordingIssue,
  type RecordingMarker,
  type RunRecording,
} from "../scene/recording-schema";
export { defaultFuzzMacro, fuzz } from "./fuzz";
export { STUCK_PX, STUCK_TICKS } from "./play-loop";
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
  FuzzOptions,
  FuzzReport,
  FuzzRun,
  FuzzTouch,
  InputEdge,
  InputScript,
  InputScriptStep,
  PlaytestBlocked,
  PlaytestOptions,
  PlaytestOutcomeReport,
  PlaytestReport,
  PlaytestRun,
  PlaytestStep,
  PlayOptions,
  ScriptIssue,
  StepDuration,
  UntilClause,
} from "./playtest-types";
