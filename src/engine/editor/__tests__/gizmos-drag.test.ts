import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import { boxCorners } from "../../scene/shape-geometry";
import type { OpBatch, Pt, SceneDefinition, ShapeObj } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
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

function scene(): SceneDefinition {
  const def = structuredClone(yard) as unknown as SceneDefinition;
  def.entities!.push(
    { id: "wedge", type: "solid", shape: ["poly", 600, 400, 700, 400, 650, 300] },
    { id: "rail", type: "solid", shape: ["chain", 100, 300, 300, 300, 400, 200] },
    { id: "pill", type: "prop", shape: ["capsule", 800, 300, 30, 10], density: 1, restitution: 0 },
    {
      id: "orbit",
      type: "follower",
      shape: ["circle", 0, 0, 10],
      path: {
        pts: [
          [100, 100],
          [200, 100],
          [200, 200],
        ],
        mode: "loop",
        speed: 50,
      },
    },
  );
  return def;
}

const none = { shift: false, alt: false, mod: false };
const free: SnapSettings = { ...DEFAULT_SNAP, enabled: false };
const opts = (o: Partial<DragOptions> = {}): DragOptions => ({
  mods: none,
  snap: free,
  scale: 1,
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
  const b = { type: "box" as const, cx: 100, cy: 100, hw: 40, hh: 20, rotDeg: 0 };
  const plain = { alt: false, shift: false };

  it("anchors the opposite edge", () => {
    expect(resizeBox(b, "e", [200, 0], plain)).toMatchObject({ cx: 130, hw: 70, hh: 20, cy: 100 });
    expect(resizeBox(b, "nw", [40, 60], plain)).toMatchObject({ cx: 90, cy: 90, hw: 50, hh: 30 });
  });

  it("works from the centre with Alt, and keeps the aspect with Shift", () => {
    expect(resizeBox(b, "e", [200, 0], { alt: true, shift: false })).toMatchObject({
      cx: 100,
      hw: 100,
    });
    expect(resizeBox(b, "se", [220, 130], { alt: false, shift: true })).toMatchObject({
      hw: 80,
      hh: 40,
    });
    // An edge handle with Shift grows the other axis about the centre.
    expect(resizeBox(b, "e", [160, 0], { alt: false, shift: true })).toMatchObject({
      cx: 110,
      cy: 100,
      hw: 50,
      hh: 25,
    });
  });

  it("never collapses below 1px and snaps an unrotated edge to the grid", () => {
    expect(resizeBox(b, "e", [0, 0], plain)).toMatchObject({ hw: 1, cx: 61 });
    expect(resizeBox(b, "e", [190, 0], { ...plain, snap: DEFAULT_SNAP })).toMatchObject({
      hw: 66,
      cx: 126,
    });
    expect(
      resizeBox(b, "e", [190, 0], { ...plain, snap: DEFAULT_SNAP, bypass: true }),
    ).toMatchObject({ hw: 65 });
  });

  it("anchors the opposite edge in a rotated box's own frame", () => {
    const r = { ...b, rotDeg: 30 };
    const before = boxCorners(r);
    const next = resizeBox(r, "e", [250, 200], plain);
    const after = boxCorners(next);
    // Corners 0 and 3 are the west edge.
    for (const i of [0, 3]) {
      expect(after[i]![0]).toBeCloseTo(before[i]![0]);
      expect(after[i]![1]).toBeCloseTo(before[i]![1]);
    }
    expect(next.hw).toBeGreaterThan(40);
    expect(next.hh).toBe(20);
  });
});

