import type { Collider } from "@dimforge/rapier2d";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import { createSceneRuntime } from "../runtime/runtime";
import { SENSOR_ENTER, SENSOR_EXIT } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import { Rng } from "../sim-kit/rng";
import { colliderCandidates, createCircleGrid } from "../systems/sensor-candidates";
import type { RapierModule } from "../types";

const DT = 1000 / 60;

type Circle = { x: number; y: number; r: number };

const touching = (a: Circle, b: Circle) =>
  a.r + b.r === Infinity || Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r;

function gridOf(circles: readonly Circle[]) {
  return createCircleGrid(
    circles.map((c) => c.x),
    circles.map((c) => c.y),
    circles.map((c) => c.r),
    circles.length,
  );
}

describe("createCircleGrid", () => {
  it("names every circle a query touches, ascending, over random circles of mixed sizes", () => {
    const rng = Rng.from("circle-grid");
    const span = (lo: number, hi: number) => lo + (rng.below(10_001) / 10_000) * (hi - lo);
    const circles: Circle[] = [];
    for (let i = 0; i < 600; i++) {
      const kind = i % 40;
      circles.push({
        x: span(-60, 60),
        y: span(-30, 30),
        r: kind === 0 ? Infinity : kind === 1 ? span(20, 50) : kind === 2 ? 0 : span(0.05, 0.6),
      });
    }
    const grid = gridOf(circles);
    for (let q = 0; q < 300; q++) {
      const query: Circle =
        q % 50 === 0
          ? { x: span(-60, 60), y: span(-30, 30), r: q === 0 ? Infinity : span(30, 80) }
          : { x: span(-70, 70), y: span(-40, 40), r: span(0, 1.5) };
      const near = grid.near(query.x, query.y, query.r);
      expect(near).toEqual([...near].sort((a, b) => a - b));
      expect(new Set(near).size).toBe(near.length);
      const found = new Set(near);
      for (let i = 0; i < circles.length; i++) {
        if (touching(circles[i]!, query))
          expect(found.has(i), `circle ${i}, query ${q}`).toBe(true);
      }
    }
  });

  it("leaves out what is far away", () => {
    const grid = gridOf([
      { x: 0, y: 0, r: 0.5 },
      { x: 10, y: 0, r: 0.5 },
      { x: 0.6, y: 0, r: 0.2 },
    ]);
    expect(grid.near(0, 0, 0.5)).toEqual([0, 2]);
    expect(grid.near(10, 0, 0.5)).toEqual([1]);
    expect(grid.near(5, 5, 0.1)).toEqual([]);
  });

  it("answers for no circles at all", () => {
    expect(gridOf([]).near(0, 0, 1)).toEqual([]);
  });
});

const groups = (memberships: number, filter: number) => ((memberships << 16) | filter) >>> 0;
const SENSOR = groups(0b100, 0b010);
const DYNAMIC = groups(0b010, 0b111);
const STATIC = groups(0b001, 0b010);

function fakeCollider(handle: number, g: number, x: number, y: number, r: number) {
  const reads = { n: 0 };
  const collider = {
    handle,
    collisionGroups: () => g,
    translation: () => {
      reads.n++;
      return { x, y };
    },
    shape: { radius: r },
  } as unknown as Collider;
  return { collider, reads };
}

