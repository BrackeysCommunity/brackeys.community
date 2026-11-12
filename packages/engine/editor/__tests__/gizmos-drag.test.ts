import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import { boxCorners } from "../../scene/shape-geometry";
import type { OpBatch, Pt, SceneDefinition, ShapeObj } from "../../scene/types";
import { isWholePixel } from "../../scene/units";
import {
  convertToChainFix,
  dragHandle,
  dragSelection,
  gizmoTarget,
  moveBatch,
  removeVertices,
  removeWaypoints,
  resizeBox,
  rotateTargetsBatch,
  selectionBox,
  type DragOptions,
  type GizmoEdit,
} from "../gizmos";
import { createSpatialIndex } from "../spatial-index";
import { DEFAULT_SNAP, type SnapSettings } from "../tools";

const registry = createRegistry();
/** The engine registry's px per metre. */
const PPM = 100;

/** The engine yard in metres, with a few more shapes. */
function scene(): SceneDefinition {
  return {
    v: 3,
    name: "engine-yard",
    bounds: [0, 0, 20, 10],
    settings: { gravity: [0, 12] },
    solid: [
      ["box", 10, 9.8, 10, 0.2],
      ["box", 0.2, 5, 0.2, 5],
      ["box", 19.8, 5, 0.2, 5],
    ],
    entities: [
      { id: "ledge", type: "solid", shape: ["box", 14, 8, 1.2, 0.1], oneWay: true },
      {
        id: "avatar",
        type: "prop",
        shape: ["box", 3, 9.4, 0.2, 0.2],
        density: 1,
        restitution: 0,
      },
      {
        id: "crate",
        type: "prop",
        shape: ["circle", 12, 9.4, 0.2],
        density: 2,
        restitution: 0.3,
      },
      {
        id: "lift",
        type: "follower",
        shape: ["box", 0, 0, 0.6, 0.08],
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
      { id: "zone", type: "sensor", shape: ["box", 9, 9.3, 0.4, 0.3], tags: ["goal"] },
      { id: "start", type: "marker", at: [3, 9.6], tags: ["spawn"] },
      { id: "readme", type: "note", at: [1, 1], text: "Engine fixture: primitives only." },
      { id: "wedge", type: "solid", shape: ["poly", 6, 4, 7, 4, 6.5, 3] },
      { id: "rail", type: "solid", shape: ["chain", 1, 3, 3, 3, 4, 2] },
      {
        id: "pill",
        type: "prop",
        shape: ["capsule", 8, 3, 0.3, 0.1],
        density: 1,
        restitution: 0,
      },
      {
        id: "orbit",
        type: "follower",
        shape: ["circle", 0, 0, 0.1],
        path: {
          pts: [
            [1, 1],
            [2, 1],
            [2, 2],
          ],
          mode: "loop",
          speed: 0.5,
        },
      },
    ],
  } as SceneDefinition;
}

const none = { shift: false, alt: false, mod: false };
const free: SnapSettings = { ...DEFAULT_SNAP, enabled: false };
/** A 0.64 m grid. */
const grid64: SnapSettings = { ...DEFAULT_SNAP, step: 0.64 };
const opts = (o: Partial<DragOptions> = {}): DragOptions => ({
  mods: none,
  snap: free,
  scale: PPM,
  pxPerMetre: PPM,
  ...o,
});

const target = (def: SceneDefinition, ref: string) => {
  const t = gizmoTarget(def, registry, ref);
  if (!t) throw new Error(`no target ${ref}`);
  return t;
};

/** Applies `batch`, then its inverse; the scene hash must come back. Returns the edited scene. */
function roundTrip(def: SceneDefinition, batch: OpBatch | null | undefined): SceneDefinition {
  if (!batch) throw new Error("expected a batch");
  const fwd = applyOps(def, { ...batch, base: sceneHash(def) }, registry);
  if (!fwd.ok) throw new Error(fwd.issue.message);
  const back = applyOps(fwd.def, fwd.inverse, registry);
  if (!back.ok) throw new Error(back.issue.message);
  expect(back.hash).toBe(sceneHash(def));
  expect(fwd.hash).not.toBe(sceneHash(def));
  return fwd.def;
}

const field = (def: SceneDefinition, id: string, key = "shape") =>
  def.entities!.find((e) => e.id === id)![key];

function edit(e: GizmoEdit | null): GizmoEdit {
  if (!e) throw new Error("expected an edit");
  return e;
}

describe("resizeBox", () => {
  const b = { type: "box" as const, cx: 1, cy: 1, hw: 0.4, hh: 0.2, rotDeg: 0 };
  const plain = { alt: false, shift: false, pxPerMetre: PPM };

  it("anchors the opposite edge", () => {
    expect(resizeBox(b, "e", [2, 0], plain)).toMatchObject({ cx: 1.3, hw: 0.7, hh: 0.2, cy: 1 });
    expect(resizeBox(b, "nw", [0.4, 0.6], plain)).toMatchObject({
      cx: 0.9,
      cy: 0.9,
      hw: 0.5,
      hh: 0.3,
    });
  });

  it("works from the centre with Alt, and keeps the aspect with Shift", () => {
    expect(resizeBox(b, "e", [2, 0], { ...plain, alt: true })).toMatchObject({ cx: 1, hw: 1 });
    expect(resizeBox(b, "se", [2.2, 1.3], { ...plain, shift: true })).toMatchObject({
      hw: 0.8,
      hh: 0.4,
    });
    // An edge handle with Shift grows the other axis about the centre.
    expect(resizeBox(b, "e", [1.6, 0], { ...plain, shift: true })).toMatchObject({
      cx: 1.1,
      cy: 1,
      hw: 0.5,
      hh: 0.25,
    });
  });

  it("never collapses below one world px and snaps an unrotated edge to the grid", () => {
    expect(resizeBox(b, "e", [0, 0], plain)).toMatchObject({ hw: 0.01, cx: 0.61 });
    expect(resizeBox(b, "e", [1.9, 0], { ...plain, snap: grid64 })).toMatchObject({
      hw: 0.66,
      cx: 1.26,
    });
    expect(resizeBox(b, "e", [1.9, 0], { ...plain, snap: grid64, bypass: true })).toMatchObject({
      hw: 0.65,
    });
  });

  it("lands half-extents on whole world px at 32 and 48 px per metre", () => {
    for (const ppm of [32, 48]) {
      const next = resizeBox(b, "se", [1.7777, 1.5432], { ...plain, pxPerMetre: ppm });
      expect(isWholePixel(next.hw, ppm)).toBe(true);
      expect(isWholePixel(next.hh, ppm)).toBe(true);
      expect(resizeBox(b, "e", [0, 0], { ...plain, pxPerMetre: ppm }).hw).toBeCloseTo(1 / ppm, 6);
    }
  });

  it("anchors the opposite edge in a rotated box's own frame", () => {
    const r = { ...b, rotDeg: 30 };
    const before = boxCorners(r);
    const next = resizeBox(r, "e", [2.5, 2], plain);
    const after = boxCorners(next);
    // Corners 0 and 3 are the west edge.
    for (const i of [0, 3]) {
      expect(after[i]![0]).toBeCloseTo(before[i]![0]);
      expect(after[i]![1]).toBeCloseTo(before[i]![1]);
    }
    expect(next.hw).toBeGreaterThan(0.4);
    expect(next.hh).toBe(0.2);
  });
});

describe("single-target gizmos round-trip", () => {
  it("resizes a box with a readout in metres", () => {
    const def = scene();
    const e = edit(dragHandle(target(def, "ledge"), "resize:e", [15.2, 8], [16, 8], opts()));
    expect(e.readout).toBe("W 3.2 H 0.2 m");
    const next = roundTrip(def, e.batch);
    expect(field(next, "ledge")).toEqual(["box", 14.4, 8, 1.6, 0.1]);
  });

  it("rotates a box in 15° steps, Shift free, readout in degrees", () => {
    const def = scene();
    const t = target(def, "ledge");
    // From straight above the centre to 37° clockwise of it.
    const from: Pt = [14, 7];
    const to: Pt = [14 + Math.sin((37 * Math.PI) / 180), 8 - Math.cos((37 * Math.PI) / 180)];
    const snapped = edit(dragHandle(t, "rotate", from, to, opts({ snap: DEFAULT_SNAP })));
    expect(snapped.readout).toBe("30°");
    expect(field(roundTrip(def, snapped.batch), "ledge")).toEqual(["box", 14, 8, 1.2, 0.1, 30]);
    const loose = edit(
      dragHandle(
        t,
        "rotate",
        from,
        to,
        opts({ snap: DEFAULT_SNAP, mods: { ...none, shift: true } }),
      ),
    );
    expect(loose.readout).toBe("37°");
    // Counter-clockwise lands in [0, 360).
    const back = edit(dragHandle(t, "rotate", from, [13, 8], opts({ snap: DEFAULT_SNAP })));
    expect(back.readout).toBe("270°");
  });

  it("sets a circle's radius on whole world px", () => {
    const def = scene();
    const e = edit(dragHandle(target(def, "crate"), "radius", [12.2, 9.4], [12.304, 9.4], opts()));
    expect(e.readout).toBe("R 0.3 m");
    expect(field(roundTrip(def, e.batch), "crate")).toEqual(["circle", 12, 9.4, 0.3]);
  });

  it("sets a capsule's half-length and radius, and rotates it", () => {
    const def = scene();
    const t = target(def, "pill");
    const len = edit(dragHandle(t, "length", [8, 2.6], [8, 2.4], opts()));
    expect(len.readout).toBe("L 1.2 m");
    expect(field(roundTrip(def, len.batch), "pill")).toEqual(["capsule", 8, 3, 0.5, 0.1]);
    const r = edit(dragHandle(t, "radius", [8.1, 3], [8.25, 3], opts()));
    expect(field(roundTrip(def, r.batch), "pill")).toEqual(["capsule", 8, 3, 0.3, 0.25]);
    const rot = edit(dragHandle(t, "rotate", [8, 2], [9, 3], opts({ snap: DEFAULT_SNAP })));
    expect(field(roundTrip(def, rot.batch), "pill")).toEqual(["capsule", 8, 3, 0.3, 0.1, 90]);
  });

  it("rotates a poly about its centroid", () => {
    const def = scene();
    const t = target(def, "wedge");
    const e = edit(dragHandle(t, "rotate", [6.5, 2], [7.5, 3.67], opts({ snap: DEFAULT_SNAP })));
    expect(e.readout).toBe("90°");
    const next = roundTrip(def, e.batch);
    expect((field(next, "wedge") as unknown[]).length).toBe(7);
  });

  it("moves with one move op, snapped, and Ctrl/Cmd only lands on whole px", () => {
    const def = scene();
    const t = target(def, "ledge");
    const e = edit(dragHandle(t, "move", [15, 8], [15.3, 7.9], opts({ snap: grid64 })));
    // The right edge (15.2) is nearest the grab and snaps to 15.36; the top edge (7.9, a tie with the bottom) to 7.68.
    expect(e.batch?.ops).toEqual([{ op: "move", refs: ["ledge"], by: [0.16, -0.22] }]);
    expect(e.readout).toBe("Δ 0.16, -0.22 m");
    roundTrip(def, e.batch);
    const raw = edit(
      dragHandle(
        t,
        "move",
        [15, 8],
        [15.304, 7.9],
        opts({ snap: grid64, mods: { ...none, mod: true } }),
      ),
    );
    expect(raw.batch?.ops).toEqual([{ op: "move", refs: ["ledge"], by: [0.3, -0.1] }]);
    expect(dragHandle(t, "move", [15, 8], [15.002, 8], opts())!.batch).toBeNull();
  });

  it("lands a free move on whole world px at 32 and 48 px per metre", () => {
    const def = scene();
    for (const ppm of [32, 48]) {
      const e = edit(
        dragHandle(target(def, "ledge"), "move", [15, 8], [15.3333, 7.1234], {
          ...opts(),
          scale: ppm,
          pxPerMetre: ppm,
        }),
      );
      const op = e.batch?.ops[0] as { by: Pt };
      expect(op.by.every((v) => isWholePixel(v, ppm))).toBe(true);
    }
  });

  it("snaps a move to another entity's edge with a guide", () => {
    const def = scene();
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    // zone's right edge is at 9.4; avatar's left edge (2.8) is grabbed and dragged to 9.35.
    const e = edit(
      dragHandle(
        target(def, "avatar"),
        "move",
        [2.82, 9.4],
        [9.37, 9.4],
        opts({ snap: { ...DEFAULT_SNAP, step: 1.28 }, index }),
      ),
    );
    expect(e.batch?.ops).toEqual([{ op: "move", refs: ["avatar"], by: [6.6, -0.24] }]);
    // The x guide on zone's edge, and the y grid line the move also snapped to.
    expect(e.guides?.map((g) => g.from[0] === g.to[0])).toEqual([true, false]);
    expect(e.guides?.[0]?.from[0]).toBe(9.4);
  });

  it("moves a point entity and a bulk entry", () => {
    const def = scene();
    roundTrip(def, dragHandle(target(def, "start"), "move", [3, 9.6], [3.4, 9.6], opts())!.batch);
    const bulk = edit(dragHandle(target(def, "~solid:1"), "resize:e", [0.4, 5], [0.64, 5], opts()));
    const next = roundTrip(def, bulk.batch);
    expect((next.solid as unknown[])[1]).toEqual(["box", 0.32, 5, 0.32, 5]);
    roundTrip(def, dragHandle(target(def, "~solid:2"), "move", [19.8, 5], [19, 5], opts())!.batch);
  });

  it("edits a follower's local shape, and moves its whole path", () => {
    const def = scene();
    const t = target(def, "lift");
    const grow = edit(dragHandle(t, "resize:e", [17.6, 9], [17.8, 9], opts()));
    // The world box grows east; the stored shape stays local to waypoint 0.
    expect(field(roundTrip(def, grow.batch), "lift")).toEqual(["box", 0.1, 0, 0.7, 0.08]);
    const move = edit(dragHandle(t, "move", [17, 9], [16, 9], opts()));
    expect(move.batch?.ops).toEqual([{ op: "move", refs: ["lift"], by: [-1, 0] }]);
    expect(move.pts).toEqual([
      [16, 9],
      [16, 6],
    ]);
    const moved = roundTrip(def, move.batch);
    expect((field(moved, "lift", "path") as { pts: Pt[] }).pts).toEqual([
      [16, 9],
      [16, 6],
    ]);
  });

  it("re-bases waypoint 0 with Alt", () => {
    const def = scene();
    const e = edit(
      dragHandle(
        target(def, "lift"),
        "move",
        [17, 9],
        [16, 8.8],
        opts({ mods: { ...none, alt: true } }),
      ),
    );
    const next = roundTrip(def, e.batch);
    expect((field(next, "lift", "path") as { pts: Pt[] }).pts).toEqual([
      [16, 8.8],
      [17, 6],
    ]);
    expect(field(next, "lift")).toEqual(["box", 0, 0, 0.6, 0.08]);
    expect(e.shape).toMatchObject({ cx: 16, cy: 8.8 });
  });

  it("returns null for a handle the target doesn't have", () => {
    const def = scene();
    const tiny: Pt = [0.01, 0.01];
    expect(dragHandle(target(def, "crate"), "resize:e", [0, 0], tiny, opts())).toBeNull();
    expect(dragHandle(target(def, "crate"), "rotate", [0, 0], tiny, opts())).toBeNull();
    expect(dragHandle(target(def, "start"), "radius", [0, 0], tiny, opts())).toBeNull();
  });
});

describe("vertices", () => {
  const square = (def: SceneDefinition) => {
    def.entities!.find((x) => x.id === "wedge")!.shape = ["poly", 6, 4, 7, 4, 7, 3, 6, 3];
    return def;
  };

  it("moves a vertex, flags a concave poly and offers Convert to chain", () => {
    const def = scene();
    const t = target(def, "wedge");
    const fine = edit(dragHandle(t, "vertex:2", [6.5, 3], [6.6, 2.9], opts()));
    expect(fine.concave).toBeUndefined();
    expect(fine.readout).toBe("Δ 0.1, -0.1 m");
    roundTrip(def, fine.batch);
    // Pushing a square's corner inwards makes it concave.
    const quad = square(scene());
    const bad = edit(dragHandle(target(quad, "wedge"), "vertex:3", [6, 3], [6.8, 3.8], opts()));
    expect(bad.concave).toBe(true);
    const next = roundTrip(quad, bad.batch);
    const fix = convertToChainFix(next, registry, "wedge");
    expect(fix?.ops).toEqual([
      {
        op: "update",
        ref: "wedge",
        set: { shape: ["chain", 6, 4, 7, 4, 7, 3, 6.8, 3.8, 6, 4] },
      },
    ]);
    roundTrip(next, fix);
    expect(convertToChainFix(def, registry, "wedge")).toBeUndefined();
  });

  it("inserts at a segment's midpoint and drags it there", () => {
    const def = scene();
    const e = edit(dragHandle(target(def, "wedge"), "insert:2", [6.25, 3.5], [6, 3.3], opts()));
    expect(field(roundTrip(def, e.batch), "wedge")).toEqual(["poly", 6, 4, 7, 4, 6.5, 3, 6, 3.3]);
    const chain = edit(dragHandle(target(def, "rail"), "insert:0", [2, 3], [2, 3.1], opts()));
    expect(field(roundTrip(def, chain.batch), "rail")).toEqual(["chain", 1, 3, 2, 3.1, 3, 3, 4, 2]);
    expect(dragHandle(target(def, "rail"), "insert:2", [0, 0], [0, 0], opts())).toBeNull();
  });

  it("deletes vertices, keeping a poly at 3 and a chain at 2", () => {
    const def = scene();
    expect(removeVertices(target(def, "wedge"), [0], PPM)).toBeNull();
    const chain = edit(removeVertices(target(def, "rail"), [1], PPM));
    expect(field(roundTrip(def, chain.batch), "rail")).toEqual(["chain", 1, 3, 4, 2]);
    expect(removeVertices(target(def, "rail"), [0, 1], PPM)).toBeNull();
    const quad = square(scene());
    const tri = edit(removeVertices(target(quad, "wedge"), [3], PPM));
    expect(field(roundTrip(quad, tri.batch), "wedge")).toEqual(["poly", 6, 4, 7, 4, 7, 3]);
  });
});

describe("waypoints", () => {
  it("moves one waypoint, snapped", () => {
    const def = scene();
    const e = edit(
      dragHandle(target(def, "lift"), "waypoint:1", [17, 6], [16.9, 5.7], opts({ snap: grid64 })),
    );
    expect(e.pts).toEqual([
      [17, 9],
      [16.64, 5.76],
    ]);
    roundTrip(def, e.batch);
  });

  it("inserts on a segment, a loop's closing one too", () => {
    const def = scene();
    const t = target(def, "orbit");
    const mid = edit(dragHandle(t, "insert:0", [1.5, 1], [1.5, 0.9], opts()));
    expect((field(roundTrip(def, mid.batch), "orbit", "path") as { pts: Pt[] }).pts).toEqual([
      [1, 1],
      [1.5, 0.9],
      [2, 1],
      [2, 2],
    ]);
    const closing = edit(dragHandle(t, "insert:2", [1.5, 1.5], [1.4, 1.6], opts()));
    expect(closing.pts).toEqual([
      [1, 1],
      [2, 1],
      [2, 2],
      [1.4, 1.6],
    ]);
    roundTrip(def, closing.batch);
    // A ping-pong path has no closing segment.
    expect(dragHandle(target(def, "lift"), "insert:1", [0, 0], [0, 0], opts())).toBeNull();
  });

  it("deletes waypoints, keeping 2", () => {
    const def = scene();
    expect(removeWaypoints(target(def, "lift"), [0], PPM)).toBeNull();
    const e = edit(removeWaypoints(target(def, "orbit"), [0], PPM));
    const next = roundTrip(def, e.batch);
    expect((field(next, "orbit", "path") as { pts: Pt[] }).pts).toEqual([
      [2, 1],
      [2, 2],
    ]);
    // The shape rides the new first waypoint.
    expect(e.shape).toMatchObject({ type: "circle", cx: 2, cy: 1 });
  });
});

describe("multi-selection", () => {
  const refs = ["ledge", "start", "lift", "~solid:1", "wedge"];

  it("frames every target and moves them in one op", () => {
    const def = scene();
    const ts = refs.map((r) => target(def, r));
    expect(selectionBox(ts)).toEqual({ minX: 0, minY: 0, maxX: 17.6, maxY: 10 });
    const e = edit(dragSelection(ts, "move", [5, 5], [5.32, 5], opts({ snap: grid64 })));
    expect(e.batch?.ops).toEqual([{ op: "move", refs, by: [0.64, 0] }]);
    expect(applyOps(def, { ...e.batch!, base: sceneHash(def) }, registry).ok).toBe(true);
  });

  it("rotates every kind of target about the box's centre in one batch", () => {
    const def = scene();
    const ts = refs.map((r) => target(def, r));
    const e = edit(dragSelection(ts, "rotate", [8.8, -1], [16, 5], opts({ snap: DEFAULT_SNAP })));
    expect(e.readout).toBe("90°");
    expect(e.batch?.ops).toHaveLength(refs.length);
    const next = roundTrip(def, e.batch);
    // The follower's local box turns with its path.
    expect(field(next, "lift")).toEqual(["box", 0, 0, 0.6, 0.08, 90]);
    expect(dragSelection(ts, "resize:e", [0, 0], [0.01, 0.01], opts())).toBeNull();
  });

  it("returns no batch for a turn that changes nothing", () => {
    const def = scene();
    expect(rotateTargetsBatch([target(def, "crate")], [12, 9.4], 90, PPM)).toBeNull();
    expect(moveBatch(["crate"], [0.003, -0.002], PPM)).toBeNull();
  });
});

describe("previews", () => {
  it("report the shape as it commits", () => {
    const def = scene();
    const e = edit(dragHandle(target(def, "crate"), "radius", [12.2, 9.4], [12.256, 9.4], opts()));
    expect(e.shape).toEqual({ type: "circle", cx: 12, cy: 9.4, r: 0.26 } satisfies ShapeObj);
  });
});
