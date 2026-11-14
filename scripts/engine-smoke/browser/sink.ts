/**
 * What the browser smoke's render run draws and where it reads it, shared by
 * the page, the runner and their tests: the engine project's kitchen sink,
 * framed on its crate, whose sprite is the `crates` atlas's `crate-0` frame;
 * then split in two, the crate on the left and the animated sprite on the
 * right, whose `idle` clip walks the `hero` sheet's two one-colour frames.
 */
import type { ViewportDef } from "@jams/engine";

export const SINK_PROJECT = "engine";
export const SINK_SCENE = "kitchen-sink";

/** Where the preview server hands the page the engine project's registry and doc values. */
export const SINK_DATA_ROUTE = "/__smoke/engine-project.json";

export const SMOKE_BACKGROUND = 0x1a1a2e;

/** crate-0's one colour in `art/crates.png`. */
export const INSIDE_COLOUR = 0xff8800;

/** World metres inside the crate's 0.72 m sprite and 0.08 m clear of its 0.4 m body, so only the sprite colours it. */
export const INSIDE_POINT: readonly [x: number, y: number] = [9.08, 11.4];

/** World metres of empty air above the crate: no sprite, body or path is drawn there. */
export const OUTSIDE_POINT: readonly [x: number, y: number] = [8.8, 10.6];

/** The world rectangle the camera frames, metres: both points with room around them. */
export const SINK_FRAME = { minX: 8, minY: 10.2, maxX: 9.8, maxY: 11.8 } as const;

/** The canvas the render run draws on, CSS px. */
export const SINK_CANVAS = { width: 640, height: 360 } as const;

/** The entity whose `anim` block plays the `idle` clip over the `hero` sheet. */
export const ANIM_ENTITY = "std-anim";

/** World metres at the centre of the animated sprite. */
export const ANIM_POINT: readonly [x: number, y: number] = [4.8, 5];

/** The idle clip's frames' one colours in `art/hero.png`: hero-0, then hero-1. */
export const ANIM_COLOURS = [0xe040ff, 0xffe000] as const;

/** Ticks the clip's first frame shows: the split run steps this far between its two reads. */
export const ANIM_FRAME_TICKS = 6;

/** The split run's two viewports: the left half follows the crate, the right the animated sprite. */
export const SPLIT_VIEWPORTS: readonly ViewportDef[] = [
  { rect: [0, 0, 0.5, 1], frame: { entity: "crate" } },
  { rect: [0.5, 0, 0.5, 1], frame: { entity: ANIM_ENTITY } },
];
