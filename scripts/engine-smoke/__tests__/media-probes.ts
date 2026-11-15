import type { AudioProbe, SignProbe } from "../browser/media-compare";
import { SIGN_GRID } from "../browser/signs";

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
  leftShare: 1,
  offlineChannels: 2,
};
