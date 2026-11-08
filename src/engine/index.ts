export { createGame } from "./engine";
export { ENGINE_VERSION } from "./version";
export type {
  CameraMode,
  CameraState,
  GameConfig,
  GameEventMap,
  GameInstance,
  GameMode,
  GamePhase,
  GameStoreState,
  InputAction,
  InputBinding,
  PlayOutcome,
  PlayReport,
  PlaySession,
  RapierModule,
  SimState,
  Vec2,
} from "./types";
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
export type { LoadReport, StepEvent, StepResult } from "./runtime/types";
export type { ExpandedScene, RuntimeEntity } from "./scene/types";
export type { GameDefinition, Registry } from "./game/types";
export type { PlayOptions } from "./headless/playtest-types";
export type { RunRecording } from "./scene/recording-schema";
export {
  createPixiView,
  pixiContainer,
  type PixiView,
  type PixiViewOptions,
  type TextureSource,
} from "./render/pixi-view";
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
export { drawSprite, type BlendMode, type SpriteVisual } from "./context";
export {
  SPRITE,
  SPRITE_FALLBACK_SIZE,
  spriteGeometry,
  type FrameRect,
  type SpriteAssetInfo,
  type SpriteBlock,
  type SpriteGeometry,
} from "./game/behaviors/sprite";
export { TOOL_PRIORITY, type ToolConsumer, type ToolEvent, type ToolRouter } from "./tool-router";
export {
  selectCamera,
  selectDebugMode,
  selectFPS,
  selectMode,
  selectGame,
  selectPhase,
  selectSession,
  selectSim,
  selectTick,
} from "./store";
