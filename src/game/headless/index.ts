/** @experimental A DOM-free runtime for tools and tests: load a scene, step it, read reports. */
export {
  CONFIG_HASH,
  createHeadlessRuntime,
  PROBE_ACTIONS,
  runProbe,
  unknownActionError,
} from "./headless";
export type { HeadlessRuntimeOptions, ProbeInput, ProbeOptions, ProbeReport } from "./types";
export type {
  LoadReport,
  PlayerSnapshot,
  RuntimeStats,
  SceneRuntime,
  StepEvent,
  StepResult,
} from "../runtime/types";
export type { RapierModule } from "../types";
