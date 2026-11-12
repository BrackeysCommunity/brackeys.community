import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import type { EngineContext, GameDefinition, JsonValue } from "../../game/types";
import { createSceneRuntime } from "../../runtime/runtime";
import { expandScene } from "../../scene/expand";
import type { EntityDef, SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import {
  SAVE_REGISTRY,
  createMotionBody,
  saveRegistryOf,
  type MotionBody,
  type SaveEntry,
  type SaveRegistry,
} from "../body";
import { createTopDownController } from "../top-down";

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

/** A wall whose left face is at x = 1 m, from y = 0 to 2 m. */
const WALL = { id: "wall", type: "solid", shape: ["box", 1.05, 1, 0.05, 1] } as EntityDef;
const BOX = { type: "box", cx: 0, cy: 0, hw: 0.05, hh: 0.05, rotDeg: 0 } as const;

function loaded(physics: Backend, entities: EntityDef[] = [WALL]) {
  const def: SceneDefinition = {
    v: 3,
    game: "motion",
    name: "motion",
    bounds: [0, 0, 4, 2],
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
    const body = hero(rt, 0.8, 0.5);
    expect(rt.ctx.poses.get("hero")).toMatchObject({ x: 0.8, y: 0.5 });
    const r = body.move({ x: 0.3, y: 0.1 });
    expect(r.blocked).toBe(true);
    expect(r.hits[0]).toMatchObject({
      handle: rt.ctx.tags.handlesOf("wall")[0],
      tag: { entityId: "wall" },
    });
    expect(r.hits[0]!.normal.x).toBeCloseTo(-1, 3);
    expect(r.hits[0]!.normal.y).toBeCloseTo(0, 3);
    const p = body.position();
    expect(p.x).toBeGreaterThan(0.949);
    expect(p.x).toBeLessThanOrEqual(0.95);
    expect(p.y).toBeCloseTo(0.6, 4);
    expect(r.moved.x).toBeCloseTo(p.x - 0.8, 9);
    expect(rt.ctx.poses.get("hero")).toMatchObject(p);
    rt.step(DT, []);
    expect(rt.ctx.space.overlaps({ ...BOX, cx: p.x, cy: p.y }).map((h) => h.tag.entityId)).toEqual([
      "hero",
    ]);
    rt.destroy();
  });

  it("keeps sliding over ticks, and stops dead without slide", () => {
    const rt = loaded(physics);
    const body = hero(rt, 0.8, 0.5);
    for (let i = 0; i < 10; i++) {
      body.move({ x: 0.05, y: 0.03 });
      rt.step(DT, []);
    }
    expect(body.position().x).toBeGreaterThan(0.949);
    expect(body.position().y).toBeCloseTo(0.8, 4);

    const stiff = hero(rt, 0.8, 1.5, "stiff");
    const r = stiff.move({ x: 0.3, y: 0.1 }, { slide: false });
    expect(r.blocked).toBe(true);
    expect(stiff.position().x).toBeGreaterThan(0.949);
    expect(stiff.position().y).toBeCloseTo(1.55, 3);
    rt.destroy();
  });

  it("is blocked only when some of the delta is lost", () => {
    const rt = loaded(physics);
    const body = hero(rt, 0.8, 0.5);
    const free = body.move({ x: -0.1, y: 0.04 });
    // Decimal metres aren't exact in binary, and Rapier holds f32: a free move travels its delta to rounding.
    expect(free).toMatchObject({ hits: [], blocked: false });
    expect(free.moved.x).toBeCloseTo(-0.1, 7);
    expect(free.moved.y).toBeCloseTo(0.04, 7);
    body.move({ x: 0.4, y: 0 });
    rt.step(DT, []);
    const along = body.move({ x: 0, y: 0.2 });
    expect(along.blocked).toBe(false);
    expect(along.moved.y).toBeCloseTo(0.2, 6);
    const into = body.move({ x: 0.01, y: 0 });
    expect(into.blocked).toBe(true);
    expect(into.moved.x).toBeLessThan(0.0005);
    expect(body.move({ x: 0, y: 0 })).toEqual({ moved: { x: 0, y: 0 }, hits: [], blocked: false });
    rt.destroy();
  });

  it("teleports through a wall with no sweep, and the pose snaps", () => {
    const rt = loaded(physics);
    const body = hero(rt, 0.8, 0.5);
    rt.step(DT, []);
    body.move({ x: 0.05, y: 0 });
    expect(rt.ctx.poses.prev("hero")).toMatchObject({ x: 0.8, y: 0.5 });
    expect(rt.ctx.poses.get("hero")!.x).toBeCloseTo(0.85, 8);
    expect(rt.ctx.poses.get("hero")!.y).toBe(0.5);
    body.teleport(1.5, 0.7);
    expect(body.position()).toEqual({ x: 1.5, y: 0.7 });
    expect(rt.ctx.poses.get("hero")).toMatchObject({ x: 1.5, y: 0.7 });
    expect(rt.ctx.poses.prev("hero")).toMatchObject({ x: 1.5, y: 0.7 });
    expect(rt.ctx.space.pointAt({ x: 1.5, y: 0.7 }).map((h) => h.tag.entityId)).toEqual(["hero"]);
    rt.step(DT, []);
    expect(body.move({ x: -0.4, y: 0 }).blocked).toBe(true);
    expect(body.position().x).toBeGreaterThanOrEqual(1.15);
    expect(body.position().x).toBeLessThan(1.151);
    rt.destroy();
  });

  it("blocks another motion body until disabled, and leaves the world when destroyed", () => {
    const rt = loaded(physics, []);
    const a = hero(rt, 0.5, 0.5, "a");
    const b = hero(rt, 0.8, 0.5, "b");
    rt.step(DT, []);
    expect(b.move({ x: -0.4, y: 0 }).hits.map((h) => h.tag.entityId)).toEqual(["a"]);
    expect(b.position().x).toBeGreaterThan(0.599);
    a.setEnabled(false);
    rt.step(DT, []);
    expect(b.move({ x: -0.2, y: 0 })).toMatchObject({ blocked: false, hits: [] });
    a.setEnabled(true);
    a.destroy();
    expect(rt.ctx.tags.handlesOf("a")).toEqual([]);
    expect(() => a.move({ x: 0.01, y: 0 })).toThrow(/destroyed/);
    rt.destroy();
  });
});

