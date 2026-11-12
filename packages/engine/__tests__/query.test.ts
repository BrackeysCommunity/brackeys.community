import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import type { EngineContext, EntitySelector } from "../game/types";
import { createPoseIndex, type PoseIndex } from "../runtime/poses";
import { createQueryIndex } from "../runtime/query-index";
import { createSceneRuntime } from "../runtime/runtime";
import { spawnPose } from "../runtime/spawn-pose";
import { containsPoint, distanceToShape, intersectsRect, isConvex } from "../scene/shape-geometry";
import type { Aabb, ExpandedScene, Pt, RuntimeEntity, ShapeObj } from "../scene/types";
import { Rng } from "../sim-kit/rng";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";

const DT = 1000 / 60;

const box = (cx: number, cy: number, hw: number, hh: number, rotDeg = 0): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg,
});

/** A query index over a pose index of its own, posing what it adds at its spawn pose. */
function bareIndex() {
  const registry = createRegistry();
  const poses: PoseIndex = createPoseIndex(() => 0);
  const ctx = { registry, poses } as unknown as EngineContext;
  const index = createQueryIndex(ctx);
  const add = (e: RuntimeEntity) => {
    const p = spawnPose(e, registry);
    if (!poses.has(e.id)) poses.set(e.id, p.x, p.y, p.rot, { snap: true });
    index.added(e);
    return e;
  };
  return { index, poses, add };
}

function filled() {
  const q = bareIndex();
  q.add({ id: "ground", type: "solid", shape: box(0, 100, 200, 10) });
  q.add({ id: "goal", type: "sensor", shape: box(50, 50, 10, 10), tags: ["goal", "end"] });
  q.add({ id: "start", type: "marker", at: [-50, 80], tags: ["spawn"] });
  q.add({ id: "wall", type: "solid", shape: box(150, 50, 10, 40) });
  q.add({ id: "flag", type: "marker", at: [60, 80], tags: ["goal"] });
  return q;
}

describe("type and tag queries", () => {
  it("lists by type, by tag and by selector, in spawn order", () => {
    const { index } = filled();
    expect(index.select()).toEqual(["ground", "goal", "start", "wall", "flag"]);
    expect(index.byType("solid")).toEqual(["ground", "wall"]);
    expect(index.byType("prop")).toEqual([]);
    expect(index.byTag("goal")).toEqual(["goal", "flag"]);
    expect(index.byTag("spawn")).toEqual(["start"]);
    expect(index.select({ type: ["marker", "sensor"] })).toEqual(["goal", "start", "flag"]);
    expect(index.select({ type: "marker", tag: "goal" })).toEqual(["flag"]);
    expect(index.count({ tag: "goal" })).toBe(2);
    expect(index.count()).toBe(5);
  });

  it("keeps an edited record's place and reads its new tags; a removed entity goes", () => {
    const { index, add } = filled();
    add({ id: "goal", type: "sensor", shape: box(50, 50, 10, 10), tags: ["exit"] });
    expect(index.select()).toEqual(["ground", "goal", "start", "wall", "flag"]);
    expect(index.byTag("goal")).toEqual(["flag"]);
    expect(index.byTag("exit")).toEqual(["goal"]);
    index.removed("ground");
    add({ id: "ground", type: "solid", shape: box(0, 100, 200, 10) });
    expect(index.select()).toEqual(["goal", "start", "wall", "flag", "ground"]);
    index.clear();
    expect(index.select()).toEqual([]);
    expect(index.extent("goal")).toBeUndefined();
  });

  it("skips disabled entities unless asked with enabled: false", () => {
    const { index } = filled();
    index.enabledChanged("goal", false);
    expect(index.byTag("goal")).toEqual(["flag"]);
    expect(index.select({ tag: "goal", enabled: false })).toEqual(["goal", "flag"]);
    expect(index.count()).toBe(4);
    expect(index.at({ x: 50, y: 50 })).toEqual([]);
    expect(index.at({ x: 50, y: 50 }, { enabled: false })).toEqual(["goal"]);
    expect(index.inArea(box(50, 50, 1, 1))).toEqual([]);
    expect(index.nearest({ x: 50, y: 50 })).toBe("flag");
    index.enabledChanged("goal", true);
    expect(index.byTag("goal")).toEqual(["goal", "flag"]);
  });
});

