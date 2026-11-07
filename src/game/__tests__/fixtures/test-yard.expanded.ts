import type { ExpandedScene, Pt, ShapeObj } from "../../scene/types";

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

const solids: ShapeObj[] = [
  box(-255, 1040, 1745, 20),
  box(2855, 1040, 1145, 20),
  box(1200, 770, 10, 250),
  box(1400, 770, 10, 250),
  box(700, 940, 80, 8),
  box(500, 840, 80, 8),
  box(350, 720, 80, 8),
  box(820, 970, 40, 8),
  box(740, 920, 40, 8),
  box(660, 870, 40, 8),
  box(1600, 1160, 120, 10),
  box(1490, 1100, 10, 80),
  box(1710, 1100, 10, 80),
  box(200, 920, 10, 100),
];

const clouds: ShapeObj[] = [box(960, 900, 60, 6), box(960, 780, 60, 6), box(680, 850, 50, 6)];

const anchors: Pt[] = [
  [600, 600],
  [900, 500],
  [1100, 550],
  [400, 500],
];

/** `test-yard.json` as `expandScene` returns it, built by hand. */
export const TEST_YARD_EXPANDED: ExpandedScene = {
  name: "test-yard",
  bounds: [-2000, -500, 4000, 1200],
  spawn: [[960, 1020]],
  entities: [
    ...solids.map((shape, i) => ({ id: `~solid:${i}`, b: "solid" as const, shape })),
    { id: "~solid:ice:0", b: "solid", shape: box(100, 1000, 100, 8), material: "ice" },
    { id: "~solid:chocolate:0", b: "solid", shape: box(550, 970, 60, 8), material: "chocolate" },
    {
      id: "~solid:trampoline:0",
      b: "solid",
      shape: box(1600, 1120, 40, 8),
      material: "trampoline",
    },
    ...clouds.map((shape, i) => ({ id: `~cloud:${i}`, b: "cloud" as const, shape })),
    { id: "cheese", b: "sensor", kind: "goal", shape: { type: "circle", cx: 500, cy: 800, r: 12 } },
    { id: "hole", b: "sensor", kind: "exit", shape: { type: "circle", cx: 1850, cy: 1010, r: 20 } },
    { id: "lava", b: "sensor", kind: "hazard", shape: box(1600, 1160, 100, 8) },
    { id: "plank", b: "prop", shape: box(350, 700, 50, 6), density: 2, restitution: 0.2 },
    {
      id: "ball",
      b: "prop",
      shape: { type: "circle", cx: 780, cy: 900, r: 15 },
      density: 1.5,
      restitution: 0.6,
    },
    {
      id: "pit-shuttle",
      b: "mover",
      shape: box(0, 0, 50, 6),
      path: {
        pts: [
          [1500, 950],
          [1700, 950],
        ],
        mode: "ping_pong",
        speed: 80,
        pauseMs: 500,
      },
    },
    {
      id: "elevator",
      b: "mover",
      shape: box(0, 0, 40, 6),
      path: {
        pts: [
          [1300, 1000],
          [1300, 700],
        ],
        mode: "ping_pong",
        speed: 100,
        pauseMs: 800,
      },
    },
    {
      id: "diagonal",
      b: "mover",
      shape: box(0, 0, 35, 6),
      path: {
        pts: [
          [200, 800],
          [400, 700],
          [600, 750],
        ],
        mode: "loop",
        speed: 120,
        pauseMs: 300,
      },
    },
    ...anchors.map((at, i) => ({ id: `~anchor:${i}`, b: "anchor" as const, at })),
  ],
};

/** A fresh copy, for tests that mutate the scene. */
export function testYard(): ExpandedScene {
  return structuredClone(TEST_YARD_EXPANDED);
}
