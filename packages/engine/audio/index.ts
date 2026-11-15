export type { AudioClock, CalibrateLatencyOptions, LatencyCalibration } from "./clock";
export { MUSIC_DRIFT_LIMIT_MS, SILENT_CLOCK } from "./clock";
export {
  fakeAudioBackend,
  type FakeAudioBackend,
  type FakeAudioLogEntry,
  type FakeAudioOptions,
} from "./fake";
export { SYNTH_SAMPLE_RATE, renderSynth, synthDurationMs, synthWav } from "./synth";
export { mutateSynth, randomSynth, SYNTH_PRESETS, type SynthPreset } from "./synth-presets";
export {
  createAudioSystem,
  MUSIC_FADE_MS_DEFAULT,
  type AudioHostEvent,
  type AudioSystemHandle,
  type AudioSystemOptions,
  type CalibrationRun,
} from "./system";
export { soundTriggers, type SoundTriggers, type TriggerEntity } from "./triggers";
export type {
  AudioBackend,
  AudioClipHandle,
  AudioSystem,
  BusLevel,
  BusName,
  FakeAudioCall,
  GameAudio,
  Voice,
  VoiceOptions,
} from "./types";
export { webAudioBackend } from "./web-audio";