describe("single-target gizmos round-trip", () => {
  it("resizes a box with a readout", () => {
    const def = scene();
    const e = edit(dragHandle(target(def, "ledge"), "resize:e", [1520, 800], [1600, 800], opts()));
    expect(e.readout).toBe("W 320 H 20");
    const next = roundTrip(def, e.batch);
    expect(field(next, "ledge")).toEqual(["box", 1440, 800, 160, 10]);
  });

  it("rotates a box in 15° steps, Shift free, readout in degrees", () => {
    const def = scene();
    const t = target(def, "ledge");
    // From straight above the centre to 37° clockwise of it.
    const from: Pt = [1400, 700];
    const to: Pt = [
      1400 + 100 * Math.sin((37 * Math.PI) / 180),
      800 - 100 * Math.cos((37 * Math.PI) / 180),
    ];
    const snapped = edit(dragHandle(t, "rotate", from, to, opts({ snap: DEFAULT_SNAP })));
    expect(snapped.readout).toBe("30°");
    expect(field(roundTrip(def, snapped.batch), "ledge")).toEqual(["box", 1400, 800, 120, 10, 30]);
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
    const back = edit(dragHandle(t, "rotate", from, [1300, 800], opts({ snap: DEFAULT_SNAP })));
    expect(back.readout).toBe("270°");
  });

  it("sets a circle's radius", () => {
    const def = scene();
    const e = edit(dragHandle(target(def, "crate"), "radius", [1220, 940], [1230.4, 940], opts()));
    expect(e.readout).toBe("R 30");
    expect(field(roundTrip(def, e.batch), "crate")).toEqual(["circle", 1200, 940, 30]);
  });

  it("sets a capsule's half-length and radius, and rotates it", () => {
    const def = scene();
    const t = target(def, "pill");
    const len = edit(dragHandle(t, "length", [800, 260], [800, 240], opts()));
    expect(len.readout).toBe("L 120");
    expect(field(roundTrip(def, len.batch), "pill")).toEqual(["capsule", 800, 300, 50, 10]);
    const r = edit(dragHandle(t, "radius", [810, 300], [825, 300], opts()));
    expect(field(roundTrip(def, r.batch), "pill")).toEqual(["capsule", 800, 300, 30, 25]);
    const rot = edit(dragHandle(t, "rotate", [800, 200], [900, 300], opts({ snap: DEFAULT_SNAP })));
    expect(field(roundTrip(def, rot.batch), "pill")).toEqual(["capsule", 800, 300, 30, 10, 90]);
  });

  it("rotates a poly about its centroid", () => {
    const def = scene();
    const t = target(def, "wedge");
    const e = edit(dragHandle(t, "rotate", [650, 200], [750, 367], opts({ snap: DEFAULT_SNAP })));
    expect(e.readout).toBe("90°");
    const next = roundTrip(def, e.batch);
    expect((field(next, "wedge") as unknown[]).length).toBe(7);
  });

  it("moves with one move op, snapped, and Ctrl/Cmd only rounds", () => {
    const def = scene();
    const t = target(def, "ledge");
    const e = edit(dragHandle(t, "move", [1500, 800], [1530, 790], opts({ snap: DEFAULT_SNAP })));
    // The right edge (1520) is nearest the grab and snaps to 1536; the top edge (790, a tie with the bottom) to 768.
    expect(e.batch?.ops).toEqual([{ op: "move", refs: ["ledge"], by: [16, -22] }]);
    expect(e.readout).toBe("Δ 16, -22");
    roundTrip(def, e.batch);
    const raw = edit(
      dragHandle(
        t,
        "move",
        [1500, 800],
        [1530.4, 790],
        opts({ snap: DEFAULT_SNAP, mods: { ...none, mod: true } }),
      ),
    );
    expect(raw.batch?.ops).toEqual([{ op: "move", refs: ["ledge"], by: [30, -10] }]);
    expect(dragHandle(t, "move", [1500, 800], [1500.2, 800], opts())!.batch).toBeNull();
  });

  it("snaps a move to another entity's edge with a guide", () => {
    const def = scene();
    const index = createSpatialIndex();
    index.rebuild(def, registry);
    // zone's right edge is at 940; avatar's left edge (280) is grabbed and dragged to 935.
    const e = edit(
      dragHandle(
        target(def, "avatar"),
        "move",
        [282, 940],
        [937, 940],
        opts({ snap: { ...DEFAULT_SNAP, step: 128 }, index }),
      ),
    );
    expect(e.batch?.ops).toEqual([{ op: "move", refs: ["avatar"], by: [660, -24] }]);
    // The x guide on zone's edge, and the y grid line the move also snapped to.
    expect(e.guides?.map((g) => g.from[0] === g.to[0])).toEqual([true, false]);
    expect(e.guides?.[0]?.from[0]).toBe(940);
  });

  it("moves a point entity and a bulk entry", () => {
    const def = scene();
    roundTrip(def, dragHandle(target(def, "start"), "move", [300, 960], [340, 960], opts())!.batch);
    const bulk = edit(
      dragHandle(target(def, "~solid:1"), "resize:e", [40, 500], [64, 500], opts()),
    );
    const next = roundTrip(def, bulk.batch);
    expect((next.solid as unknown[])[1]).toEqual(["box", 32, 500, 32, 500]);
    roundTrip(
      def,
      dragHandle(target(def, "~solid:2"), "move", [1980, 500], [1900, 500], opts())!.batch,
    );
  });

  it("edits a follower's local shape, and moves its whole path", () => {
    const def = scene();
    const t = target(def, "lift");
    const grow = edit(dragHandle(t, "resize:e", [1760, 900], [1780, 900], opts()));
    // The world box grows east; the stored shape stays local to waypoint 0.
    expect(field(roundTrip(def, grow.batch), "lift")).toEqual(["box", 10, 0, 70, 8]);
    const move = edit(dragHandle(t, "move", [1700, 900], [1600, 900], opts()));
    expect(move.batch?.ops).toEqual([{ op: "move", refs: ["lift"], by: [-100, 0] }]);
    expect(move.pts).toEqual([
      [1600, 900],
      [1600, 600],
    ]);
    const moved = roundTrip(def, move.batch);
    expect((field(moved, "lift", "path") as { pts: Pt[] }).pts).toEqual([
      [1600, 900],
      [1600, 600],
    ]);
  });

  it("re-bases waypoint 0 with Alt", () => {
    const def = scene();
    const e = edit(
      dragHandle(
        target(def, "lift"),
        "move",
        [1700, 900],
        [1600, 880],
        opts({ mods: { ...none, alt: true } }),
      ),
    );
    const next = roundTrip(def, e.batch);
    expect((field(next, "lift", "path") as { pts: Pt[] }).pts).toEqual([
      [1600, 880],
      [1700, 600],
    ]);
    expect(field(next, "lift")).toEqual(["box", 0, 0, 60, 8]);
    expect(e.shape).toMatchObject({ cx: 1600, cy: 880 });
  });

  it("returns null for a handle the target doesn't have", () => {
    const def = scene();
    expect(dragHandle(target(def, "crate"), "resize:e", [0, 0], [1, 1], opts())).toBeNull();
    expect(dragHandle(target(def, "crate"), "rotate", [0, 0], [1, 1], opts())).toBeNull();
    expect(dragHandle(target(def, "start"), "radius", [0, 0], [1, 1], opts())).toBeNull();
  });
});

