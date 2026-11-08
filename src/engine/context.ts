import type { Style } from "./game/types";
import type { Sha256 } from "./project/types";
import type { ShapeObj } from "./scene/types";

/**
 * Named draw orders inside a scene view, bottom to top, whatever order
 * systems spawn in. A game may pass any number between them.
 */
export const DRAW_LAYERS = {
  terrain: 0,
  body: 10,
  marker: 20,
  actor: 30,
  overlay: 50,
  preview: 60,
} as const;

export type DrawLayer = keyof typeof DRAW_LAYERS;
export type ViewLayer = DrawLayer | number;

/** An opaque handle to one draw layer, for games that draw their own; the Pixi view's is a Container. */
export type ViewLayerHandle = { readonly __viewLayer: true };

export type BlendMode = "normal" | "add" | "multiply" | "screen";

/** A texture or a frame of one, as a view draws it at a visual's pose. */
export type SpriteVisual = {
  /** The texture's content hash; null draws only the fallback box. */
  texture: Sha256 | null;
  /** The frame in texture px; omitted, the whole texture. */
  frame?: { x: number; y: number; w: number; h: number };
  /** Drawn size, world px. */
  size: [w: number, h: number];
  /** In the frame's own 0–1 space. */
  anchor: [x: number, y: number];
  tint?: number;
  alpha?: number;
  flipX?: boolean;
  flipY?: boolean;
  blend?: BlendMode;
  /** Repeat the frame across `size` instead of stretching it. */
  tile?: boolean;
  /** Border insets in texture px: nine-slice scaling. */
  nineSlice?: [left: number, top: number, right: number, bottom: number];
  sampling: "nearest" | "linear";
  /** What `draw` shows when the view can't draw sprites or the texture isn't loaded yet. */
  fallback: { shape: ShapeObj; style: Style };
};

/**
 * Where a runtime's systems draw, one visual per id; `null` in headless
 * runs. Ids are unique per runtime: an entity's id, or `${id}#<part>` for a
 * system that draws several pieces of one entity. The optional members are
 * additive: a view without them still draws everything, sprites as their
 * fallback boxes.
 */
export interface SceneView {
  /** Draws `shape` in the visual's local space, replacing `id`'s drawing; a redraw keeps its pose. */
  draw(id: string, shape: ShapeObj, style: Style, layer: ViewLayer): void;
  /**
   * Moves `id`'s local origin to (x, y) and turns it by `rot` radians. New
   * visuals start at (0, 0, 0). `snap`: no interpolation from the previous
   * pose (new visuals always snap).
   */
  pose(id: string, x: number, y: number, rot?: number, snap?: boolean): void;
  /** Idempotent. */
  remove(id: string): void;
  layer(layer: ViewLayer): ViewLayerHandle;
  /** A sprite under `id`, replacing what was drawn. */
  sprite?(id: string, visual: SpriteVisual, layer: ViewLayer): void;
  /** Order inside its layer: higher on top; ties by first draw. */
  depth?(id: string, z: number): void;
  /** The runtime finished tick `tick`; poses set since belong to it. */
  commit?(tick: number): void;
  /** Each rendered frame: interpolated poses, y-sort, parallax. */
  frame?(f: { alpha: number; camera: { x: number; y: number; zoom: number } }): void;
}

/** Draws a sprite through any view: `sprite` when it has one, else the fallback box. */
export function drawSprite(
  view: SceneView,
  id: string,
  visual: SpriteVisual,
  layer: ViewLayer,
): void {
  if (view.sprite) view.sprite(id, visual, layer);
  else view.draw(id, visual.fallback.shape, visual.fallback.style, layer);
}

export function layerOrder(layer: ViewLayer): number {
  return typeof layer === "number" ? layer : DRAW_LAYERS[layer];
}

export type { EngineContext } from "./game/types";