describe("colliderCandidates", () => {
  it("reads only the queriers and what their groups can meet, and answers in collider order", () => {
    const sensor = fakeCollider(1, SENSOR, 0, 0, 1);
    const near = fakeCollider(2, DYNAMIC, 0.5, 0, 0.2);
    const wall = fakeCollider(3, STATIC, 0, 0, 5);
    const far = fakeCollider(4, DYNAMIC, 50, 0, 0.2);
    const other = fakeCollider(5, SENSOR, 0.2, 0, 1);
    const colliders = [near, sensor, wall, other, far].map((c) => c.collider);
    const candidates = colliderCandidates(colliders, [sensor.collider, other.collider]);
    expect(wall.reads.n).toBe(0);
    expect([sensor, near, far, other].map((c) => c.reads.n)).toEqual([1, 1, 1, 1]);
    expect(candidates(sensor.collider)).toEqual([0]);
    expect(candidates(other.collider)).toEqual([0]);
    expect(candidates(near.collider)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps a collider that only one direction of the groups lets meet", () => {
    const sensor = fakeCollider(1, SENSOR, 0, 0, 1);
    const listener = fakeCollider(2, groups(0b001, 0b100), 0, 0, 1);
    const member = fakeCollider(3, groups(0b010, 0), 0, 0, 1);
    const colliders = [sensor, listener, member].map((c) => c.collider);
    expect(colliderCandidates(colliders, [sensor.collider])(sensor.collider)).toEqual([1, 2]);
  });
});

describe("the sensor system's candidates", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });
  const sensing = createRegistry(
    defineGame({
      id: "sensing",
      types: [],
      actions: [],
      collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
    type: "box",
    cx,
    cy,
    hw,
    hh,
    rotDeg: 0,
  });
  const ball = (id: string, x: number, y: number): RuntimeEntity => ({
    id,
    type: "prop",
    shape: { type: "circle", cx: x, cy: y, r: 8 },
    density: 1,
    restitution: 0.2,
  });

  it("raise what a test of every collider would, through teleports, regrouping, adds, removes and reshapes", () => {
    const sensors: RuntimeEntity[] = [];
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 5; j++)
        sensors.push({
          id: `s${i}-${j}`,
          type: "sensor",
          shape: box(-350 + 100 * i, 60 * j, 30, 20),
        });
    const balls = Array.from({ length: 60 }, (_, k) =>
      ball(`b${k}`, -380 + 13 * k, -100 - 7 * (k % 9)),
    );
    const scene: ExpandedScene = {
      name: "candidates",
      bounds: [-1000, -1000, 2000, 2000],
      settings: {
        gravity: [0, 1200],
        physics: "rapier",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [
        { id: "floor", type: "solid", shape: box(0, 400, 2000, 20) },
        { id: "wall", type: "solid", shape: box(-350, 60, 30, 100) },
        {
          id: "lift",
          type: "follower",
          shape: box(0, 0, 40, 8),
          path: {
            pts: [
              [-400, 330],
              [400, 330],
            ],
            mode: "ping_pong",
            speed: 300,
          },
        },
        { id: "gate", type: "sensor", attach: "lift", shape: box(-400, 320, 30, 30) },
        ...sensors,
        ...balls,
      ],
    };
    const rt = createSceneRuntime({ rapier, view: null, registry: sensing });
    expect(rt.load(scene).ok).toBe(true);
    const world = rt.ctx.physics!.world;
    const colliderOf = (id: string) => world.getCollider(rt.ctx.tags.handlesOf(id)[0]!)!;
    const watched = [...sensors.map((s) => s.id), "gate"];
    const inside = new Map<string, number>();
    let enters = 0;

    const expected = () => {
      const now = new Map<string, number>();
      for (const id of watched) {
        const sensor = colliderOf(id);
        for (const other of world.colliders.getAll()) {
          if (other === sensor || !world.intersectionPair(sensor, other)) continue;
          const key = `${id}|${rt.ctx.tags.get(other.handle)?.entityId}`;
          now.set(key, (now.get(key) ?? 0) + 1);
        }
      }
      return now;
    };

    for (let tick = 0; tick < 150; tick++) {
      if (tick === 30) colliderOf("b3").parent()!.setTranslation({ x: 50, y: 120 }, true);
      if (tick === 40) colliderOf("b10").setCollisionGroups(sensing.collisionGroups("static"));
      if (tick === 50) {
        expect(rt.add([ball("late", 150, 60)]).ok).toBe(true);
        rt.remove(["b20"]);
      }
      if (tick === 60)
        expect(rt.update([{ ...sensors[7]!, shape: box(-250, 370, 60, 15) }]).ok).toBe(true);
      for (const e of rt.step(DT, []).events) {
        const key = `${e.entityId}|${e.other}`;
        if (e.type === SENSOR_ENTER) {
          enters++;
          inside.set(key, (inside.get(key) ?? 0) + 1);
        } else if (e.type === SENSOR_EXIT) {
          const n = (inside.get(key) ?? 0) - 1;
          if (n === 0) inside.delete(key);
          else inside.set(key, n);
        }
      }
      expect(inside, `tick ${tick}`).toEqual(expected());
    }
    expect(enters).toBeGreaterThan(60);
    rt.destroy();
  });
});
