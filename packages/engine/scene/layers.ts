/** Scene layers: the registry's draw and editor layers, bottom to top. Pure. */
import type { RegisteredType } from "../game/types";

export type SceneLayerDef = {
  /** ID_PATTERN. */
  name: string;
  description: string;
  /** The draw order visuals on this layer use: a `DRAW_LAYERS` value or any number between. */
  draw: number;
  /** How visuals on it order among themselves; default "z". */
  sort?: "z" | "y";
  /** Parallax: how far the layer moves per world unit of camera movement; [1, 1] default, [0, 0] screen-fixed. */
  scroll?: [x: number, y: number];
  /** Shown only in the editor, never drawn in play. */
  editorOnly?: boolean;
};

/** The layers a game without `layers` gets. */
export const DEFAULT_LAYERS: readonly SceneLayerDef[] = Object.freeze([
  { name: "terrain", description: "Ground and walls.", draw: 0 },
  { name: "decor", description: "Decoration behind the action.", draw: 5 },
  { name: "gameplay", description: "Things that act and are acted on.", draw: 10 },
  {
    name: "editor",
    description: "Notes and helpers; never drawn in play.",
    draw: 60,
    editorOnly: true,
  },
]);

/** The draw order of the first editor-only layer in `layers`; undefined when none is. */
export const editorLayerOf = (layers: readonly SceneLayerDef[]): number | undefined =>
  layers.find((l) => l.editorOnly)?.draw;

/**
 * The layer an entity without `layer` sits on: types that never load
 * (notes) on `editor`, bulk entries on `terrain`, other entities on
 * `gameplay`. Given a game's `layers` that lack one of those names, an
 * editor-only type falls back to the last layer and everything else to the
 * first; without `layers` the names are `DEFAULT_LAYERS`'.
 */
export function defaultLayer(
  type: RegisteredType | undefined,
  bulk: boolean,
  layers: readonly SceneLayerDef[] = DEFAULT_LAYERS,
): string {
  const editorOnly = type?.loads === false;
  const wanted = editorOnly ? "editor" : bulk ? "terrain" : "gameplay";
  if (layers.some((l) => l.name === wanted)) return wanted;
  const fallback = editorOnly ? layers[layers.length - 1] : layers[0];
  return fallback?.name ?? wanted;
}
