import type { AudioProbe, SignProbe } from "../browser/media-compare";
import { SIGN_GRID } from "../browser/signs";
import { FOLLOW_FRAMES, FOLLOW_SPEED, type SmoothFollowProbe } from "../browser/smooth-follow";
import type { TilemapProbe } from "../browser/tilemaps";

const points = SIGN_GRID[0] * SIGN_GRID[1];

/** The page's sign and audio reads as a passing run reports them. */
export const signsDrawn: SignProbe = {
  bitmap: {
    font: "bitmap",
    renderer: "webgl",
    points,
    lit: 210,
    other: 12,
    sample: [255, 136, 0, 255],
    ms: 40,
  },
  web: {
    font: "web",
    renderer: "webgl",
    points,
    lit: 96,
    other: 60,
    sample: [64, 224, 255, 255],
    ms: 180,
  },
  loadedFaces: 1,
};

export const audioPlayed: AudioProbe = {
  context: "running",
  backend: "running",
  channels: 2,
  maxChannels: 2,
  patchMs: 200,
  endedMs: 212,
  held: null,
  leftShare: 1,
  offlineChannels: 2,
};

/** Both maps drawn: a stone cell on the square map, a moss one on the hex, the background off each. */
export const tilemapsDrawn: TilemapProbe = {
  square: {
    shape: "square",
    renderer: "webgl",
    tile: [138, 143, 153, 255],
    empty: [26, 26, 46, 255],
  },
  hex: { shape: "hex", renderer: "webgl", tile: [95, 158, 79, 255], empty: [26, 26, 46, 255] },
};

/** A run at `hz` whose hero sits at `x` on screen while the world passes at the hero's speed. */
export function followProbe(
  hz: number,
  x: (i: number) => number | null = () => 120,
): SmoothFollowProbe {
  const at = Array.from({ length: FOLLOW_FRAMES }, (_, i) => (i * 1000) / hz);
  return {
    renderer: "webgl",
    screen: at.map((_, i) => x(i)),
    origin: at.map((ms) => 120 - (FOLLOW_SPEED * 100 * ms) / 1000),
    at,
  };
}
