// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { composePose, createPoseIndex } from "../runtime/poses";
import { createSceneRuntime } from "../runtime/runtime";
import { spawnPose } from "../runtime/spawn-pose";
import type { ExpandedScene, PathDef, RuntimeEntity, ShapeObj } from "../scene/types";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;
const registry = createRegistry();

const box = (cx: number, cy: number, hw: number, hh: number, rotDeg = 0): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg,
});
const circle = (cx: number, cy: number, r: number): ShapeObj => ({ type: "circle", cx, cy, r });
const path = (...pts: [number, number][]): PathDef => ({ pts, mode: "loop", speed: 120 });

function scene(entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "poses",
    bounds: [-1000, -1000, 2000, 2000],
    settings: {
      gravity: [0, 1200],
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
  };
}

function loaded(entities: RuntimeEntity[]) {
  const rt = createSceneRuntime({ rapier, view: null, registry });
  expect(rt.load(scene(entities)).ok).toBe(true);
  return rt;
}

describe("createPoseIndex", () => {
  it("keeps prev lazily: the first write in a tick moves the current pose to prev", () => {
    let tick = 0;
    const poses = createPoseIndex(() => tick);
    poses.set("a", 1, 2, 0.5, { snap: true });
    expect(poses.get("a")).toEqual({ x: 1, y: 2, rot: 0.5 });
    expect(poses.prev("a")).toEqual({ x: 1, y: 2, rot: 0.5 });

    poses.set("a", 3, 4, 0.5);
    poses.set("a", 5, 6, 0.5);
    expect(poses.get("a")).toEqual({ x: 5, y: 6, rot: 0.5 });
    expect(poses.prev("a")).toEqual({ x: 1, y: 2, rot: 0.5 });

    tick = 1;
    expect(poses.prev("a")).toEqual({ x: 1, y: 2, rot: 0.5 });
    poses.set("a", 7, 8, 0.5);
    expect(poses.prev("a")).toEqual({ x: 5, y: 6, rot: 0.5 });

    tick = 3;
    expect(poses.prev("a")).toEqual(poses.get("a"));
    poses.set("a", 9, 9, 0.5);
    expect(poses.prev("a")).toEqual({ x: 7, y: 8, rot: 0.5 });
  });

  it("snap makes prev the new pose, and a write without rot keeps the angle", () => {
    let tick = 0;
    const poses = createPoseIndex(() => tick);
    poses.set("a", 0, 0, 1);
    tick = 1;
    poses.set("a", 10, 0);
    expect(poses.get("a")).toEqual({ x: 10, y: 0, rot: 1 });
    expect(poses.prev("a")).toEqual({ x: 0, y: 0, rot: 1 });
    poses.set("a", 50, 50, 2, { snap: true });
    expect(poses.prev("a")).toEqual({ x: 50, y: 50, rot: 2 });
    poses.set("b", 1, 1);
    expect(poses.get("b")).toEqual({ x: 1, y: 1, rot: 0 });
  });

  it("removes, lists and counts entries, and hands out frozen poses", () => {
    const poses = createPoseIndex(() => 0);
    poses.set("a", 0, 0);
    poses.set("b", 1, 1);
    expect(poses.size).toBe(2);
    expect([...poses.ids()]).toEqual(["a", "b"]);
    expect(Object.isFrozen(poses.get("a"))).toBe(true);
    poses.remove("a");
    expect(poses.has("a")).toBe(false);
    expect(poses.get("a")).toBeUndefined();
    expect(poses.prev("a")).toBeUndefined();
    expect(poses.size).toBe(1);
  });

  it("composes a body-local offset onto a turned body", () => {
    const p = composePose(10, 20, Math.PI / 2, { x: 5, y: 0, rot: 0.25 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(25);
    expect(p.rot).toBeCloseTo(Math.PI / 2 + 0.25);
  });
});

describe("spawnPose", () => {
  const pose = (e: Omit<RuntimeEntity, "id">) =>
    spawnPose({ id: "e", ...e } as RuntimeEntity, registry);

  it("puts a shape at its centre, angled by rotDeg", () => {
    expect(pose({ type: "solid", shape: box(100, 50, 10, 5) })).toEqual({ x: 100, y: 50, rot: 0 });
    const turned = pose({ type: "sensor", shape: box(0, 0, 10, 5, 90), tags: [] });
    expect(turned).toEqual({ x: 0, y: 0, rot: Math.PI / 2 });
    expect(
      pose({
        type: "solid",
        shape: { type: "capsule", cx: 3, cy: 4, halfLen: 10, r: 2, rotDeg: 180 },
      }),
    ).toEqual({ x: 3, y: 4, rot: Math.PI });
  });

  it("angles a shape without rotDeg by its quarter turns", () => {
    expect(
      pose({
        type: "prop",
        shape: circle(40, 60, 8),
        density: 1,
        restitution: 0,
        transform: { turn: 1, flip: false },
      }),
    ).toEqual({ x: 40, y: 60, rot: Math.PI / 2 });
    const poly = pose({
      type: "solid",
      shape: {
        type: "poly",
        pts: [
          [0, 0],
          [20, 0],
          [20, 10],
          [0, 10],
        ],
      },
      transform: { turn: 2, flip: true },
    });
    expect(poly).toEqual({ x: 10, y: 5, rot: Math.PI });
    const chain = pose({
      type: "solid",
      shape: {
        type: "chain",
        pts: [
          [0, 0],
          [40, 20],
          [80, 0],
        ],
      },
    });
    expect(chain).toEqual({ x: 40, y: 10, rot: 0 });
  });

  it("puts a marker at its point, turned by its transform", () => {
    expect(pose({ type: "marker", at: [12, 34] })).toEqual({ x: 12, y: 34, rot: 0 });
    expect(pose({ type: "marker", at: [1, 2], transform: { turn: 3, flip: false } })).toEqual({
      x: 1,
      y: 2,
      rot: (3 * Math.PI) / 2,
    });
  });

  it("puts a follower at its first path point plus its shape's offset", () => {
    expect(
      pose({ type: "follower", shape: box(10, -4, 30, 8, 30), path: path([400, 600], [800, 600]) }),
    ).toEqual({ x: 410, y: 596, rot: Math.PI / 6 });
  });

  it("reads geometry from the type's fields, so a game type on a primitive needs nothing new", () => {
    const game = createRegistry(testGame);
    const marker = [...game.types.values()].find((t) => t.base === "marker")!;
    expect(spawnPose({ id: "m", type: marker.type, at: [5, 6] }, game)).toEqual({
      x: 5,
      y: 6,
      rot: 0,
    });
  });
});

describe("the runtime's pose index", () => {
  it("poses every loaded entity headless at its spawn pose", () => {
    const rt = createSceneRuntime({ rapier, view: null, registry });
    const yard = engineYard();
    expect(rt.load(yard).ok).toBe(true);
    expect(rt.ctx.poses.size).toBe(yard.entities.length);
    for (const e of yard.entities) {
      expect(rt.ctx.poses.get(e.id), e.id).toEqual(spawnPose(e, registry));
      expect(rt.ctx.poses.prev(e.id), e.id).toEqual(rt.ctx.poses.get(e.id));
    }
    rt.destroy();
  });

  it("a prop's pose follows its body each tick", () => {
    const rt = loaded([
      { id: "floor", type: "solid", shape: box(0, 200, 500, 20) },
      { id: "crate", type: "prop", shape: box(0, 0, 10, 10), density: 1, restitution: 0 },
    ]);
    const body = rt.ctx.physics.world.getCollider(rt.ctx.tags.handlesOf("crate")[0]!)!.parent()!;
    let before = rt.ctx.poses.get("crate")!;
    for (let i = 0; i < 30; i++) {
      rt.step(DT, []);
      const t = body.translation();
      const now = rt.ctx.poses.get("crate")!;
      expect(now).toEqual({ x: t.x, y: t.y, rot: body.rotation() });
      expect(rt.ctx.poses.prev("crate")).toEqual(before);
      before = now;
    }
    expect(before.y).toBeGreaterThan(0);
    rt.destroy();
  });

  it("a static solid's and a sensor's poses never change", () => {
    const rt = loaded([
      { id: "floor", type: "solid", shape: box(0, 200, 500, 20, 10) },
      { id: "zone", type: "sensor", shape: box(0, 100, 40, 40) },
      { id: "ball", type: "prop", shape: circle(0, 0, 10), density: 1, restitution: 0.5 },
    ]);
    const floor = rt.ctx.poses.get("floor");
    const zone = rt.ctx.poses.get("zone");
    for (let i = 0; i < 60; i++) rt.step(DT, []);
    expect(rt.ctx.poses.get("floor")).toBe(floor);
    expect(rt.ctx.poses.get("zone")).toBe(zone);
    expect(floor).toEqual({ x: 0, y: 200, rot: (10 * Math.PI) / 180 });
    rt.destroy();
  });

  it("a turned circle starts at its turn and keeps it on top of its body's rotation", () => {
    const rt = loaded([
      {
        id: "wheel",
        type: "prop",
        shape: circle(100, 0, 10),
        density: 1,
        restitution: 0,
        transform: { turn: 1, flip: false },
      },
    ]);
    expect(rt.ctx.poses.get("wheel")).toEqual({ x: 100, y: 0, rot: Math.PI / 2 });
    rt.step(DT, []);
    const body = rt.ctx.physics.world.getCollider(rt.ctx.tags.handlesOf("wheel")[0]!)!.parent()!;
    expect(rt.ctx.poses.get("wheel")!.rot).toBe(body.rotation() + Math.PI / 2);
    rt.destroy();
  });

  it("a polygon prop's pose is its centroid carried by its body", () => {
    const rt = loaded([
      {
        id: "slab",
        type: "prop",
        shape: {
          type: "poly",
          pts: [
            [0, 0],
            [40, 0],
            [40, 20],
            [0, 20],
          ],
        },
        density: 1,
        restitution: 0,
      },
    ]);
    expect(rt.ctx.poses.get("slab")).toEqual({ x: 20, y: 10, rot: 0 });
    rt.step(DT, []);
    const body = rt.ctx.physics.world.getCollider(rt.ctx.tags.handlesOf("slab")[0]!)!.parent()!;
    const t = body.translation();
    expect(rt.ctx.poses.get("slab")).toEqual(
      composePose(t.x, t.y, body.rotation(), { x: 20, y: 10, rot: 0 }),
    );
    rt.destroy();
  });

  it("a follower and what rides it move together each tick; seek snaps them", () => {
    const entities: RuntimeEntity[] = [
      { id: "lift", type: "follower", shape: box(5, 0, 40, 8), path: path([400, 600], [800, 600]) },
      { id: "plank", type: "solid", attach: "lift", shape: box(500, 590, 60, 4) },
      { id: "gate", type: "sensor", attach: "lift", shape: box(330, 560, 10, 30) },
    ];
    const rt = loaded(entities);
    expect(rt.ctx.poses.get("lift")).toEqual({ x: 405, y: 600, rot: 0 });
    expect(rt.ctx.poses.get("plank")).toEqual({ x: 500, y: 590, rot: 0 });
    const body = rt.ctx.physics.world.getCollider(rt.ctx.tags.handlesOf("lift")[0]!)!.parent()!;
    for (let i = 0; i < 20; i++) {
      const before = rt.ctx.poses.get("plank");
      rt.step(DT, []);
      const t = body.translation();
      expect(rt.ctx.poses.get("lift")).toEqual({ x: t.x + 5, y: t.y, rot: 0 });
      expect(rt.ctx.poses.get("plank")).toEqual({ x: t.x + 100, y: t.y - 10, rot: 0 });
      expect(rt.ctx.poses.get("gate")).toEqual({ x: t.x - 70, y: t.y - 40, rot: 0 });
      expect(rt.ctx.poses.prev("plank")).toEqual(before);
    }
    expect(rt.ctx.poses.get("lift")!.x).toBeGreaterThan(405);

    const seeked = createSceneRuntime({ rapier, view: null, registry });
    expect(seeked.load(scene(entities), { timeOffsetMs: 1000 }).ok).toBe(true);
    const lift = seeked.ctx.poses.get("lift")!;
    expect(lift.x).toBeCloseTo(525, 3);
    expect(seeked.ctx.poses.prev("lift")).toEqual(lift);
    expect(seeked.ctx.poses.get("plank")!.x).toBeCloseTo(620, 3);
    seeked.destroy();
    rt.destroy();
  });

  it("an attached entity added mid-run starts where its host has carried it", () => {
    const rt = loaded([
      { id: "lift", type: "follower", shape: box(0, 0, 40, 8), path: path([400, 600], [800, 600]) },
    ]);
    for (let i = 0; i < 30; i++) rt.step(DT, []);
    const host = rt.ctx.poses.get("lift")!;
    expect(
      rt.add([{ id: "plank", type: "solid", attach: "lift", shape: box(500, 590, 60, 4) }]).ok,
    ).toBe(true);
    const plank = rt.ctx.poses.get("plank")!;
    expect(plank.x).toBeCloseTo(host.x + 100, 3);
    expect(plank.y).toBeCloseTo(host.y - 10, 3);
    expect(rt.ctx.poses.prev("plank")).toEqual(plank);
    rt.destroy();
  });

  it("enters no digest: the game snapshot and stats don't change with poses", () => {
    const rt = createSceneRuntime({ rapier, view: null, game: testGame });
    expect(rt.load(scene([{ id: "floor", type: "solid", shape: box(0, 200, 500, 20) }])).ok).toBe(
      true,
    );
    const before = JSON.stringify([rt.snapshot(), rt.stats()]);
    rt.ctx.poses.set("floor", 999, 999, 1);
    expect(JSON.stringify([rt.snapshot(), rt.stats()])).toBe(before);
    rt.destroy();
  });
});