describe("vertices", () => {
  it("moves a vertex, flags a concave poly and offers Convert to chain", () => {
    const def = scene();
    const t = target(def, "wedge");
    const fine = edit(dragHandle(t, "vertex:2", [650, 300], [660, 290], opts()));
    expect(fine.concave).toBeUndefined();
    expect(fine.readout).toBe("Δ 10, -10");
    roundTrip(def, fine.batch);
    // Pushing a square's corner inwards makes it concave.
    const quad = scene();
    quad.entities!.find((x) => x.id === "wedge")!.shape = [
      "poly",
      600,
      400,
      700,
      400,
      700,
      300,
      600,
      300,
    ];
    const bad = edit(dragHandle(target(quad, "wedge"), "vertex:3", [600, 300], [680, 380], opts()));
    expect(bad.concave).toBe(true);
    const next = roundTrip(quad, bad.batch);
    const fix = convertToChainFix(next, registry, "wedge");
    expect(fix?.ops).toEqual([
      {
        op: "update",
        ref: "wedge",
        set: { shape: ["chain", 600, 400, 700, 400, 700, 300, 680, 380, 600, 400] },
      },
    ]);
    roundTrip(next, fix);
    expect(convertToChainFix(def, registry, "wedge")).toBeUndefined();
  });

  it("inserts at a segment's midpoint and drags it there", () => {
    const def = scene();
    const e = edit(dragHandle(target(def, "wedge"), "insert:2", [625, 350], [600, 330], opts()));
    expect(field(roundTrip(def, e.batch), "wedge")).toEqual([
      "poly",
      600,
      400,
      700,
      400,
      650,
      300,
      600,
      330,
    ]);
    const chain = edit(dragHandle(target(def, "rail"), "insert:0", [200, 300], [200, 310], opts()));
    expect(field(roundTrip(def, chain.batch), "rail")).toEqual([
      "chain",
      100,
      300,
      200,
      310,
      300,
      300,
      400,
      200,
    ]);
    expect(dragHandle(target(def, "rail"), "insert:2", [0, 0], [0, 0], opts())).toBeNull();
  });

  it("deletes vertices, keeping a poly at 3 and a chain at 2", () => {
    const def = scene();
    expect(removeVertices(target(def, "wedge"), [0])).toBeNull();
    const chain = edit(removeVertices(target(def, "rail"), [1]));
    expect(field(roundTrip(def, chain.batch), "rail")).toEqual(["chain", 100, 300, 400, 200]);
    expect(removeVertices(target(def, "rail"), [0, 1])).toBeNull();
    const quad = scene();
    quad.entities!.find((e) => e.id === "wedge")!.shape = [
      "poly",
      600,
      400,
      700,
      400,
      700,
      300,
      600,
      300,
    ];
    const tri = edit(removeVertices(target(quad, "wedge"), [3]));
    expect(field(roundTrip(quad, tri.batch), "wedge")).toEqual([
      "poly",
      600,
      400,
      700,
      400,
      700,
      300,
    ]);
  });
});

