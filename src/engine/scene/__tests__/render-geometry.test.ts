import { describe, expect, it } from "vite-plus/test";

import { toolRegistry as registry } from "../../__tests__/fixtures/test-tool";
import { SIDES } from "../../game/fields";
import type { Side } from "../../game/types";
import { expandScene } from "../expand";
import { prefabLibrary } from "../prefab";
import { drawnEntities, oneWayEdge, oneWayEdges, oneWaySide } from "../render-geometry";
import { applyPt, applyVec, dihedral } from "../transform";
import { SCENE_FORMAT_VERSION, type Pt, type SceneDefinition } from "../types";

const scene = (over: Partial<SceneDefinition>): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  game: registry.game!.id,
  name: "one-way-yard",
  bounds: [0, 0, 2000, 1200],
  entities: [],
  ...over,
});

const edgesOf = (def: SceneDefinition, prefabs?: ReturnType<typeof prefabLibrary>) =>
  oneWayEdges(drawnEntities(expandScene(def, registry, { prefabs }), registry));

/** A 60×10 ledge centred on (40, 10) in its own frame. */
const LEDGE = { cx: 40, cy: 10, hw: 30, hh: 5 };
const NORMALS: Record<Side, Pt> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const faceMid = (side: Side): Pt => [
  LEDGE.cx + NORMALS[side][0] * LEDGE.hw,
  LEDGE.cy + NORMALS[side][1] * LEDGE.hh,
];
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

describe("oneWaySide", () => {
  it("reads true as up, a side as itself, and anything else as not one-way", () => {
    expect(oneWaySide(true)).toBe("up");
    for (const side of SIDES) expect(oneWaySide(side)).toBe(side);
    for (const v of [false, undefined, null, "top", 1]) expect(oneWaySide(v)).toBeNull();
  });
});

describe("oneWayEdge", () => {
  it("is the world box's face on each of the four sides, clockwise, with its outward normal", () => {
    const def = scene({
      entities: [
        ...SIDES.map((side) => ({
          id: `ledge-${side}`,
          type: "solid",
          shape: ["box", 100, 100, 30, 5] as const,
          oneWay: side,
        })),
        { id: "plain", type: "solid", shape: ["box", 100, 100, 30, 5] },
        { id: "default", type: "solid", shape: ["box", 100, 100, 30, 5], oneWay: true },
      ],
    } as Partial<SceneDefinition>);
    const edges = Object.fromEntries(
      edgesOf(def).map((e) => [e.entity.id, { side: e.side, from: e.from, to: e.to, n: e.normal }]),
    );
    expect(edges).toEqual({
      "ledge-up": { side: "up", from: [70, 95], to: [130, 95], n: [0, -1] },
      "ledge-right": { side: "right", from: [130, 95], to: [130, 105], n: [1, 0] },
      "ledge-down": { side: "down", from: [130, 105], to: [70, 105], n: [0, 1] },
      "ledge-left": { side: "left", from: [70, 105], to: [70, 95], n: [-1, 0] },
      default: { side: "up", from: [70, 95], to: [130, 95], n: [0, -1] },
    });
  });

  it("uses the shape's own box, not the sprite or path waypoints drawn with it", () => {
    const [d] = drawnEntities(
      expandScene(
        scene({
          entities: [
            {
              id: "rider",
              type: "solid",
              shape: ["box", 0, 0, 20, 4],
              oneWay: "up",
              behaviors: { sprite: { size: [200, 200] } },
            },
          ],
        } as Partial<SceneDefinition>),
        registry,
      ),
      registry,
    );
    expect(oneWayEdge(d!)).toMatchObject({ from: [-20, -4], to: [20, -4] });
  });

  it("draws nothing for a scene with no one-way solids", () => {
    expect(
      edgesOf(scene({ entities: [{ id: "s", type: "solid", shape: ["box", 0, 0, 5, 5] }] })),
    ).toEqual([]);
  });

  describe("turns and flips with its instance", () => {
    const at: Pt = [500, 300];
    const cases = SIDES.flatMap((side) =>
      ([0, 1, 2, 3] as const).flatMap((rot) => [false, true].map((flip) => ({ side, rot, flip }))),
    );
    it.each(cases)("$side, rot $rot, flip $flip", ({ side, rot, flip }) => {
      const prefabs = prefabLibrary([
        {
          kind: "prefab",
          v: SCENE_FORMAT_VERSION,
          id: "ledge",
          entities: [
            {
              id: "bar",
              type: "solid",
              shape: ["box", LEDGE.cx, LEDGE.cy, LEDGE.hw, LEDGE.hh],
              oneWay: side,
            },
          ],
        },
      ]);
      const def = scene({
        instances: [
          {
            id: "i",
            prefab: "ledge",
            at,
            ...(rot ? { rot } : {}),
            ...(flip ? { flip: true as const } : {}),
          },
        ],
      });
      const [edge, ...rest] = edgesOf(def, prefabs);
      expect(rest).toEqual([]);
      // The face that held actors in the prefab's frame still does, wherever it went.
      const t = dihedral({ rot, flip }, at);
      expect(mid(edge!.from, edge!.to)).toEqual(applyPt(t, faceMid(side)));
      expect(edge!.normal).toEqual(applyVec(t, NORMALS[side]));
      expect(edge!.side).toBe(
        SIDES.find((s) => NORMALS[s].join() === applyVec(t, NORMALS[side]).join()),
      );
    });

    it("composes a group's turn onto the instance's", () => {
      const prefabs = prefabLibrary([
        {
          kind: "prefab",
          v: SCENE_FORMAT_VERSION,
          id: "ledge",
          entities: [{ id: "bar", type: "solid", shape: ["box", 40, 10, 30, 5], oneWay: "up" }],
        },
      ]);
      const def = scene({
        groups: { g: { at: [0, 0], rot: 1 } },
        instances: [{ id: "i", prefab: "ledge", at, rot: 1, group: "g" }],
      } as Partial<SceneDefinition>);
      expect(edgesOf(def, prefabs).map((e) => e.side)).toEqual(["down"]);
    });
  });
});
