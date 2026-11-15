import type { Style } from "./game/types";
import type { EmitterFile } from "./project/kinds/emitter";
import type { FontMeta } from "./project/kinds/font";
import type { Sha256 } from "./project/types";
import type { ShapeObj } from "./scene/types";
import type { RichLine, TextVars } from "./text/rich";
import type { StringTableData, TextDirection } from "./text/strings";

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

/** An opaque handle to one draw layer, for games that draw their own; the Pixi view's is a Container in world px. */
export type ViewLayerHandle = { readonly __viewLayer: true };

export type BlendMode = "normal" | "add" | "multiply" | "screen";

/** A texture or a frame of one, as a view draws it at a visual's pose. */
export type SpriteVisual = {
  /** The texture's content hash; null draws only the fallback box. */
  texture: Sha256 | null;
  /** The frame in texture px; omitted, the whole texture. */
  frame?: { x: number; y: number; w: number; h: number };
  /** Drawn size, metres; the view draws it at the game's px per metre. */
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
  /** Border insets in texture px, drawn one texture px to one world px: nine-slice scaling. */
  nineSlice?: [left: number, top: number, right: number, bottom: number];
  sampling: "nearest" | "linear";
  /** What `draw` shows when the view can't draw sprites or the texture isn't loaded yet. */
  fallback: { shape: ShapeObj; style: Style };
};

/**
 * A face text draws in: a BMFont (bitmap or MSDF) by its .fnt's hash and its
 * pages', or a web font by its content hash (or asset id), which the loader
 * registers as a FontFace; any other family is a CSS family.
 */
export type TextFont =
  | {
      kind: "bitmap";
      /** The .fnt's content hash. */
      hash: Sha256;
      /** Its page textures' content hashes, in page order. */
      pages: readonly Sha256[];
      meta: FontMeta;
    }
  | { kind: "web"; family: string };

/**
 * What a text visual shows, as data: lines already parsed, or a string key
 * the view resolves through the locale's table it holds, redrawn when the
 * table changes.
 */
export type TextContent =
  | { lines: readonly RichLine[] }
  | { key: string; vars?: TextVars; rich?: boolean };

/** World-space text, as a view draws it at a visual's pose. */
export type TextVisual = TextContent & {
  /** Null: the locale's font from the view's table, else the view's default face. */
  font: TextFont | null;
  /** Px at zoom 1. */
  size: number;
  color: number;
  align: "left" | "center" | "right";
  /** In the text box's own 0–1 space. */
  anchor: [x: number, y: number];
  /** Wrap width, px at zoom 1. */
  wrap?: number;
  outline?: { width: number; color: number };
  /** For `lines`; a key's text takes its table's direction. */
  direction: TextDirection;
  /** Drawn when the view can't draw text: the measured box. */
  fallback: { shape: ShapeObj; style: Style };
};

/**
 * What an emitter follows, as data: an entity the view resolves to its
 * interpolated pose on each rendered frame, plus an offset in metres that
 * turns with that pose and mirrors when `flip`.
 */
export type EmitterFollow = {
  entity: string;
  offset?: [x: number, y: number];
  flip?: boolean;
};

/** An emitter as a view runs it on its particle layer. */
export type ViewEmitter = {
  preset: EmitterFile;
  follow: EmitterFollow;
  layer: ViewLayer;
  /**
   * From its start, keeping the particles it has alive; false retunes a
   * running emitter in place (its clock, its point, its particles), and
   * starts one when none runs.
   */
  restart: boolean;
};

/**
 * Where a runtime's systems draw, one visual per id; `null` in headless
 * runs. Shapes, poses and sprite sizes are world metres; a style's
 * `strokeWidth` is world px, so a line keeps its weight at any px per metre. Ids are unique per runtime: an entity's id, or `${id}#<part>` for a
 * system that draws several pieces of one entity. The optional members are
 * additive: a view without them still draws everything, sprites as their
 * fallback boxes. Every member takes data, never a callback, so a view
 * can sit across a worker link.
 */
export interface SceneView {
  /** Draws `shape` (metres) in the visual's local space, replacing `id`'s drawing; a redraw keeps its pose. */
  draw(id: string, shape: ShapeObj, style: Style, layer: ViewLayer): void;
  /**
   * Moves `id`'s local origin to (x, y) metres and turns it by `rot` radians. New
   * visuals start at (0, 0, 0). `snap`: no interpolation from the previous
   * pose (new visuals always snap).
   */
  pose(id: string, x: number, y: number, rot?: number, snap?: boolean): void;
  /** Idempotent. */
  remove(id: string): void;
  /** The layer's own handle; what a game draws there is in world px (metres × the game's px per metre). */
  layer(layer: ViewLayer): ViewLayerHandle;
  /** A sprite under `id`, replacing what was drawn. */
  sprite?(id: string, visual: SpriteVisual, layer: ViewLayer): void;
  /** Order inside its layer: higher on top; ties by first draw. */
  depth?(id: string, z: number): void;
  /** The runtime finished tick `tick`; poses set since belong to it. */
  commit?(tick: number): void;
  /** Each rendered frame: interpolated poses, y-sort, parallax; `camera` is the camera's position in metres. */
  frame?(f: { alpha: number; camera: { x: number; y: number; zoom: number } }): void;
  /** Runs the emitter `id` on the view's particle layer; a view without one ignores it. */
  emitter?(id: string, emitter: ViewEmitter): void;
  /** Stops the emitter `id`: what it put in world space lives out its life. Idempotent. */
  removeEmitter?(id: string): void;
  /** Text under `id`, replacing what was drawn; a view without it draws the fallback box. */
  text?(id: string, visual: TextVisual, layer: ViewLayer): void;
  /** The locale's strings and font, as data: what keyed text resolves through. The shell hands one at start and on each locale change. */
  locale?(table: StringTableData): void;
}

/** Draws text through any view: `text` when it has one, else the fallback box. */
export function drawText(view: SceneView, id: string, visual: TextVisual, layer: ViewLayer): void {
  if (view.text) view.text(id, visual, layer);
  else view.draw(id, visual.fallback.shape, visual.fallback.style, layer);
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
