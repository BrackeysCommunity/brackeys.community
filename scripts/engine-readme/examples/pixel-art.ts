import { resolveResolution, viewportFor, type ResolutionPolicy } from "@jams/engine";
import { defineGame } from "@jams/engine/game";

import { coinGame } from "./coin-game";

/** A 640×360 world scaled by whole multiples, letterboxed, sampled nearest. */
const pixelArt: Partial<ResolutionPolicy> = {
  virtual: { width: 640, height: 360 },
  fit: "letterbox",
  integer: true,
  sampling: "nearest",
  antialias: false,
  pixelSnap: true,
};

export const pixelCoinGame = defineGame({ ...coinGame, resolution: pixelArt });

// The host's policy wins field by field, then the project's, then the game's.
const policy = resolveResolution({ game: pixelArt, host: { bars: 0x000000 } });
const { scale, view, offset } = viewportFor(policy, { width: 1920, height: 1080 });
console.log(scale, view, offset); // 3 { width: 640, height: 360 } { x: 0, y: 0 }