describe("area, point and nearest queries", () => {
  it("finds what an area touches, a box or a shape", () => {
    const { index } = filled();
    expect(index.inArea({ minX: 40, minY: 40, maxX: 70, maxY: 85 })).toEqual(["goal", "flag"]);
    expect(index.inArea({ minX: 140, minY: 0, maxX: 141, maxY: 1 })).toEqual([]);
    expect(index.inArea({ type: "circle", cx: 60, cy: 80, r: 1 })).toEqual(["flag"]);
    expect(index.inArea(box(0, 0, 500, 500), { type: "solid" })).toEqual(["ground", "wall"]);
    // Touching counts, as everywhere in the engine's geometry.
    expect(index.inArea({ minX: 160, minY: 50, maxX: 170, maxY: 60 })).toEqual(["wall"]);
  });

  it("finds what holds a point, its edge included", () => {
    const { index } = filled();
    expect(index.at({ x: 50, y: 50 })).toEqual(["goal"]);
    expect(index.at({ x: 150, y: 90 })).toEqual(["ground", "wall"]);
    expect(index.at({ x: -50, y: 80 })).toEqual(["start"]);
    expect(index.at({ x: -50, y: 81 })).toEqual([]);
  });

  it("finds the nearest by extent, ties to the earlier spawn, within maxDist", () => {
    const { index, add } = filled();
    expect(index.nearest({ x: 50, y: 30 })).toBe("goal");
    expect(index.nearest({ x: 50, y: 30 }, { type: "marker" })).toBe("flag");
    expect(index.nearest({ x: 50, y: 30 }, { tag: "spawn" })).toBe("start");
    expect(index.nearest({ x: 50, y: -100 }, { maxDist: 10 })).toBeUndefined();
    expect(index.nearest({ x: 50, y: 30 }, { maxDist: 10 })).toBe("goal");
    add({ id: "twin", type: "marker", at: [-50, 80] });
    expect(index.nearest({ x: -50, y: 70 }, { type: "marker" })).toBe("start");
    expect(index.nearest({ x: 300, y: 300 }, { type: "prop" })).toBeUndefined();
  });

  it("reads a concave walk area by its outline, not its hull", () => {
    const { index, add } = bareIndex();
    const room: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [60, 100],
      [60, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ];
    expect(isConvex(room)).toBe(false);
    add({ id: "room", type: "nav", shape: { type: "poly", pts: room } });
    expect(index.at({ x: 20, y: 80 })).toEqual(["room"]);
    expect(index.at({ x: 50, y: 80 })).toEqual([]);
    expect(index.inArea(box(50, 80, 5, 5))).toEqual([]);
    expect(index.inArea(box(50, 80, 15, 5))).toEqual(["room"]);
    expect(index.inArea(box(50, 50, 500, 500))).toEqual(["room"]);
    expect(index.nearest({ x: 50, y: 80 })).toBe("room");
    expect(distanceToShape(index.extent("room")!, [50, 80])).toBe(10);
  });
});

