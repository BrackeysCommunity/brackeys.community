/**
 * What the browser smoke's render run draws and where it reads it, shared by
 * the page, the runner and their tests: the engine project's kitchen sink,
 * framed on its crate, whose sprite is the `crates` atlas's `crate-0` frame.
 */
export const SINK_PROJECT = "engine";
export const SINK_SCENE = "kitchen-sink";

/** Where the preview server hands the page the engine project's registry and doc values. */
export const SINK_DATA_ROUTE = "/__smoke/engine-project.json";

export const SMOKE_BACKGROUND = 0x1a1a2e;

/** crate-0's one colour in `art/crates.png`. */
export const INSIDE_COLOUR = 0xff8800;

/** World px inside the crate's 72 px sprite and 8 px clear of its 40 px body, so only the sprite colours it. */
export const INSIDE_POINT: readonly [x: number, y: number] = [908, 1140];

/** World px of empty air above the crate: no sprite, body or path is drawn there. */
export const OUTSIDE_POINT: readonly [x: number, y: number] = [880, 1060];

/** The world rectangle the camera frames: both points with room around them. */
export const SINK_FRAME = { minX: 800, minY: 1020, maxX: 980, maxY: 1180 } as const;

/** The canvas the render run draws on, CSS px. */
export const SINK_CANVAS = { width: 640, height: 360 } as const;