describe("a motion body on Rapier", () => {
  it("is a kinematic body that doesn't push props", () => {
    const prop = {
      id: "crate",
      type: "prop",
      shape: ["box", 0.6, 0.5, 0.05, 0.05],
      density: 0.001,
      restitution: 0,
    } as EntityDef;
    const rt = loaded("rapier", [prop]);
    const body = hero(rt, 0.3, 0.5);
    const rb = rt.ctx.physics!.world.getCollider(body.handle).parent()!;
    expect(rb.isKinematic()).toBe(true);
    const start = { ...rt.ctx.poses.get("crate")! };
    let blocked = 0;
    for (let i = 0; i < 30; i++) {
      if (body.move({ x: 0.03, y: 0 }).blocked) blocked++;
      rt.step(DT, []);
    }
    expect(blocked).toBeGreaterThan(0);
    expect(body.position().x).toBeLessThan(0.501);
    const end = rt.ctx.poses.get("crate")!;
    expect(end.x).toBeCloseTo(start.x, 4);
    expect(end.y).toBeCloseTo(start.y, 4);
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

/** The entries registered with the runtime's save registry, by `<entity id> <owner>`, seen through its `register`. */
function withRegistry(ctx: EngineContext): Map<string, SaveEntry> {
  const entries = new Map<string, SaveEntry>();
  const own = saveRegistryOf(ctx);
  const inner = own ? own.register.bind(own) : null;
  const register: SaveRegistry["register"] = (entityId, owner, entry) => {
    const key = `${entityId} ${owner}`;
    entries.set(key, entry);
    const off = inner?.(entityId, owner, entry);
    return () => {
      off?.();
      if (entries.get(key) === entry) entries.delete(key);
    };
  };
  if (own) own.register = register;
  else (ctx as EngineContext & { [SAVE_REGISTRY]: SaveRegistry })[SAVE_REGISTRY] = { register };
  return entries;
}

describe.each(BACKENDS)("a motion body in a world save (physics %s)", (physics) => {
  it("registers under its entity id as `motion` and leaves when destroyed", () => {
    const rt = loaded(physics);
    const entries = withRegistry(rt.ctx);
    const body = hero(rt, 0.5, 0.5);
    expect([...entries.keys()]).toEqual(["hero motion"]);
    expect(entries.get("hero motion")!.save()).toEqual({ at: [0.5, 0.5] });
    body.setVelocity({ x: 1, y: -0.5 });
    body.setEnabled(false);
    expect(body.velocity()).toEqual({ x: 1, y: -0.5 });
    expect(entries.get("hero motion")!.save()).toEqual({ at: [0.5, 0.5], v: [1, -0.5], off: true });
    body.destroy();
    expect(entries.size).toBe(0);
    rt.destroy();
  });

  it("continues identically for 120 ticks after a restore mid-motion", () => {
    const intent = (n: number) =>
      n < 40 ? { x: 1, y: 0.4 } : n < 90 ? { x: -0.3, y: 1 } : { x: 0, y: -1 };
    const make = () => {
      const rt = loaded(physics);
      const entries = withRegistry(rt.ctx);
      const body = hero(rt, 0.3, 0.4);
      return {
        rt,
        entries,
        body,
        ctl: createTopDownController(body, { maxSpeed: 1.5, accel: 4, decel: 3 }),
      };
    };
    const run = (m: ReturnType<typeof make>, from: number, to: number) => {
      const out: [number, number, number, number][] = [];
      for (let n = from; n < to; n++) {
        m.ctl.step(DT, intent(n));
        m.rt.step(DT, []);
        const p = m.body.position();
        const v = m.body.velocity();
        out.push([p.x, p.y, v.x, v.y]);
      }
      return out;
    };
    const a = make();
    run(a, 0, 30);
    const saved = JSON.parse(JSON.stringify(a.entries.get("hero motion")!.save())) as JsonValue;
    const at = a.body.position();
    const expected = run(a, 30, 150);

    const b = make();
    b.entries.get("hero motion")!.restore(saved);
    expect(b.body.position()).toEqual(at);
    expect(b.rt.ctx.poses.get("hero")).toMatchObject(at);
    expect(run(b, 30, 150)).toEqual(expected);
    // The same restore without the velocity starts from rest and drifts.
    const c = make();
    const { v: _v, ...still } = saved as { v?: unknown };
    c.entries.get("hero motion")!.restore(still as JsonValue);
    expect(run(c, 30, 150)).not.toEqual(expected);
    a.rt.destroy();
    b.rt.destroy();
    c.rt.destroy();
  });

  it("needs no registry on a context without one", () => {
    const rt = loaded(physics, []);
    const ctx = { ...rt.ctx, [SAVE_REGISTRY]: undefined } as EngineContext;
    expect(saveRegistryOf(ctx)).toBeNull();
    const body = createMotionBody(
      ctx,
      { id: "bare", type: "hero" },
      { x: 0.5, y: 0.5 },
      { shape: BOX },
    );
    expect(body.move({ x: 0.1, y: 0 }).blocked).toBe(false);
    body.destroy();
    rt.destroy();
  });

  it("restores disabled, and ignores a state that isn't its own", () => {
    const rt = loaded(physics, []);
    const entries = withRegistry(rt.ctx);
    const body = hero(rt, 0.5, 0.5);
    entries.get("hero motion")!.restore({ at: [1.5, 0.7], off: true });
    expect(body.position()).toEqual({ x: 1.5, y: 0.7 });
    expect(rt.ctx.poses.prev("hero")).toMatchObject({ x: 1.5, y: 0.7 });
    expect(rt.ctx.space.pointAt({ x: 1.5, y: 0.7 })).toEqual([]);
    for (const bad of [null, [1, 2], { at: [1] }, { at: [0, 0], v: "fast" }] as JsonValue[]) {
      entries.get("hero motion")!.restore(bad);
      expect(body.position()).toEqual({ x: 1.5, y: 0.7 });
    }
    rt.destroy();
  });
});