describe("waypoints", () => {
  it("moves one waypoint, snapped", () => {
    const def = scene();
    const e = edit(
      dragHandle(
        target(def, "lift"),
        "waypoint:1",
        [1700, 600],
        [1690, 570],
        opts({ snap: DEFAULT_SNAP }),
      ),
    );
    expect(e.pts).toEqual([
      [1700, 900],
      [1664, 576],
    ]);
    roundTrip(def, e.batch);
  });

  it("inserts on a segment, a loop's closing one too", () => {
    const def = scene();
    const t = target(def, "orbit");
    const mid = edit(dragHandle(t, "insert:0", [150, 100], [150, 90], opts()));
    expect((field(roundTrip(def, mid.batch), "orbit", "path") as { pts: Pt[] }).pts).toEqual([
      [100, 100],
      [150, 90],
      [200, 100],
      [200, 200],
    ]);
    const closing = edit(dragHandle(t, "insert:2", [150, 150], [140, 160], opts()));
    expect(closing.pts).toEqual([
      [100, 100],
      [200, 100],
      [200, 200],
      [140, 160],
    ]);
    roundTrip(def, closing.batch);
    // A ping-pong path has no closing segment.
    expect(dragHandle(target(def, "lift"), "insert:1", [0, 0], [0, 0], opts())).toBeNull();
  });

  it("deletes waypoints, keeping 2", () => {
    const def = scene();
    expect(removeWaypoints(target(def, "lift"), [0])).toBeNull();
    const e = edit(removeWaypoints(target(def, "orbit"), [0]));
    const next = roundTrip(def, e.batch);
    expect((field(next, "orbit", "path") as { pts: Pt[] }).pts).toEqual([
      [200, 100],
      [200, 200],
    ]);
    // The shape rides the new first waypoint.
    expect(e.shape).toMatchObject({ type: "circle", cx: 200, cy: 100 });
  });
});

describe("multi-selection", () => {
  const refs = ["ledge", "start", "lift", "~solid:1", "wedge"];

  it("frames every target and moves them in one op", () => {
    const def = scene();
    const ts = refs.map((r) => target(def, r));
    expect(selectionBox(ts)).toEqual({ minX: 0, minY: 0, maxX: 1760, maxY: 1000 });
    const e = edit(dragSelection(ts, "move", [500, 500], [532, 500], opts({ snap: DEFAULT_SNAP })));
    expect(e.batch?.ops).toEqual([{ op: "move", refs, by: [64, 0] }]);
    roundTrip(def, e.batch);
  });

  it("rotates every kind of target about the box's centre in one batch", () => {
    const def = scene();
    const ts = refs.map((r) => target(def, r));
    const e = edit(
      dragSelection(ts, "rotate", [880, -100], [1600, 500], opts({ snap: DEFAULT_SNAP })),
    );
    expect(e.readout).toBe("90°");
    expect(e.batch?.ops).toHaveLength(refs.length);
    const next = roundTrip(def, e.batch);
    // The follower's local box turns with its path.
    expect(field(next, "lift")).toEqual(["box", 0, 0, 60, 8, 90]);
    expect(dragSelection(ts, "resize:e", [0, 0], [1, 1], opts())).toBeNull();
  });

  it("returns no batch for a turn that changes nothing", () => {
    const def = scene();
    expect(rotateTargetsBatch([target(def, "crate")], [1200, 940], 90)).toBeNull();
    expect(moveBatch(["crate"], [0.3, -0.2])).toBeNull();
  });
});

describe("previews", () => {
  it("report the shape as it commits", () => {
    const def = scene();
    const e = edit(dragHandle(target(def, "crate"), "radius", [1220, 940], [1225.6, 940], opts()));
    expect(e.shape).toEqual({ type: "circle", cx: 1200, cy: 940, r: 26 } satisfies ShapeObj);
  });
});
