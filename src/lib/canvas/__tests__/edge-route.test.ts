import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  type Box,
  type EdgeDrawing,
  EdgeRouter,
  nearestSides,
  type RouteCard,
  separateOverlaps,
} from "../edge-route";

const FIXTURES = join(import.meta.dirname, "fixtures");

const card = (id: string, x: number, y: number, w = 200, h = 100, type = "text"): RouteCard => ({
  id,
  type,
  x,
  y,
  w,
  h,
});

/** The corners and ends a drawing passes through, in order. */
function pointsOf(d: string): [number, number][] {
  return [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

function crosses(points: [number, number][], box: Box): boolean {
  // Sampled finely enough for axis-aligned segments and the short corner curves.
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1]!;
    const [bx, by] = points[k]!;
    for (let t = 0; t <= 1; t += 0.01) {
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      if (x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h) return true;
    }
  }
  return false;
}

describe("nearestSides", () => {
  it("faces the cards along the longer axis", () => {
    expect(nearestSides(card("a", 0, 0), card("b", 500, 50))).toEqual(["right", "left"]);
    expect(nearestSides(card("a", 0, 500), card("b", 50, 0))).toEqual(["top", "bottom"]);
  });
});

describe("EdgeRouter", () => {
  const a = card("a", 0, 0);
  const b = card("b", 800, 0);
  const blocker = card("c", 350, -50, 200, 200);

  it("keeps the curve when nothing is in the way", () => {
    const drawing = new EdgeRouter([a, b]).draw(a, b);
    expect(drawing.routed).toBe(false);
    expect(drawing.d).toMatch(/^M200,50 C/);
    expect(drawing.start).toEqual({ x: 200, y: 50, side: "right" });
    expect(drawing.end).toEqual({ x: 800, y: 50, side: "left" });
  });

  it("goes around a card between the two ends", () => {
    const drawing = new EdgeRouter([a, b, blocker]).draw(a, b);
    expect(drawing.routed).toBe(true);
    const points = pointsOf(drawing.d);
    expect(points[0]).toEqual([200, 50]);
    expect(points.at(-1)).toEqual([800, 50]);
    expect(crosses(points, blocker)).toBe(false);
    // Leaves and arrives square to the sides.
    expect(points[1]![1]).toBe(50);
    expect(points.at(-2)![1]).toBe(50);
  });

  it("honours the sides the file gives", () => {
    const drawing = new EdgeRouter([a, b, blocker]).draw(a, b, "bottom", "bottom");
    expect(drawing.start).toEqual({ x: 100, y: 100, side: "bottom" });
    expect(drawing.end).toEqual({ x: 900, y: 100, side: "bottom" });
    expect(crosses(pointsOf(drawing.d), blocker)).toBe(false);
  });

  it("routes a curve that doubles back through its own card", () => {
    // Leaving `a` by its left side for a card to its right swings back across `a`.
    const drawing = new EdgeRouter([a, b]).draw(a, b, "left", "left");
    expect(drawing.routed).toBe(true);
    const points = pointsOf(drawing.d);
    expect(crosses(points, a)).toBe(false);
    expect(crosses(points, b)).toBe(false);
  });

  it("isn't stopped by groups", () => {
    const group = card("g", -100, -100, 1200, 400, "group");
    expect(new EdgeRouter([group, a, b]).draw(a, b).routed).toBe(false);
  });

  it("draws the same route whatever order the cards come in", () => {
    const more = [card("d", 300, 200), card("e", 600, -200), card("f", 450, 250, 80, 80)];
    const forward = new EdgeRouter([a, b, blocker, ...more]).draw(a, b);
    const reversed = new EdgeRouter([...more, blocker, b, a]).draw(a, b);
    const shuffled = new EdgeRouter([more[2]!, b, more[0]!, blocker, a, more[1]!]).draw(a, b);
    expect(reversed.d).toBe(forward.d);
    expect(shuffled.d).toBe(forward.d);
  });

  it("leaves by another side when a card covers its own, keeping the file's for matching", () => {
    const under = card("u", 150, 0, 100, 100);
    const drawing = new EdgeRouter([a, b, blocker, under]).draw(a, b);
    expect(drawing.routed).toBe(true);
    expect(drawing.start.side).not.toBe("right");
    expect(drawing.anchors[0]).toEqual({ x: 200, y: 50, side: "right" });
    const points = pointsOf(drawing.d);
    expect(crosses(points, blocker)).toBe(false);
    expect(crosses(points, under)).toBe(false);
  });

  it("switches sides when a card sits too close to an end for a clear route", () => {
    // 4px below `a`'s bottom: no route fits leaving downward.
    const below = card("n", 0, 104, 200, 100);
    const target = card("t", 0, 600);
    const drawing = new EdgeRouter([a, below, target]).draw(a, target, "bottom", "top");
    expect(drawing.routed).toBe(true);
    expect(drawing.start.side).not.toBe("bottom");
    expect(crosses(pointsOf(drawing.d), below)).toBe(false);
  });

  it.each(readdirSync(FIXTURES).filter((f) => f.endsWith(".canvas")))(
    "routes %s without a routed line crossing a card",
    (name) => {
      const canvas = JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as {
        nodes?: { id: string; type: string; x: number; y: number; width: number; height: number }[];
        edges?: { fromNode: string; toNode: string; fromSide?: string; toSide?: string }[];
      };
      const cards = (canvas.nodes ?? []).map((n) =>
        card(n.id, n.x, n.y, n.width, n.height, n.type),
      );
      const byId = new Map(cards.map((c) => [c.id, c]));
      const router = new EdgeRouter(cards);
      for (const edge of canvas.edges ?? []) {
        const from = byId.get(edge.fromNode);
        const to = byId.get(edge.toNode);
        if (!from || !to) continue;
        const drawing = router.draw(from, to, edge.fromSide, edge.toSide);
        if (!drawing.routed) continue;
        const points = pointsOf(drawing.d);
        for (const other of cards) {
          if (other.type === "group") continue;
          expect(crosses(points, other), `${name}: ${edge.fromNode}→${edge.toNode}`).toBe(false);
        }
      }
    },
  );
});

