/**
 * Each genre probe's digest, by probe id and variant (`default` is the run
 * without one). CI's x86_64 runners compare against these, so a mismatch
 * there means a run doesn't reproduce across machines. Written by
 * `UPDATE_GENRE_PINS=1 vp test packages/engine/__tests__/genres/genres.test.ts`.
 */
export const GENRE_PINS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "behavior-yard": {
    default: "cd34fb179bb5c640",
  },
  "grid-puzzle": {
    default: "9ffe5388c1a4b159",
    "gravity-sideways": "9ffe5388c1a4b159",
    "gravity-zero": "9ffe5388c1a4b159",
    "pointer-swap": "d083b5bdbe433fac",
    "saved-mid-push": "9ffe5388c1a4b159",
    "saved-mid-swap": "d083b5bdbe433fac",
  },
  idle: {
    default: "8345d0a41bec5a71",
    "saved-mid-income": "8345d0a41bec5a71",
  },
  "local-versus": {
    default: "940edf933971dec4",
    "gravity-sideways": "940edf933971dec4",
    "saved-mid-round": "940edf933971dec4",
  },
  metroidvania: {
    default: "e6c5d3bf9e6c327e",
    saved: "e6c5d3bf9e6c327e",
  },
  "point-and-click": {
    default: "c7e11bc7913bc936",
    "gravity-sideways": "c7e11bc7913bc936",
    "saved-mid-dialogue": "c7e11bc7913bc936",
    "saved-mid-walk": "c7e11bc7913bc936",
  },
  racing: {
    default: "179b3c36684efd03",
    "physics-none": "c3837ee675ecd921",
    "saved-mid-lap": "c3837ee675ecd921",
  },
  "rhythm-tap": {
    default: "8f0e416f97461b72",
    "saved-between-passes": "8f0e416f97461b72",
    "saved-mid-chart": "8f0e416f97461b72",
  },
  roguelike: {
    default: "bb5dbb2466755115",
    "saved-mid-dig": "bb5dbb2466755115",
    "saved-mid-run": "bb5dbb2466755115",
    "seed-1": "b5bdc627ef29d9c8",
    "seed-2": "7ec729a17fce9bca",
  },
  rts: {
    default: "ed806238a948538f",
    "saved-mid-march": "ed806238a948538f",
  },
  shooter: {
    default: "576d7bca820e1f53",
    "physics-none": "86e51bdec7fc2f87",
    runner: "36dd14b2789c1225",
    "runner-physics-none": "f9ec4dca4f3509f7",
    "saved-physics-none": "86e51bdec7fc2f87",
    "saved-runner-physics-none": "f9ec4dca4f3509f7",
  },
  "side-scroller": {
    default: "b536860bdd410c2c",
  },
  "side-view-behaviors": {
    default: "ba49ed303de8181f",
    "saved-mid-jump": "ba49ed303de8181f",
    "saved-on-the-lift": "ba49ed303de8181f",
  },
  "top-down": {
    default: "6ca20cd57d8318d4",
    "gravity-sideways": "6ca20cd57d8318d4",
    "physics-none": "0d61addba808f5f0",
    "saved-physics-none": "0d61addba808f5f0",
  },
  "tower-defense": {
    default: "b039a55159fd6798",
    "saved-mid-wave": "b039a55159fd6798",
  },
  "tree-yard": {
    default: "d307e068e9b6254d",
  },
  "turn-tactics": {
    default: "355be025a7f4aeda",
    "gravity-sideways": "355be025a7f4aeda",
    "saved-mid-walk": "355be025a7f4aeda",
  },
  "versus-behaviors": {
    default: "5d5b88a286a37749",
    "saved-after-the-leave": "5d5b88a286a37749",
    "saved-mid-run": "5d5b88a286a37749",
  },
  "visual-novel": {
    default: "9d80925921e99d54",
    "saved-at-market": "9d80925921e99d54",
  },
};
