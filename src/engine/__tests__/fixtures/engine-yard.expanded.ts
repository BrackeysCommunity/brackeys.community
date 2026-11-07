import type { ExpandedScene, ShapeObj } from "../../scene/types";

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

/** `engine-yard.json` as `expandScene` returns it with the engine-only registry, built by hand. */
export const ENGINE_YARD_EXPANDED: ExpandedScene = {
  name: "engine-yard",
  bounds: [0, 0, 2000, 1000],
  settings: { gravity: [0, 1200] },
  entities: [
    { id: "~solid:0", type: "solid", shape: box(1000, 980, 1000, 20) },
    { id: "~solid:1", type: "solid", shape: box(20, 500, 20, 500) },
    { id: "~solid:2", type: "solid", shape: box(1980, 500, 20, 500) },
    { id: "ledge", type: "solid", shape: box(1400, 800, 120, 10), oneWay: true },
    { id: "zone", type: "sensor", shape: box(900, 930, 40, 30), tags: ["goal"] },
    { id: "start", type: "marker", at: [300, 960], tags: ["spawn"] },
    { id: "avatar", type: "prop", shape: box(300, 940, 20, 20), density: 1, restitution: 0 },
    {
      id: "crate",
      type: "prop",
      shape: { type: "circle", cx: 1200, cy: 940, r: 20 },
      density: 2,
      restitution: 0.3,
    },
    {
      id: "lift",
      type: "follower",
      shape: box(0, 0, 60, 8),
      path: {
        pts: [
          [1700, 900],
          [1700, 600],
        ],
        mode: "ping_pong",
        speed: 80,
        pauseMs: 400,
      },
    },
  ],
};

/** A fresh copy, for tests that mutate the scene. */
export function engineYard(): ExpandedScene {
  return structuredClone(ENGINE_YARD_EXPANDED);
}
