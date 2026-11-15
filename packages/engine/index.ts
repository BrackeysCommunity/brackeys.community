export { createGame } from "./engine";
export { ENGINE_VERSION } from "./version";
export type {
  ActionBindings,
  CameraMode,
  CameraState,
  FlowResult,
  GameConfig,
  GameEventMap,
  GameFlow,
  GameInput,
  GameInstance,
  GameLive,
  GameLocale,
  GameMode,
  GamePhase,
  GameStoreState,
  InputAction,
  InputBinding,
  LoadingView,
  LoadingViewFactory,
  PlayOutcome,
  PlayReport,
  PlaySession,
  RapierModule,
  RenderBackend,
  RendererConfig,
  SceneSource,
  SimState,
  StagedVersion,
  TransitionRunner,
  UiActionEvent,
  Vec2,
} from "./types";
export { liveSceneSource, type LiveSceneVersions } from "./flow-host";
export {
  browserSaveStore,
  DEFAULT_INDEXED_DB_NAME,
  DEFAULT_LOCAL_STORAGE_PREFIX,
  indexedDbSaveStore,
  localStorageSaveStore,
  memorySaveStore,
  type SaveSlots,
  type SaveStore,
  type SaveSummary,
  type SaveWriteResult,
} from "./saves/index";
export { createLoadingOverlay, fadeTransition } from "./ui/flow-views";
export type { FlowRequest, SceneLibrary, SceneListEntry, TransitionSpec } from "./game/flow";
export type { SaveDepth, SaveLimits, SaveMeta } from "./game/save-file";
export {
  bindText,
  bindToWorld,
  createCaptions,
  createDialogueBox,
  createTextLog,
  createUiLayer,
  mountUi,
  renderRichText,
  watchView,
  type CaptionsOptions,
  type DialogueBoxOptions,
  type GameCaptions,
  type TextLogOptions,
} from "./ui";
export type { MountUi, UiAssetUrl, UiContext, UiHandle } from "./ui";
export {
  applyPt,
  applyVec,
  compose,
  composeDihedral,
  dihedral,
  dihedralOf,
  flipWorld,
  IDENTITY_2D,
  invert,
  type Dihedral,
  type Transform2D,
} from "./math";
export type {
  AssetReloadError,
  LoadFailureReason,
  LoadReport,
  StepEvent,
  StepResult,
} from "./runtime/types";
export type { ExpandedScene, RuntimeEntity } from "./scene/types";
export type { GameCommand, GameDefinition, LiveContext, Registry } from "./game/types";
export {
  acceptedTimings,
  acceptedTimingsWords,
  clampTiming,
  diffWords,
  LIVE_CHECK_AGAIN_TICKS,
  LIVE_DEFAULTS,
  swapStrategyFor,
  timingWords,
  versionName,
  type LiveDeclaration,
  type SceneDiff,
  type SceneSwap,
  type SwapSide,
  type SwapStrategy,
  type SwapTiming,
} from "./game/live";
export type { PlayOptions } from "./headless/playtest-types";
export { utf8Bytes } from "./project/release-assets";
export type { RunRecording } from "./scene/recording-schema";
export {
  createPixiView,
  pixiContainer,
  type PixiView,
  type PixiViewOptions,
  type TextureSource,
} from "./render/pixi-view";
export {
  createRichText,
  DEFAULT_TEXT_FACE,
  type FontSource,
  type RichTextOptions,
} from "./render/text";
export {
  createAssetLoader,
  type AssetLoader,
  type AssetUrl,
  type LoadProgress,
} from "./render/asset-loader";
export {
  DEFAULT_RESOLUTION,
  resolveResolution,
  viewportFor,
  type ResolutionPolicy,
  type ResolutionViewport,
} from "./resolution";
export {
  drawSprite,
  drawText,
  type BlendMode,
  type EmitterFollow,
  type SpriteVisual,
  type TextContent,
  type TextFont,
  type TextVisual,
  type ViewEmitter,
} from "./context";
export { viewportRect, type ViewportDef, type ViewportRect } from "./camera/viewports";
export {
  createParticleLayer,
  type ParticleLayer,
  type ParticleLayerOptions,
  type ParticleTexture,
} from "./render/particles";
export { createEffectLayer, type EffectLayer } from "./render/effects";
export type { BurstOptions, FlashOptions } from "./runtime/present";
export {
  SPRITE,
  SPRITE_FALLBACK_SIZE,
  spriteGeometry,
  type FrameRect,
  type SpriteAssetInfo,
  type SpriteBlock,
  type SpriteGeometry,
} from "./game/behaviors/sprite";
export {
  TOOL_PRIORITY,
  type PointerKind,
  type ToolConsumer,
  type ToolEvent,
  type ToolRouter,
} from "./tool-router";
export {
  createTouchControls,
  type TouchControlDef,
  type TouchControls,
  type TouchControlValue,
} from "./input/touch-controls";
export {
  browserRemapStore,
  memoryRemapStore,
  snapshotRemapStore,
  type RemapState,
  type RemapStore,
} from "./input/remap";
export {
  resolveBindings,
  type BindingLayerName,
  type BindingLayers,
  type BoundInput,
  type DeviceTables,
  type ResolvedBindings,
} from "./input/bindings";
export { MAX_PLAYERS, resolvePlayers } from "./input/players";
export {
  selectCamera,
  selectDebugMode,
  selectDialogue,
  selectFPS,
  selectMode,
  selectGame,
  selectPhase,
  selectSession,
  selectSim,
  selectTick,
} from "./store";
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
} from "./audio/types";
export type { AudioClock, CalibrateLatencyOptions, LatencyCalibration } from "./audio/clock";
export { tryWebAudioBackend, webAudioBackend } from "./audio/web-audio";
export { renderSynth, SYNTH_SAMPLE_RATE, synthDurationMs, synthWav } from "./audio/synth";
export {
  CLICK_PATCH,
  mutateSynth,
  randomSynth,
  SYNTH_PRESETS,
  type SynthPreset,
} from "./audio/synth-presets";
export { browserPrefsStore, memoryPrefsStore, snapshotPrefsStore, type PrefsStore } from "./prefs";
export type { StringTable, StringTableData, TextDirection } from "./text/strings";
export type { RichLine, RichSpan } from "./text/rich";
export type { DialogueView } from "./dialogue/runner";