describe("area queries between moves", () => {
  it("sees a move, an addition, a removal and a dropped pose after its first query", () => {
    const { index, poses, add } = filled();
    const here: Aabb = { minX: 290, minY: 290, maxX: 310, maxY: 310 };
    expect(index.inArea(here)).toEqual([]);

    poses.set("flag", 300, 300);
    expect(index.inArea(here)).toEqual(["flag"]);
    expect(index.at({ x: 60, y: 80 })).toEqual([]);

    add({ id: "late", type: "solid", shape: box(300, 300, 5, 5) });
    expect(index.inArea(here)).toEqual(["flag", "late"]);
    expect(index.nearest({ x: 300, y: 300 }, { type: "solid", maxDist: 20 })).toBe("late");

    index.removed("late");
    poses.remove("flag");
    expect(index.inArea(here)).toEqual([]);
    expect(index.at({ x: 60, y: 80 })).toEqual(["flag"]);
  });

  it("answers the same over a pose index that doesn't report its writes", () => {
    const registry = createRegistry();
    const inner = createPoseIndex(() => 0);
    const poses: PoseIndex = {
      get: (id) => inner.get(id),
      prev: (id) => inner.prev(id),
      set: (id, x, y, rot, opts) => inner.set(id, x, y, rot, opts),
      remove: (id) => inner.remove(id),
      has: (id) => inner.has(id),
      ids: () => inner.ids(),
      get size() {
        return inner.size;
      },
    };
    const index = createQueryIndex({ registry, poses } as unknown as EngineContext);
    index.added({ id: "crate", type: "solid", shape: box(0, 0, 5, 5) });
    poses.set("crate", 0, 0, 0, { snap: true });
    expect(index.at({ x: 100, y: 0 })).toEqual([]);
    poses.set("crate", 100, 0);
    expect(index.at({ x: 100, y: 0 })).toEqual(["crate"]);
    expect(index.at({ x: 0, y: 0 })).toEqual([]);
  });
});

describe("extents", () => {
  it("is a point at the pose without a shape, the shape at spawn while unmoved", () => {
    const { index, poses } = filled();
    expect(index.extent("start")).toEqual({ type: "circle", cx: -50, cy: 80, r: 0 });
    expect(index.extent("wall")).toEqual(box(150, 50, 10, 40));
    poses.set("start", 10, 20);
    expect(index.extent("start")).toEqual({ type: "circle", cx: 10, cy: 20, r: 0 });
    expect(index.extent("nobody")).toBeUndefined();
  });

  it("moves the shape by the pose's change, turning it about the spawn pose", () => {
    const { index, poses } = filled();
    poses.set("wall", 160, 70);
    expect(index.extent("wall")).toEqual(box(160, 70, 10, 40));
    expect(index.at({ x: 168, y: 35 })).toEqual(["wall"]);
    expect(index.at({ x: 145, y: 15 })).toEqual([]);
    poses.set("wall", 160, 70, Math.PI / 2);
    expect(index.extent("wall")).toEqual(box(160, 70, 10, 40, 90));
    expect(index.at({ x: 195, y: 70 })).toEqual(["wall"]);
    expect(index.at({ x: 168, y: 35 })).toEqual([]);
  });

  it("puts a path rider's local shape where it rides", () => {
    const { index, poses, add } = bareIndex();
    add({
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
      },
    });
    expect(index.extent("lift")).toEqual(box(1700, 900, 60, 8));
    poses.set("lift", 1700, 650);
    expect(index.extent("lift")).toEqual(box(1700, 650, 60, 8));
    expect(index.at({ x: 1750, y: 655 })).toEqual(["lift"]);
  });
});

