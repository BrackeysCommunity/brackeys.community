import type { Collider, RigidBody } from "@dimforge/rapier2d";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { colliderShape } from "../debug/physics-wireframes";
import { createRegistry, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import type { GameDefinition, Registry, SceneSystem } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import type { ExpandedScene, Pt, RuntimeEntity, ShapeObj } from "../scene/types";
import type { SolidSystem } from "../systems/bodies";
import type { MarkerSystem } from "../systems/marker";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";
import { generateScene } from "./fixtures/generate-scene";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

/** A game with a material and a type whose own system has no `update`, so edits respawn it. */
const yardGame = defineGame({
  id: "reconcile",
  types: [
    {
      type: "beacon",
      description: "A point with a small fixed ball.",
      fields: { at: pointField("Where.") },
      system: (ctx, type): SceneSystem<RuntimeEntity<{ at: Pt }>> => {
        const owned = new Map<string, { body: RigidBody; collider: Collider }>();
        const despawn = (id: string) => {
          const entry = owned.get(id);
          if (!entry) return;
          ctx.tags.delete(entry.collider.handle);
          ctx.physics!.removeRigidBody(entry.body);
          owned.delete(id);
        };
        return {
          spawn(e) {
            despawn(e.id);
            const body = ctx.physics!.addRigidBody(
              ctx.rapier!.RigidBodyDesc.fixed().setTranslation(e.at[0], e.at[1]),
            );
            const collider = ctx.physics!.addCollider(ctx.rapier!.ColliderDesc.ball(4), body);
            ctx.tags.set(collider.handle, { entityId: e.id, type: type.type });
            owned.set(e.id, { body, collider });
          },
          despawn,
          clear: () => [...owned.keys()].forEach(despawn),
          size: () => owned.size,
        };
      },
    },
  ],
  actions: [],
  materials: { ice: { friction: 0.02, restitution: 0.1, description: "" } },
  createRuntime: () => ({ snapshot: () => null }),
});

type Runtime = SceneRuntimeHandle;

function runtime(game: GameDefinition | null = yardGame, registry?: Registry): Runtime {
  return createSceneRuntime({ rapier, view: null, game, registry });
}

const box = (cx: number, cy: number, hw: number, hh: number, rotDeg = 0): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg,
});

const round = (v: unknown): unknown => {
  if (typeof v === "number") return Math.round(v * 1e5) / 1e5;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  }
  return v;
};

