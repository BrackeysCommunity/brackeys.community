import type { Style } from "./game/types";
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

/**
 * Where a runtime's systems draw, one visual per id; `null` in headless
 * runs. Ids are unique per runtime: an entity's id, or `${id}#<part>` for a
 * system that draws several pieces of one entity.
 */
export interface SceneView {
  /** Draws `shape` in the visual's local space, replacing `id`'s drawing; a redraw keeps its pose. */
  draw(id: string, shape: ShapeObj, style: Style, layer: ViewLayer): void;
  /** Moves `id`'s local origin to (x, y) and turns it by `rot` radians. New visuals start at (0, 0, 0). */
  pose(id: string, x: number, y: number, rot?: number): void;
  /** Idempotent. */
  remove(id: string): void;
  layer(layer: ViewLayer): ViewLayerHandle;
}

export function layerOrder(layer: ViewLayer): number {
  return typeof layer === "number" ? layer : DRAW_LAYERS[layer];
}

export type { EngineContext } from "./game/types";
