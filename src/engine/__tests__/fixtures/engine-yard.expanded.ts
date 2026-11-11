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
  bounds: [0, 0, 20, 10],
  settings: {
    gravity: [0, 12],
    physics: "rapier",
    grid: null,
    view: { projection: "orthogonal" },
  },
  entities: [
    { id: "~solid:0", type: "solid", shape: box(10, 9.8, 10, 0.2) },
    { id: "~solid:1", type: "solid", shape: box(0.2, 5, 0.2, 5) },
    { id: "~solid:2", type: "solid", shape: box(19.8, 5, 0.2, 5) },
    { id: "ledge", type: "solid", shape: box(14, 8, 1.2, 0.1), oneWay: true },
    { id: "zone", type: "sensor", shape: box(9, 9.3, 0.4, 0.3), tags: ["goal"] },
    { id: "start", type: "marker", at: [3, 9.6], tags: ["spawn"] },
    { id: "avatar", type: "prop", shape: box(3, 9.4, 0.2, 0.2), density: 1, restitution: 0 },
    {
      id: "crate",
      type: "prop",
      shape: { type: "circle", cx: 12, cy: 9.4, r: 0.2 },
      density: 2,
      restitution: 0.3,
    },
    {
      id: "lift",
      type: "follower",
      shape: box(0, 0, 0.6, 0.08),
      path: {
        pts: [
          [17, 9],
          [17, 6],
        ],
        mode: "ping_pong",
        speed: 0.8,
        pauseMs: 400,
      },
    },
  ],
};

/** A fresh copy, for tests that mutate the scene. */
export function engineYard(): ExpandedScene {
  return structuredClone(ENGINE_YARD_EXPANDED);
}
