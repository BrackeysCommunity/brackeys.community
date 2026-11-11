/**
 * Each genre probe's digest, by probe id and variant (`default` is the run
 * without one). CI's x86_64 runners compare against these, so a mismatch
 * there means a run doesn't reproduce across machines. Written by
 * `UPDATE_GENRE_PINS=1 vp test src/engine/__tests__/genres/genres.test.ts`.
 */
export const GENRE_PINS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "grid-puzzle": {
    default: "8df0c7714f456fd0",
    "gravity-sideways": "8df0c7714f456fd0",
    "gravity-zero": "8df0c7714f456fd0",
    "saved-mid-push": "8df0c7714f456fd0",
  },
  "local-versus": {
    default: "940edf933971dec4",
    "gravity-sideways": "940edf933971dec4",
    "saved-mid-round": "940edf933971dec4",
  },
  "point-and-click": {
    default: "c5ebb0dcd62a5eb9",
    "gravity-sideways": "c5ebb0dcd62a5eb9",
    "saved-mid-walk": "c5ebb0dcd62a5eb9",
  },
  "rhythm-tap": {
    default: "127621617ae3b5ea",
    "saved-mid-chart": "127621617ae3b5ea",
  },
  roguelike: {
    default: "972e5b44222b3c85",
    "saved-mid-run": "972e5b44222b3c85",
    "seed-1": "9c62e6c6b4ca4279",
    "seed-2": "ffb15c3655faa69d",
  },
  shooter: {
    default: "576d7bca820e1f53",
    "physics-none": "86e51bdec7fc2f87",
    "saved-physics-none": "86e51bdec7fc2f87",
  },
  "top-down": {
    default: "5c0663a93c32f428",
    "gravity-sideways": "5c0663a93c32f428",
    "physics-none": "4ce46f44f64a27fd",
    "saved-physics-none": "4ce46f44f64a27fd",
  },
  "tower-defense": {
    default: "ea1f21e098681a71",
    "saved-mid-wave": "ea1f21e098681a71",
  },
  "turn-tactics": {
    default: "355be025a7f4aeda",
    "gravity-sideways": "355be025a7f4aeda",
    "saved-mid-walk": "355be025a7f4aeda",
  },
};
