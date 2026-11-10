import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { createSceneRuntime } from "../../runtime/runtime";
import { expandScene } from "../../scene/expand";
import type { EntityDef, SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import { createMotionBody, type MotionBody } from "../body";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;
const BACKENDS = ["rapier", "none"] as const;
type Backend = (typeof BACKENDS)[number];

const game: GameDefinition = defineGame({
  id: "motion",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);

/** A wall whose left face is at x = 100, from y = 0 to 200. */
const WALL = { id: "wall", type: "solid", shape: ["box", 105, 100, 5, 100] } as EntityDef;
const BOX = { type: "box", cx: 0, cy: 0, hw: 5, hh: 5, rotDeg: 0 } as const;

function loaded(physics: Backend, entities: EntityDef[] = [WALL]) {
  const def: SceneDefinition = {
    v: 3,
    game: "motion",
    name: "motion",
    bounds: [0, 0, 400, 200],
    settings: { gravity: [0, 0], physics },
    entities,
  };
  const rt = createSceneRuntime({ rapier, view: null, game });
  expect(rt.load(expandScene(def, registry))).toMatchObject({ ok: true });
  return rt;
}

function hero(rt: ReturnType<typeof loaded>, x: number, y: number, id = "hero"): MotionBody {
  return createMotionBody(rt.ctx, { id, type: "hero" }, { x, y }, { shape: BOX });
}

describe.each(BACKENDS)("a motion body (physics %s)", (physics) => {
  it("stops at a wall and slides along it, writing its pose", () => {
    const rt = loaded(physics);
    const body = hero(rt, 80, 50);
    expect(rt.ctx.poses.get("hero")).toMatchObject({ x: 80, y: 50 });
    const r = body.move({ x: 30, y: 10 });
    expect(r.blocked).toBe(true);
    expect(r.hits[0]).toMatchObject({
      handle: rt.ctx.tags.handlesOf("wall")[0],
      tag: { entityId: "wall" },
    });
    expect(r.hits[0]!.normal.x).toBeCloseTo(-1, 3);
    expect(r.hits[0]!.normal.y).toBeCloseTo(0, 3);
    const p = body.position();
    expect(p.x).toBeGreaterThan(94.9);
    expect(p.x).toBeLessThanOrEqual(95);
    expect(p.y).toBeCloseTo(60, 2);
    expect(r.moved.x).toBeCloseTo(p.x - 80, 9);
    expect(rt.ctx.poses.get("hero")).toMatchObject(p);
    rt.step(DT, []);
    expect(rt.ctx.space.overlaps({ ...BOX, cx: p.x, cy: p.y }).map((h) => h.tag.entityId)).toEqual([
      "hero",
    ]);
    rt.destroy();
  });

  it("keeps sliding over ticks, and stops dead without slide", () => {
    const rt = loaded(physics);
    const body = hero(rt, 80, 50);
    for (let i = 0; i < 10; i++) {
      body.move({ x: 5, y: 3 });
      rt.step(DT, []);
    }
    expect(body.position().x).toBeGreaterThan(94.9);
    expect(body.position().y).toBeCloseTo(80, 2);

    const stiff = hero(rt, 80, 150, "stiff");
    const r = stiff.move({ x: 30, y: 10 }, { slide: false });
    expect(r.blocked).toBe(true);
    expect(stiff.position().x).toBeGreaterThan(94.9);
    expect(stiff.position().y).toBeCloseTo(155, 1);
    rt.destroy();
  });

  it("is blocked only when some of the delta is lost", () => {
    const rt = loaded(physics);
    const body = hero(rt, 80, 50);
    expect(body.move({ x: -10, y: 4 })).toEqual({
      moved: { x: -10, y: 4 },
      hits: [],
      blocked: false,
    });
    body.move({ x: 40, y: 0 });
    rt.step(DT, []);
    const along = body.move({ x: 0, y: 20 });
    expect(along.blocked).toBe(false);
    expect(along.moved.y).toBeCloseTo(20, 6);
    const into = body.move({ x: 1, y: 0 });
    expect(into.blocked).toBe(true);
    expect(into.moved.x).toBeLessThan(0.05);
    expect(body.move({ x: 0, y: 0 })).toEqual({ moved: { x: 0, y: 0 }, hits: [], blocked: false });
    rt.destroy();
  });

  it("teleports through a wall with no sweep, and the pose snaps", () => {
    const rt = loaded(physics);
    const body = hero(rt, 80, 50);
    rt.step(DT, []);
    body.move({ x: 5, y: 0 });
    expect(rt.ctx.poses.prev("hero")).toMatchObject({ x: 80, y: 50 });
    expect(rt.ctx.poses.get("hero")).toMatchObject({ x: 85, y: 50 });
    body.teleport(150, 70);
    expect(body.position()).toEqual({ x: 150, y: 70 });
    expect(rt.ctx.poses.get("hero")).toMatchObject({ x: 150, y: 70 });
    expect(rt.ctx.poses.prev("hero")).toMatchObject({ x: 150, y: 70 });
    expect(rt.ctx.space.pointAt({ x: 150, y: 70 }).map((h) => h.tag.entityId)).toEqual(["hero"]);
    rt.step(DT, []);
    expect(body.move({ x: -40, y: 0 }).blocked).toBe(true);
    expect(body.position().x).toBeGreaterThanOrEqual(115);
    expect(body.position().x).toBeLessThan(115.1);
    rt.destroy();
  });

  it("blocks another motion body until disabled, and leaves the world when destroyed", () => {
    const rt = loaded(physics, []);
    const a = hero(rt, 50, 50, "a");
    const b = hero(rt, 80, 50, "b");
    rt.step(DT, []);
    expect(b.move({ x: -40, y: 0 }).hits.map((h) => h.tag.entityId)).toEqual(["a"]);
    expect(b.position().x).toBeGreaterThan(59.9);
    a.setEnabled(false);
    rt.step(DT, []);
    expect(b.move({ x: -20, y: 0 })).toMatchObject({ blocked: false, hits: [] });
    a.setEnabled(true);
    a.destroy();
    expect(rt.ctx.tags.handlesOf("a")).toEqual([]);
    expect(() => a.move({ x: 1, y: 0 })).toThrow(/destroyed/);
    rt.destroy();
  });
});

describe("a motion body on Rapier", () => {
  it("is a kinematic body that doesn't push props", () => {
    const prop = {
      id: "crate",
      type: "prop",
      shape: ["box", 60, 50, 5, 5],
      density: 0.001,
      restitution: 0,
    } as EntityDef;
    const rt = loaded("rapier", [prop]);
    const body = hero(rt, 30, 50);
    const rb = rt.ctx.physics!.world.getCollider(body.handle).parent()!;
    expect(rb.isKinematic()).toBe(true);
    const start = { ...rt.ctx.poses.get("crate")! };
    let blocked = 0;
    for (let i = 0; i < 30; i++) {
      if (body.move({ x: 3, y: 0 }).blocked) blocked++;
      rt.step(DT, []);
    }
    expect(blocked).toBeGreaterThan(0);
    expect(body.position().x).toBeLessThan(50.1);
    const end = rt.ctx.poses.get("crate")!;
    expect(end.x).toBeCloseTo(start.x, 2);
    expect(end.y).toBeCloseTo(start.y, 2);
    rt.destroy();
  });

  it("refuses a chain shape", () => {
    const rt = loaded("rapier");
    expect(() =>
      createMotionBody(
        rt.ctx,
        { id: "c", type: "hero" },
        { x: 0, y: 0 },
        {
          shape: {
            type: "chain",
            pts: [
              [0, 0],
              [1, 1],
            ],
          } as never,
        },
      ),
    ).toThrow(/chain/);
    rt.destroy();
  });
});
