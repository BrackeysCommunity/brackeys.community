import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../../game/define";
import type { EntityDef, SceneDefinition, ShapeObj } from "../../../scene/types";
import type { GizmoHandle } from "../../tools";
import {
  frameHandles,
  selectionHandles,
  shapeHandles,
  shapePivot,
  targetHandles,
} from "../handles";
import { gizmoTarget } from "../target";

/** Screen px per metre at zoom 1. */
const S = 100;

const rotateOf = (hs: readonly GizmoHandle[]) => hs.filter((h) => h.kind === "rotate");

describe("rotate stalks", () => {
  const shapes: ShapeObj[] = [
    { type: "box", cx: 2, cy: 3, hw: 0.5, hh: 0.25, rotDeg: 30 },
    { type: "capsule", cx: 4, cy: 1, halfLen: 0.3, r: 0.1, rotDeg: 0 },
    {
      type: "poly",
      pts: [
        [6, 4],
        [7, 4],
        [6.5, 3],
      ],
    },
    {
      type: "chain",
      pts: [
        [1, 3],
        [3, 3],
        [4, 2],
      ],
    },
  ];

  it("hangs every shape's rotate handle on a stalk from the point it turns about", () => {
    for (const s of shapes) {
      const [rotate, ...more] = rotateOf(shapeHandles(s, S));
      expect(more, s.type).toEqual([]);
      expect(rotate!.stalk, s.type).toEqual(shapePivot(s));
    }
  });

  it("hangs a multi-selection's rotate handle from the box's centre, as a node's hangs from its origin", () => {
    const [, rotate] = selectionHandles({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 1);
    expect(rotate!.stalk).toEqual([50, 25]);
    const [, frame] = frameHandles({ at: [3, 4], rot: 0 }, undefined, S);
    expect(frame!.stalk).toEqual([3, 4]);
  });

  it("keeps a collider's stalk on its pivot where its handle moves off an arrow", () => {
    const pusher: EntityDef = {
      id: "push",
      type: "marker",
      at: [5, 5],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.5, 0.25], sensor: true },
        "force-area": { force: [0, -20] },
      },
    };
    const def: SceneDefinition = {
      v: 1,
      name: "stalks",
      bounds: [0, 0, 20, 20],
      settings: { physics: "rapier" },
      entities: [pusher],
    };
    const t = gizmoTarget(def, createRegistry(), "push")!;
    const rotate = targetHandles(t, { scale: S }).find((h) => h.id === "collider:rotate")!;
    expect(rotate.stalk).toEqual([5, 5]);
    expect(rotate.at[1]).toBeGreaterThan(5);
  });
});
