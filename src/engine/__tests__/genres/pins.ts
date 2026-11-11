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
  },
  "local-versus": {
    default: "12df0b2a076791a9",
    "gravity-sideways": "12df0b2a076791a9",
  },
  "point-and-click": {
    default: "c5ebb0dcd62a5eb9",
    "gravity-sideways": "c5ebb0dcd62a5eb9",
  },
  "rhythm-tap": {
    default: "127621617ae3b5ea",
  },
  roguelike: {
    default: "972e5b44222b3c85",
    "seed-1": "9c62e6c6b4ca4279",
    "seed-2": "ffb15c3655faa69d",
  },
  shooter: {
    default: "4dd470a4dc153377",
    "physics-none": "b5661858ad5063c3",
  },
  "top-down": {
    default: "6576f4399893ef40",
    "gravity-sideways": "6576f4399893ef40",
    "physics-none": "7606f4e008e235f1",
  },
  "tower-defense": {
    default: "7b78ff5b782483c4",
  },
  "turn-tactics": {
    default: "355be025a7f4aeda",
    "gravity-sideways": "355be025a7f4aeda",
  },
};