/** Pairs of segments from different lines that run along the same line for more than a pixel. */
function sharedStretches(lines: Map<string, [number, number][]>): string[] {
  const segs: { id: string; axis: number; at: number; lo: number; hi: number }[] = [];
  for (const [id, p] of lines) {
    for (let k = 0; k < p.length - 1; k++) {
      const [ax, ay] = p[k]!;
      const [bx, by] = p[k + 1]!;
      if (ay === by && ax !== bx)
        segs.push({ id, axis: 0, at: ay, lo: Math.min(ax, bx), hi: Math.max(ax, bx) });
      else if (ax === bx && ay !== by)
        segs.push({ id, axis: 1, at: ax, lo: Math.min(ay, by), hi: Math.max(ay, by) });
    }
  }
  const out: string[] = [];
  for (const s of segs)
    for (const t of segs)
      if (
        s.id < t.id &&
        s.axis === t.axis &&
        s.at === t.at &&
        Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 1
      )
        out.push(`${s.id}/${t.id}@${s.at}`);
  return out;
}

describe("separateOverlaps", () => {
  // Two lines into the green card down the same channel, and one out of it
  // that shares their run along the top going the other way.
  const top = card("top", 600, 0, 200, 80);
  const left = card("left", 0, 300, 250, 120);
  const green = card("green", 150, 600, 220, 130);
  const cards = [top, left, green];
  const scene = (): [string, EdgeDrawing][] => {
    const router = new EdgeRouter(cards);
    return [
      ["top-green", router.draw(top, green, "top", "left")],
      ["left-green", router.draw(left, green, "right", "left")],
      ["green-top", router.draw(green, top, "bottom", "top")],
    ];
  };
  const shown = (drawings: [string, EdgeDrawing][]) => {
    const moved = separateOverlaps(drawings);
    return new Map(drawings.map(([id, d]) => [id, pointsOf((moved.get(id) ?? d).d)]));
  };

  it("spreads routes that share a stretch apart", () => {
    const drawings = scene();
    expect(drawings.every(([, d]) => d.routed)).toBe(true);
    const raw = new Map(drawings.map(([id, d]) => [id, d.route!.points]));
    expect(sharedStretches(raw)).not.toEqual([]);

    const lines = shown(drawings);
    expect(sharedStretches(lines)).toEqual([]);
    for (const [id, points] of lines) {
      // Ends stay on their cards; no line is pushed into one.
      expect(points[0]).toEqual(raw.get(id)![0]);
      expect(points.at(-1)).toEqual(raw.get(id)!.at(-1));
      for (const other of cards) expect(crosses(points, other)).toBe(false);
    }
  });

  it("gives the same lines whatever order the routes come in", () => {
    const forward = shown(scene());
    const backward = shown(scene().reverse());
    expect(backward).toEqual(forward);
  });

  it("leaves lines that only cross or meet end to end alone", () => {
    const routeOf = (points: [number, number][]): EdgeDrawing => {
      const end = { x: 0, y: 0, side: "top" as const };
      return {
        d: "",
        label: [0, 0],
        start: end,
        end,
        anchors: [end, end],
        bounds: { x: 0, y: 0, w: 0, h: 0 },
        routed: true,
        route: { points, clearance: 24 },
      };
    };
    const across = routeOf([
      [0, 0],
      [0, -24],
      [200, -24],
      [200, 0],
    ]);
    const down = routeOf([
      [100, -100],
      [76, -100],
      [76, 100],
      [100, 100],
    ]);
    const after = routeOf([
      [300, 0],
      [300, -24],
      [200, -24],
      [200, -50],
    ]);
    expect(
      separateOverlaps([
        ["a", across],
        ["b", down],
        ["c", after],
      ]).size,
    ).toBe(0);
  });
});