// ─── In a runtime ────────────────────────────────────────

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const watcher = defineGame({
  id: "watcher",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

/** The engine yard without its props, so it runs on either backend. */
function yard(physics: "rapier" | "none"): ExpandedScene {
  const scene = engineYard();
  scene.settings.physics = physics;
  scene.entities = scene.entities.filter((e) => e.type !== "prop");
  return scene;
}

function battery(q: EngineContext["query"]) {
  return {
    all: q.select(),
    solids: q.byType("solid"),
    goal: q.byTag("goal"),
    liftColumn: q.inArea({ minX: 16, minY: 5.5, maxX: 18, maxY: 9.5 }),
    upper: q.inArea({ minX: 15, minY: 5.5, maxX: 19, maxY: 7.5 }),
    lower: q.inArea({ type: "circle", cx: 17, cy: 8.5, r: 0.6 }),
    floor: q.at({ x: 10, y: 9.9 }),
    nearSky: q.nearest({ x: 17, y: 1 }),
    nearLedge: q.nearest({ x: 14, y: 7.6 }, { maxDist: 1 }),
    extent: q.extent("lift"),
  };
}

describe("queries in a runtime", () => {
  it("gives the same answers without physics as its Rapier twin while the lift moves", () => {
    const run = (physics: "rapier" | "none") => {
      const rt = createSceneRuntime({ rapier, view: null, game: watcher });
      const report = rt.load(yard(physics));
      if (!report.ok) throw new Error(report.error);
      const out: ReturnType<typeof battery>[] = [];
      for (let i = 0; i <= 480; i++) {
        if (i % 60 === 0) out.push(battery(rt.ctx.query));
        rt.step(DT, []);
      }
      rt.destroy();
      return out;
    };
    const none = run("none");
    const onRapier = run("rapier");
    const answers = (list: typeof none) => list.map(({ extent: _e, ...rest }) => rest);
    expect(answers(none)).toEqual(answers(onRapier));
    for (const [i, a] of none.entries()) {
      const b = onRapier[i]!.extent as Extract<ShapeObj, { type: "box" }>;
      const e = a.extent as Extract<ShapeObj, { type: "box" }>;
      expect(e.cx).toBeCloseTo(b.cx, 3);
      expect(e.cy).toBeCloseTo(b.cy, 3);
    }
    expect(none[0]!.upper).not.toContain("lift");
    expect(none.some((s) => s.upper.includes("lift"))).toBe(true);
    expect(none[0]!.all).toEqual([
      "~solid:0",
      "~solid:1",
      "~solid:2",
      "ledge",
      "zone",
      "start",
      "lift",
    ]);
  });

  it("follows a falling, turning body through its pose", () => {
    const scene = engineYard();
    scene.entities = scene.entities.map((e) =>
      e.id === "crate" ? { ...e, shape: box(11, 3, 0.2, 0.1, 30) } : e,
    );
    const rt = createSceneRuntime({ rapier, view: null, game: watcher });
    const report = rt.load(scene);
    if (!report.ok) throw new Error(report.error);
    const q = rt.ctx.query;
    expect(q.at({ x: 11, y: 3 })).toEqual(["crate"]);
    for (let i = 0; i < 120; i++) rt.step(DT, []);
    const pose = rt.ctx.poses.get("crate")!;
    expect(pose.y).toBeGreaterThan(9);
    const ext = q.extent("crate") as Extract<ShapeObj, { type: "box" }>;
    expect(ext.cx).toBe(pose.x);
    expect(ext.cy).toBe(pose.y);
    expect(ext.rotDeg).toBeCloseTo(((((pose.rot * 180) / Math.PI) % 360) + 360) % 360, 6);
    expect(q.at({ x: 11, y: 3 })).toEqual([]);
    expect(q.at({ x: pose.x, y: pose.y }, { type: "prop" })).toEqual(["crate"]);
    const around = {
      minX: pose.x - 0.01,
      minY: pose.y - 0.01,
      maxX: pose.x + 0.01,
      maxY: pose.y + 0.01,
    };
    expect(q.inArea(around, { type: "prop" })).toEqual(["crate"]);
    expect(q.nearest({ x: pose.x, y: pose.y - 2 }, { type: "prop" })).toBe("crate");
    rt.ctx.setEnabled("crate", false);
    expect(q.byType("prop")).toEqual(["avatar"]);
    expect(q.select({ type: "prop", enabled: false })).toEqual(["avatar", "crate"]);
    rt.destroy();
  });
});

// ─── Against a brute-force scan ──────────────────────────

describe("random maps", () => {
  it("answers 1,000 random queries as a scan of every extent does", { timeout: 30_000 }, () => {
    const rng = Rng.from("query-index");
    const f = (lo: number, hi: number) => rng.range(lo * 8, hi * 8) / 8 + 0.0137;
    const { index, poses, add } = bareIndex();
    const ids: string[] = [];
    const records = new Map<string, RuntimeEntity>();
    const TAGS = ["a", "b", "c"];
    for (let i = 0; i < 400; i++) {
      const id = `e${i}`;
      const tags = TAGS.filter(() => rng.below(3) === 0);
      const cx = f(0, 2000);
      const cy = f(0, 2000);
      const kind = rng.below(6);
      const e: RuntimeEntity =
        kind === 0
          ? { id, type: "marker", at: [cx, cy], tags }
          : kind === 1
            ? { id, type: "sensor", shape: { type: "circle", cx, cy, r: f(1, 60) }, tags }
            : kind === 2
              ? {
                  id,
                  type: "solid",
                  shape: {
                    type: "capsule",
                    cx,
                    cy,
                    halfLen: f(1, 40),
                    r: f(1, 20),
                    rotDeg: f(0, 360),
                  },
                }
              : kind === 3
                ? {
                    id,
                    type: "nav",
                    shape: {
                      type: "poly",
                      pts: [
                        [cx, cy],
                        [cx + 80, cy],
                        [cx + 80, cy + 80],
                        [cx + 40, cy + 20],
                        [cx, cy + 80],
                      ],
                    },
                    tags,
                  }
                : { id, type: "sensor", shape: box(cx, cy, f(1, 60), f(1, 60), f(0, 360)), tags };
      add(e);
      ids.push(id);
      records.set(id, e);
    }
    const enabled = new Set(ids);

    const scan = (sel: EntitySelector | undefined, hit: (s: ShapeObj) => boolean) =>
      ids.filter((id) => {
        if ((sel?.enabled ?? true) && !enabled.has(id)) return false;
        const e = records.get(id)!;
        const type = sel?.type;
        if (typeof type === "string" && e.type !== type) return false;
        if (Array.isArray(type) && !type.includes(e.type)) return false;
        if (sel?.tag !== undefined && !((e.tags as string[] | undefined) ?? []).includes(sel.tag))
          return false;
        return hit(index.extent(id)!);
      });

    const randomSel = (): EntitySelector | undefined => {
      switch (rng.below(4)) {
        case 0:
          return undefined;
        case 1:
          return { type: (["sensor", "marker", "nav", "solid"] as const)[rng.below(4)]! };
        case 2:
          return { tag: TAGS[rng.below(3)]! };
        default:
          return { type: ["sensor", "nav"], enabled: false };
      }
    };

    let nonEmpty = 0;
    for (let i = 0; i < 1000; i++) {
      if (i % 50 === 0) {
        for (let k = 0; k < 40; k++) {
          const id = ids[rng.below(ids.length)]!;
          const at = poses.get(id)!;
          poses.set(id, at.x + f(-100, 100), at.y + f(-100, 100), rng.below(2) ? at.rot : f(0, 6));
          if (rng.below(4) === 0) {
            const on = !enabled.has(id);
            if (on) enabled.add(id);
            else enabled.delete(id);
            index.enabledChanged(id, on);
          }
        }
      }
      const sel = randomSel();
      const p = { x: f(0, 2000), y: f(0, 2000) };
      let got: readonly string[] | string | undefined;
      let want: readonly string[] | string | undefined;
      switch (i % 3) {
        case 0: {
          const r: Aabb = { minX: p.x, minY: p.y, maxX: p.x + f(0, 300), maxY: p.y + f(0, 300) };
          got = index.inArea(r, sel);
          want = scan(sel, (s) =>
            s.type === "poly" && !isConvex(s.pts)
              ? intersectsRect({ type: "chain", pts: [...s.pts, s.pts[0]!] }, r) ||
                containsPoint(s, [r.minX, r.minY])
              : intersectsRect(s, r),
          );
          break;
        }
        case 1:
          got = index.at(p, sel);
          want = scan(sel, (s) => containsPoint(s, [p.x, p.y]));
          break;
        default: {
          const maxDist = rng.below(2) ? f(0, 200) : undefined;
          got = index.nearest(p, { ...sel, ...(maxDist === undefined ? {} : { maxDist }) });
          let best: string | undefined;
          let bestD = Infinity;
          for (const id of scan(sel, () => true)) {
            const d = distanceToShape(index.extent(id)!, [p.x, p.y]);
            if (d <= (maxDist ?? Infinity) && d < bestD) {
              best = id;
              bestD = d;
            }
          }
          want = best;
        }
      }
      expect(got, `query ${i}`).toEqual(want);
      if (Array.isArray(got) ? got.length > 0 : got !== undefined) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThan(300);
  });
});
