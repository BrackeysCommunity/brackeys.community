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
  roguelike: {
    default: "972e5b44222b3c85",
    "seed-1": "9c62e6c6b4ca4279",
    "seed-2": "ffb15c3655faa69d",
  },
  shooter: {
    default: "6ee5f194096c60ad",
    "physics-none": "03517a7626c281e3",
  },
  "top-down": {
    default: "9ee7c39df0029a3c",
    "gravity-sideways": "9ee7c39df0029a3c",
    "physics-none": "c25e4156baea41d7",
  },
  "turn-tactics": {
    default: "02dbaee4275a508b",
    "gravity-sideways": "02dbaee4275a508b",
  },
};