/** Everything a load fills, by entity id, so two runtimes compare whatever their handles. */
function tables(rt: Runtime) {
  const { tags, physics } = rt.ctx;
  const ids = rt.scene()!.entities.map((e) => e.id);
  const colliders = (id: string) =>
    tags
      .handlesOf(id)
      .map((h) => {
        const c = physics!.world.getCollider(h)!;
        const body = c.parent();
        return round({
          tag: tags.get(h),
          shape: colliderShape(c, rapier.ShapeType),
          sensor: c.isSensor(),
          friction: c.friction(),
          restitution: c.restitution(),
          density: c.density(),
          groups: c.collisionGroups(),
          body: body && {
            type: body.bodyType(),
            at: body.translation(),
            rot: body.rotation(),
            colliders: body.numColliders(),
          },
        });
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const hidden = (e: RuntimeEntity) =>
    rt.ctx.system<SolidSystem>(e.type)?.isHidden?.(e.id) ?? false;
  return {
    stats: rt.stats(),
    entities: Object.fromEntries(ids.map((id) => [id, rt.get(id)])),
    colliders: Object.fromEntries(ids.map((id) => [id, colliders(id)])),
    hidden: rt
      .scene()!
      .entities.filter(hidden)
      .map((e) => e.id),
    markers: rt.ctx
      .system<MarkerSystem>("marker")!
      .list()
      .map((m) => m.id)
      .sort(),
  };
}

/** What a fresh runtime holds after loading `scene`. */
function freshTables(scene: ExpandedScene, game: GameDefinition | null = yardGame) {
  const rt = runtime(game);
  expect(rt.load(structuredClone(scene)).ok).toBe(true);
  const t = tables(rt);
  rt.destroy();
  return t;
}

const loaded = (game: GameDefinition | null = yardGame) => {
  const rt = runtime(game);
  expect(rt.load(engineYard()).ok).toBe(true);
  return rt;
};

const yardWith = (entities: RuntimeEntity[]): ExpandedScene => ({ ...engineYard(), entities });

const NEW: RuntimeEntity[] = [
  { id: "shelf", type: "solid", shape: box(600, 700, 80, 10), material: "ice" },
  { id: "pad", type: "sensor", shape: { type: "circle", cx: 500, cy: 900, r: 30 }, tags: ["pad"] },
  { id: "flag", type: "marker", at: [1800, 960] },
  {
    id: "ball",
    type: "prop",
    shape: { type: "circle", cx: 700, cy: 600, r: 10 },
    density: 1,
    restitution: 0.5,
  },
  {
    id: "elevator",
    type: "follower",
    shape: box(0, 0, 30, 6),
    path: {
      pts: [
        [100, 500],
        [300, 500],
      ],
      mode: "loop",
      speed: 60,
    },
  },
  { id: "light", type: "beacon", at: [50, 50] },
];

describe("SceneRuntime add, update and remove", () => {
  it("add spawns into the loaded scene, appended, as a fresh load would", () => {
    const rt = loaded();
    expect(rt.add(structuredClone(NEW))).toEqual({ ok: true });
    const expected = yardWith([...engineYard().entities, ...NEW]);
    expect(rt.scene()!.entities).toEqual(expected.entities);
    expect(rt.get("light")).toEqual(NEW[5]);
    expect(tables(rt)).toEqual(freshTables(expected));
    rt.destroy();
  });

  it("update replaces entities in place, through fast paths and respawns alike", () => {
    const rt = loaded();
    const changed: RuntimeEntity[] = [
      { id: "ledge", type: "solid", shape: box(1300, 750, 90, 12, 10), material: "ice" },
      { id: "~solid:1", type: "solid", shape: box(20, 500, 20, 500), oneWay: true },
      { id: "zone", type: "sensor", shape: box(900, 930, 40, 30), tags: ["finish"] },
      { id: "start", type: "marker", at: [320, 960], tags: ["spawn", "first"] },
      { id: "crate", type: "prop", shape: box(1200, 940, 15, 15), density: 3, restitution: 0 },
      {
        id: "lift",
        type: "follower",
        shape: box(0, 0, 40, 8),
        path: {
          pts: [
            [1700, 900],
            [1700, 500],
          ],
          mode: "loop",
          speed: 120,
        },
      },
    ];
    expect(rt.update(structuredClone(changed))).toEqual({ ok: true });
    const byId = new Map(changed.map((e) => [e.id, e]));
    const expected = yardWith(engineYard().entities.map((e) => byId.get(e.id) ?? e));
    expect(rt.scene()!.entities).toEqual(expected.entities);
    expect(tables(rt)).toEqual(freshTables(expected));
    rt.destroy();
  });

  it("a sensor's shape change and a solid's shape change keep their bodies", () => {
    const rt = loaded();
    const bodyOf = (id: string) =>
      rt.ctx.physics!.world.getCollider(rt.ctx.tags.handlesOf(id)[0]!)!.parent()!.handle;
    const before = { ledge: bodyOf("ledge"), zone: bodyOf("zone") };
    rt.update([
      { id: "ledge", type: "solid", shape: { type: "circle", cx: 1400, cy: 800, r: 30 } },
      { id: "zone", type: "sensor", shape: box(950, 900, 20, 20, 45), tags: ["goal"] },
    ]);
    expect({ ledge: bodyOf("ledge"), zone: bodyOf("zone") }).toEqual(before);
    expect(rt.ctx.tags.handlesOf("zone")).toHaveLength(1);
    rt.destroy();
  });

  it("a type change despawns from the old system and spawns in the new", () => {
    const rt = loaded();
    const changed: RuntimeEntity[] = [
      { id: "zone", type: "solid", shape: box(900, 930, 40, 30) },
      { id: "ledge", type: "sensor", shape: box(1400, 800, 120, 10), tags: ["ledge"] },
      { id: "start", type: "beacon", at: [300, 960] },
      { id: "crate", type: "marker", at: [1200, 940] },
    ];
    expect(rt.update(structuredClone(changed))).toEqual({ ok: true });
    expect(rt.stats().perType).toEqual({
      solid: 4,
      sensor: 1,
      prop: 1,
      follower: 1,
      marker: 1,
      beacon: 1,
    });
    const byId = new Map(changed.map((e) => [e.id, e]));
    expect(tables(rt)).toEqual(
      freshTables(yardWith(engineYard().entities.map((e) => byId.get(e.id) ?? e))),
    );
    rt.destroy();
  });

  it("remove despawns and drops the entities from the scene", () => {
    const rt = loaded();
    rt.add(structuredClone(NEW));
    rt.remove(["ledge", "zone", "start", "crate", "lift", "light", "~solid:0"]);
    const gone = new Set(["ledge", "zone", "start", "crate", "lift", "light", "~solid:0"]);
    const expected = yardWith([...engineYard().entities, ...NEW].filter((e) => !gone.has(e.id)));
    expect(rt.scene()!.entities).toEqual(expected.entities);
    expect(rt.get("ledge")).toBeUndefined();
    expect(tables(rt)).toEqual(freshTables(expected));
    rt.destroy();
  });

  it("unknown ids and unchanged entities are no-ops", () => {
    const rt = loaded();
    const refresh = vi.spyOn(rt.ctx.physics!, "refreshQueries");
    const handles = rt.ctx.tags.handlesOf("ledge");
    const scene = rt.scene();
    const before = tables(rt);

    expect(rt.update([{ id: "nope", type: "solid", shape: box(0, 0, 1, 1) }])).toEqual({
      ok: true,
    });
    expect(rt.update(structuredClone(engineYard().entities))).toEqual({ ok: true });
    expect(rt.update([{ ...structuredClone(rt.get("ledge")!), name: undefined }])).toEqual({
      ok: true,
    });
    rt.remove(["nope", "also-nope"]);
    expect(rt.add([])).toEqual({ ok: true });

    expect(refresh).not.toHaveBeenCalled();
    expect(rt.get("nope")).toBeUndefined();
    expect(rt.ctx.tags.handlesOf("ledge")).toEqual(handles);
    expect(rt.scene()).toBe(scene);
    expect(tables(rt)).toEqual(before);
    rt.destroy();
  });

  it("rejects a duplicate or unknown-type call whole, with nothing changed", () => {
    const rt = loaded();
    const before = tables(rt);
    const shelf = NEW[0]!;
    expect(rt.add([shelf, { ...engineYard().entities[3]! }])).toEqual({
      ok: false,
      error: 'duplicate entity id "ledge"',
      entityId: "ledge",
    });
    expect(rt.add([shelf, { ...shelf }])).toEqual({
      ok: false,
      error: 'duplicate entity id "shelf"',
      entityId: "shelf",
    });
    expect(rt.add([shelf, { id: "c", type: "cloud", shape: box(0, 0, 1, 1) }])).toEqual({
      ok: false,
      error: 'unknown type "cloud"',
      entityId: "c",
    });
    expect(
      rt.update([
        { id: "ledge", type: "solid", shape: box(0, 0, 5, 5) },
        { id: "zone", type: "cloud", shape: box(0, 0, 1, 1) },
      ]),
    ).toEqual({ ok: false, error: 'unknown type "cloud"', entityId: "zone" });
    expect(
      rt.update([
        { id: "ledge", type: "solid", shape: box(0, 0, 5, 5) },
        { id: "ledge", type: "solid", shape: box(0, 0, 6, 6) },
      ]),
    ).toMatchObject({ ok: false, entityId: "ledge" });
    expect(rt.get("shelf")).toBeUndefined();
    expect(tables(rt)).toEqual(before);
    rt.destroy();
  });

  it("a spawn that throws rolls the whole call back", () => {
    const rt = loaded();
    const before = tables(rt);
    const stuck: RuntimeEntity = {
      id: "stuck",
      type: "follower",
      shape: box(0, 0, 10, 5),
      path: { pts: [[0, 0]], mode: "loop", speed: 10 },
    };
    expect(rt.add([NEW[0]!, NEW[2]!, NEW[5]!, stuck])).toMatchObject({
      ok: false,
      entityId: "stuck",
    });
    expect(tables(rt)).toEqual(before);

    expect(
      rt.update([
        { id: "ledge", type: "solid", shape: box(0, 0, 5, 5) },
        { id: "zone", type: "beacon", at: [0, 0] },
        { ...stuck, id: "lift" },
      ]),
    ).toMatchObject({ ok: false, entityId: "lift" });
    expect(
      rt.update([{ id: "ledge", type: "solid", shape: box(0, 0, 5, 5), material: "lava" }]),
    ).toEqual({ ok: false, error: 'unknown material "lava"', entityId: "ledge" });
    expect(rt.scene()!.entities).toEqual(engineYard().entities);
    expect(tables(rt)).toEqual(before);
    rt.destroy();
  });

  it("add and update need a loaded scene; remove without one does nothing", () => {
    const rt = runtime();
    expect(rt.add(NEW)).toEqual({ ok: false, error: "no scene loaded" });
    expect(rt.update(NEW)).toEqual({ ok: false, error: "no scene loaded" });
    rt.remove(["shelf"]);
    expect(rt.scene()).toBeNull();
    expect(rt.stats().entities).toBe(0);
    rt.destroy();
  });

  it("refreshes queries once per call, so a query sees the change before any step", () => {
    const rt = loaded();
    const refresh = vi.spyOn(rt.ctx.physics!, "refreshQueries");
    const hit = (x: number, y: number) =>
      rt.ctx.physics!.world.castRay(new rapier.Ray({ x, y: y - 5 }, { x: 0, y: 1 }), 10, true) !==
      null;
    expect(hit(600, 700)).toBe(false);
    rt.add(structuredClone(NEW));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(hit(600, 700)).toBe(true);
    rt.update([
      { id: "shelf", type: "solid", shape: box(600, 300, 80, 10) },
      { ...NEW[2]!, at: [1, 1] },
    ]);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(hit(600, 700)).toBe(false);
    expect(hit(600, 300)).toBe(true);
    rt.remove(["shelf", "pad"]);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(hit(600, 300)).toBe(false);
    rt.destroy();
  });

  it("keeps the game's state: onLoad doesn't run again and the tick carries on", () => {
    const onLoad = vi.fn();
    const game = defineGame({
      ...testGame,
      id: "counted",
      types: [],
      behaviors: [],
      createRuntime: (ctx) => ({ ...testGame.createRuntime(ctx), onLoad }),
    });
    const rt = runtime(game);
    rt.load(engineYard());
    rt.step(DT, []);
    rt.add([NEW[0]!]);
    rt.update([{ ...NEW[0]!, shape: box(600, 650, 80, 10) }]);
    rt.remove(["shelf"]);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(rt.step(DT, []).tick).toBe(1);
    rt.destroy();
  });
});

describe("system fast paths", () => {
  /** Two runtimes on engine-yard with the test game; the second has no `update` on any system. */
  function pair() {
    const fast = loaded(testGame);
    const slow = loaded(testGame);
    for (const type of ["solid", "sensor", "marker", "prop", "follower"]) {
      delete slow.ctx.system(type)!.update;
    }
    return { fast, slow };
  }

  it("give the same tables, and the same steps after, as despawn then spawn", () => {
    const { fast, slow } = pair();
    const edits: RuntimeEntity[][] = [
      [{ id: "zone", type: "sensor", shape: box(900, 930, 40, 30), tags: ["goal", "end"] }],
      [{ id: "zone", type: "sensor", shape: box(700, 930, 60, 30), tags: ["goal"] }],
      [{ id: "ledge", type: "solid", shape: box(1400, 900, 120, 10), oneWay: true }],
      [{ id: "ledge", type: "solid", shape: box(1400, 900, 120, 10) }],
      [{ id: "start", type: "marker", at: [310, 960], tags: ["spawn"] }],
      [{ id: "~solid:0", type: "solid", shape: box(1000, 985, 1000, 25) }],
    ];
    for (const edit of edits) {
      expect(fast.update(structuredClone(edit))).toEqual({ ok: true });
      expect(slow.update(structuredClone(edit))).toEqual({ ok: true });
      expect(tables(fast)).toEqual(tables(slow));
    }
    const right = { action: "right", pressed: true, tick: 0, timestamp: 0 };
    const run = (rt: Runtime) =>
      Array.from({ length: 90 }, (_, i) => rt.step(DT, i === 0 ? [right] : []));
    expect(round(run(fast))).toEqual(round(run(slow)));
    fast.destroy();
    slow.destroy();
  });

  it("a marker edit keeps its place in the marker list", () => {
    const rt = loaded();
    rt.add([NEW[2]!]);
    rt.update([{ id: "start", type: "marker", at: [0, 0] }]);
    expect(
      rt.ctx
        .system<MarkerSystem>("marker")!
        .list()
        .map((m) => m.id),
    ).toEqual(["start", "flag"]);
    rt.destroy();
  });
});

// ─── Random edits against a fresh load ───────────────────

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function moved(shape: ShapeObj, dx: number, dy: number): ShapeObj {
  switch (shape.type) {
    case "poly":
    case "chain":
      return { ...shape, pts: shape.pts.map(([x, y]) => [x + dx, y + dy] as Pt) };
    default:
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
  }
}

const anchor = (e: RuntimeEntity): Pt => {
  if (Array.isArray(e.at)) return e.at as Pt;
  if (e.type === "follower") return (e.path as { pts: Pt[] }).pts[0]!;
  const s = e.shape as ShapeObj;
  return s.type === "poly" || s.type === "chain" ? s.pts[0]! : [s.cx, s.cy];
};

function randomEdit(rand: () => number, e: RuntimeEntity): RuntimeEntity {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const d = () => Math.round((rand() - 0.5) * 8);
  const { id } = e;
  const [x, y] = anchor(e);
  const at: Pt = [x + d(), y + d()];
  switch (pick(["same", "fields", "fields", "type"] as const)) {
    case "same":
      return structuredClone(e);
    case "type":
      return pick<RuntimeEntity>([
        { id, type: "solid", shape: box(x, y, 12, 12) },
        { id, type: "sensor", shape: { type: "circle", cx: x, cy: y, r: 12 }, tags: ["moved"] },
        { id, type: "marker", at },
        { id, type: "beacon", at },
      ]);
  }
  switch (e.type) {
    case "solid": {
      const shape = e.shape as ShapeObj;
      return pick<RuntimeEntity>([
        { ...e, shape: moved(shape, d(), d()) },
        { ...e, oneWay: !e.oneWay },
        { ...e, material: e.material ? undefined : "ice" },
        { ...e, shape: shape.type === "box" ? { ...shape, rotDeg: shape.rotDeg + d() } : shape },
      ]);
    }
    case "sensor":
      return pick<RuntimeEntity>([
        { ...e, shape: moved(e.shape as ShapeObj, d(), d()) },
        { ...e, tags: [`zone-${Math.floor(rand() * 9)}`] },
      ]);
    case "prop":
      return pick<RuntimeEntity>([
        { ...e, shape: moved(e.shape as ShapeObj, d(), d()) },
        { ...e, density: 1 + Math.floor(rand() * 4) },
        { ...e, material: "ice" },
      ]);
    case "follower": {
      const path = e.path as { pts: Pt[]; speed: number };
      return pick<RuntimeEntity>([
        { ...e, path: { ...path, speed: 40 + Math.floor(rand() * 80) } },
        { ...e, path: { ...path, pts: path.pts.map(([px, py]) => [px + 3, py] as Pt) } },
      ]);
    }
    case "marker":
      return { ...e, at, tags: rand() < 0.5 ? ["spawn"] : undefined };
    default:
      return { id, type: "beacon", at };
  }
}

function randomNew(rand: () => number, id: string, cell: number): RuntimeEntity {
  const x = (cell % 30) * 200 + 100;
  const y = Math.floor(cell / 30) * 160 + 80;
  const kinds: RuntimeEntity[] = [
    { id, type: "solid", shape: box(x, y, 40, 8, 15), material: rand() < 0.5 ? "ice" : undefined },
    { id, type: "solid", shape: { type: "capsule", cx: x, cy: y, halfLen: 20, r: 6, rotDeg: 30 } },
    { id, type: "sensor", shape: box(x, y, 30, 30), tags: ["new"] },
    { id, type: "marker", at: [x, y] },
    {
      id,
      type: "prop",
      shape: { type: "circle", cx: x, cy: y, r: 10 },
      density: 2,
      restitution: 0.2,
    },
    {
      id,
      type: "follower",
      shape: box(0, 0, 20, 6),
      path: {
        pts: [
          [x - 30, y],
          [x + 30, y],
        ],
        mode: "ping_pong",
        speed: 50,
      },
    },
    { id, type: "beacon", at: [x, y] },
  ];
  return kinds[Math.floor(rand() * kinds.length)]!;
}

describe("random add, update and remove", () => {
  it.each([1, 7, 42])("match a fresh load at every step (seed %i)", (seed) => {
    const registry = createRegistry(yardGame);
    const base = expandScene(generateScene(seed), registry);
    const rt = runtime(yardGame, registry);
    const fresh = runtime(yardGame, registry);
    expect(rt.load(structuredClone(base)).ok).toBe(true);

    const rand = seeded(seed * 9973);
    let model = structuredClone(base.entities);
    let nextId = 0;
    let nextCell = 400;
    const some = <T>(xs: T[], n: number): T[] => {
      const pool = [...xs];
      const out: T[] = [];
      while (out.length < n && pool.length > 0) {
        out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
      }
      return out;
    };

    for (let step = 0; step < 40; step++) {
      const n = 1 + Math.floor(rand() * 5);
      const roll = rand();
      if (roll < 0.3) {
        const added = Array.from({ length: n }, () =>
          randomNew(rand, `new-${nextId++}`, nextCell++),
        );
        expect(rt.add(structuredClone(added))).toEqual({ ok: true });
        model = [...model, ...added];
      } else if (roll < 0.75) {
        const edits = some(model, n).map((e) => randomEdit(rand, e));
        const unknown = { id: `ghost-${step}`, type: "marker", at: [0, 0] as Pt };
        expect(rt.update(structuredClone([...edits, unknown]))).toEqual({ ok: true });
        const byId = new Map(edits.map((e) => [e.id, e]));
        model = model.map((e) => byId.get(e.id) ?? e);
      } else {
        const ids = some(model, n).map((e) => e.id);
        rt.remove([...ids, `ghost-${step}`, ids[0]!]);
        model = model.filter((e) => !ids.includes(e.id));
      }

      const expected: ExpandedScene = { ...base, entities: model };
      expect(rt.scene()!.entities).toEqual(model);
      expect(fresh.load(structuredClone(expected)).ok).toBe(true);
      expect(tables(rt), `step ${step}`).toEqual(tables(fresh));
    }
    rt.destroy();
    fresh.destroy();
  });
});
