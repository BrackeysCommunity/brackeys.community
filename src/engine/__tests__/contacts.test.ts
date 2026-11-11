// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { defineEntityType, defineGame } from "../game/define";
import { pointField, shapeField, tagsField } from "../game/fields";
import type { ContactSelector, EngineContext, GameDefinition } from "../game/types";
import { createContacts } from "../runtime/contacts";
import { createSceneRuntime } from "../runtime/runtime";
import { CONTACT_END, CONTACT_START, type StepEvent } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import type { RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";

const DT = 1000 / 60;

let standard: RapierModule;
let compat: RapierModule;

beforeAll(async () => {
  standard = await import("@dimforge/rapier2d");
  compat = await loadCompatRapier();
});

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

/** A solid with tags, so watches can name it by tag. */
const STONE = defineEntityType({
  type: "stone",
  description: "A tagged solid.",
  base: "solid",
  fields: { shape: shapeField("The stone's shape."), tags: tagsField("Labels.") },
});

const stones = defineGame({
  id: "stones",
  types: [STONE],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

function scene(physics: "rapier" | "none", entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "contacts",
    bounds: [0, 0, 1000, 1000],
    settings: { gravity: [0, 1200], physics, grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

const ground: RuntimeEntity = { id: "ground", type: "solid", shape: box(500, 980, 500, 20) };

/** A kinematic lift running from y 900 up to y 500 and back, through what sits on its path. */
const lift = (id: string, x: number): RuntimeEntity => ({
  id,
  type: "follower",
  shape: box(0, 0, 60, 8),
  path: {
    pts: [
      [x, 900],
      [x, 500],
    ],
    mode: "ping_pong",
    speed: 600,
    pauseMs: 0,
  },
});

/** Two stones on the lift's path, one tagged, and a second lift through an untagged post. */
const LIFT_YARD: RuntimeEntity[] = [
  { id: "low", type: "stone", shape: box(300, 800, 100, 4), tags: ["mark"] },
  { id: "high", type: "stone", shape: box(300, 650, 100, 4), tags: [] },
  { id: "post", type: "stone", shape: box(700, 700, 100, 4), tags: [] },
  lift("lift", 300),
  lift("shuttle", 700),
];

type Run = {
  rt: ReturnType<typeof createSceneRuntime>;
  step(n: number): StepEvent[];
};

function run(
  physics: "rapier" | "none",
  entities: RuntimeEntity[],
  opts: { rapier?: RapierModule; game?: GameDefinition } = {},
): Run {
  const rt = createSceneRuntime({
    rapier: opts.rapier ?? standard,
    view: null,
    game: opts.game ?? stones,
  });
  const report = rt.load(scene(physics, entities));
  if (!report.ok) throw new Error(report.error);
  expect(rt.stats().backend).toBe(physics === "rapier" ? "rapier" : "geometry");
  return {
    rt,
    step(n) {
      const out: StepEvent[] = [];
      for (let i = 0; i < n; i++) {
        out.push(...rt.step(DT, []).events.filter((e) => e.type.startsWith("contact:")));
      }
      return out;
    },
  };
}

const brief = (events: StepEvent[]) =>
  events.map((e) => `${e.tick} ${e.type} ${e.entityId}>${e.other}`);

/** Each pair's events in order, `start` or `end`, for counting. */
function byPair(events: StepEvent[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of events) {
    const key = `${e.entityId}>${e.other}`;
    (out[key] ??= []).push(e.type === CONTACT_START ? "start" : "end");
  }
  return out;
}

describe("the contactCollider probe", () => {
  for (const [flavour, load] of [
    ["rapier2d", () => standard],
    ["rapier2d-compat", () => compat],
  ] as const) {
    it(`reads contact state with no callback under the test runner (${flavour})`, () => {
      const R = load();
      const world = new R.World(new R.Vector2(0, 0));
      try {
        const at = (x: number, y: number) =>
          world.createCollider(R.ColliderDesc.cuboid(10, 10).setTranslation(x, y));
        const a = at(0, 0);
        const overlapping = at(0, 15);
        const touching = at(0, 20);
        const apart = at(0, 25);

        const hit = a.contactCollider(overlapping, 0);
        expect(hit).not.toBeNull();
        expect(hit!.distance).toBeLessThan(0);
        expect(hit!.point1.y).toBeCloseTo(10, 5);
        expect(hit!.point2.y).toBeCloseTo(5, 5);

        const edge = a.contactCollider(touching, 0);
        expect(edge).not.toBeNull();
        expect(edge!.distance).toBeLessThanOrEqual(1e-6);

        expect(a.contactCollider(apart, 0)).toBeNull();
        // With a prediction it reports the gap instead.
        expect(a.contactCollider(apart, 10)!.distance).toBeCloseTo(5, 5);
      } finally {
        world.free();
      }
    });
  }

  it("runs the runtime's contact reads on both flavours alike", () => {
    const events = (rapier: RapierModule) => {
      const r = run("rapier", [ground, crate()], { rapier });
      r.rt.ctx.contacts.watch("crate");
      const out = brief(r.step(90));
      r.rt.destroy();
      return out;
    };
    const a = events(standard);
    expect(a.length).toBeGreaterThan(0);
    expect(events(compat)).toEqual(a);
  });
});

function crate(): RuntimeEntity {
  return { id: "crate", type: "prop", shape: box(500, 900, 20, 20), density: 1, restitution: 0 };
}

describe("a watched prop on Rapier", () => {
  it("raises one contact:start on landing and one contact:end on lifting", () => {
    const r = run("rapier", [ground, crate()]);
    r.rt.ctx.contacts.watch("crate");
    const landed = r.step(120);
    expect(landed.map((e) => e.type)).toEqual([CONTACT_START]);
    const [start] = landed;
    expect(start).toMatchObject({ entityId: "crate", other: "ground" });
    // The contact point is on the crate's bottom face, over the ground's top.
    expect(start!.at.y).toBeGreaterThan(955);
    expect(start!.at.y).toBeLessThan(965);
    expect(Math.abs(start!.at.x - 500)).toBeLessThanOrEqual(20);

    const [handle] = r.rt.ctx.tags.handlesOf("crate");
    const body = r.rt.ctx.physics!.world.getCollider(handle!)!.parent()!;
    body.setTranslation({ x: 500, y: 700 }, true);
    body.setLinvel({ x: 0, y: 0 }, true);
    const lifted = r.step(1);
    expect(lifted).toHaveLength(1);
    expect(lifted[0]).toMatchObject({ type: CONTACT_END, entityId: "crate", other: "ground" });

    // It falls again and lands once more.
    expect(r.step(120).map((e) => e.type)).toEqual([CONTACT_START]);
    r.rt.destroy();
  });

  it("reads nothing of the context, Rapier included, with nothing watched", () => {
    const touched: PropertyKey[] = [];
    const ctx = new Proxy({} as EngineContext, {
      get(_, key) {
        touched.push(key);
        throw new Error(`read ctx.${String(key)}`);
      },
    });
    const contacts = createContacts(ctx);
    contacts.read();
    contacts.watch("crate")();
    contacts.read();
    contacts.forget("crate");
    expect(touched).toEqual([]);
  });

  it("raises nothing without a watch, and nothing once unwatched", () => {
    const r = run("rapier", [ground, crate()]);
    expect(r.step(60)).toEqual([]);
    const unwatch = r.rt.ctx.contacts.watch("crate", "ground");
    unwatch();
    expect(r.step(60)).toEqual([]);
    r.rt.destroy();
  });

  it("ends a disabled entity's contacts without an end event, and starts them again on enable", () => {
    const r = run("rapier", [ground, crate()]);
    r.rt.ctx.contacts.watch("ground");
    expect(byPair(r.step(120))).toEqual({ "ground>crate": ["start"] });
    r.rt.ctx.setEnabled("crate", false);
    expect(r.step(10)).toEqual([]);
    r.rt.ctx.setEnabled("crate", true);
    expect(byPair(r.step(10))).toEqual({ "ground>crate": ["start"] });
    r.rt.destroy();
  });
});

describe("watched pairs on both backends", () => {
  for (const physics of ["rapier", "none"] as const) {
    it(`starts and ends a lift's pass through a stone (${physics})`, () => {
      const r = run(physics, LIFT_YARD);
      r.rt.ctx.contacts.watch("lift");
      const events = r.step(120);
      const pairs = byPair(events);
      expect(Object.keys(pairs).sort()).toEqual(["lift>high", "lift>low"]);
      for (const seq of Object.values(pairs)) {
        expect(seq.length).toBeGreaterThanOrEqual(2);
        expect(seq.every((s, i) => s === (i % 2 === 0 ? "start" : "end"))).toBe(true);
      }
      const first = events.find((e) => e.other === "low")!;
      expect(first.type).toBe(CONTACT_START);
      expect(Math.abs(first.at.x - 300)).toBeLessThanOrEqual(60);
      expect(Math.abs(first.at.y - 800)).toBeLessThanOrEqual(12);
      r.rt.destroy();
    });
  }

  it("raises the same starts and ends at the same ticks on both", () => {
    const ticks = (physics: "rapier" | "none") => {
      const r = run(physics, LIFT_YARD);
      r.rt.ctx.contacts.watch("lift");
      const out = brief(r.step(120));
      r.rt.destroy();
      return out;
    };
    expect(ticks("none")).toEqual(ticks("rapier"));
  });

  const watched = (...sels: [ContactSelector, ContactSelector?][]) => {
    const r = run("none", LIFT_YARD);
    for (const [a, b] of sels) r.rt.ctx.contacts.watch(a, b);
    const events = r.step(120);
    r.rt.destroy();
    return events;
  };

  it("watches by id, by type and by tag", () => {
    expect(Object.keys(byPair(watched(["low"])))).toEqual(["low>lift"]);
    expect(Object.keys(byPair(watched([{ tag: "mark" }])))).toEqual(["low>lift"]);
    expect(Object.keys(byPair(watched([{ type: "stone" }]))).sort()).toEqual([
      "high>lift",
      "low>lift",
      "post>shuttle",
    ]);
    expect(Object.keys(byPair(watched([{ type: "stone", tag: "mark" }])))).toEqual(["low>lift"]);
    expect(Object.keys(byPair(watched(["lift", { tag: "mark" }])))).toEqual(["lift>low"]);
    expect(Object.keys(byPair(watched([{ type: "follower" }, "post"])))).toEqual(["shuttle>post"]);
  });

  it("raises nothing for unwatched pairs", () => {
    const events = watched(["lift"]);
    expect(events.some((e) => e.entityId === "shuttle" || e.other === "shuttle")).toBe(false);
    expect(events.some((e) => e.entityId === "post" || e.other === "post")).toBe(false);
    expect(watched(["low", "shuttle"])).toEqual([]);
  });

  it("reports a pair once per tick, however many watches or sides name it", () => {
    const one = watched(["lift"]);
    const many = watched(["lift"], [{ type: "stone" }], ["low", "lift"], [{ type: "follower" }]);
    const ticks = (events: StepEvent[], other: string) =>
      events
        .filter((e) => e.entityId === other || e.other === other)
        .map((e) => `${e.tick} ${e.type}`);
    expect(ticks(many, "low")).toEqual(ticks(one, "low"));
    expect(ticks(many, "high")).toEqual(ticks(one, "high"));
    // The first watch decides which side is `entityId`.
    expect(many.filter((e) => e.other === "low" || e.entityId === "low")[0]).toMatchObject({
      entityId: "lift",
      other: "low",
    });
    // Both sides of a type-to-type watch name the pair once.
    const keys = brief(many);
    expect(new Set(keys).size).toBe(keys.length);
    const perTick = new Map<string, number>();
    for (const e of many) {
      const k = `${e.tick} ${[e.entityId ?? "", e.other ?? ""].sort((x, y) => x.localeCompare(y)).join("+")}`;
      perTick.set(k, (perTick.get(k) ?? 0) + 1);
    }
    expect([...perTick.values()].every((n) => n === 1)).toBe(true);
  });

  it("ends a destroyed entity's contacts without an end event", () => {
    const r = run("none", LIFT_YARD);
    r.rt.ctx.contacts.watch("lift");
    let events: StepEvent[] = [];
    for (let i = 0; i < 120 && !events.some((e) => e.type === CONTACT_START); i++) {
      events = r.step(1);
    }
    const start = events.find((e) => e.type === CONTACT_START)!;
    expect(start).toBeDefined();
    r.rt.ctx.destroy(start.other!);
    const after = r.step(120);
    expect(after.some((e) => e.other === start.other)).toBe(false);
    r.rt.destroy();
  });
});

/** A puck with no shape field: its system builds a 60 px box collider around `at` in code. */
const PUCK = defineEntityType({
  type: "puck",
  description: "A box its system builds in code.",
  fields: { at: pointField("The puck's centre.") },
  system: (ctx) => {
    const handles = new Map<string, number>();
    return {
      spawn(e) {
        const [x, y] = (e as RuntimeEntity & { at: [number, number] }).at;
        let handle: number;
        if (ctx.physics) {
          const { ColliderDesc } = ctx.physics.rapier;
          handle = ctx.physics.addCollider(ColliderDesc.cuboid(30, 30).setTranslation(x, y)).handle;
        } else {
          handle = ctx.geometry!.add({
            shape: { type: "box", cx: 0, cy: 0, hw: 30, hh: 30, rotDeg: 0 },
            body: "kinematic",
            pose: { x, y, rot: 0 },
          });
        }
        ctx.tags.set(handle, { entityId: e.id, type: "puck" });
        handles.set(e.id, handle);
      },
      despawn(id) {
        const handle = handles.get(id);
        if (handle === undefined) return;
        handles.delete(id);
        ctx.tags.delete(handle);
        if (ctx.physics) ctx.physics.removeCollider(ctx.physics.world.getCollider(handle));
        else ctx.geometry!.remove(handle);
      },
      clear() {
        for (const id of [...handles.keys()]) this.despawn(id);
      },
      size: () => handles.size,
    };
  },
});

const pucks = defineGame({
  id: "pucks",
  types: [STONE, PUCK],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

describe("an entity whose colliders come from its system", () => {
  for (const physics of ["rapier", "none"] as const) {
    it(`touches a wall beside its pose by its collider's bounds (${physics})`, () => {
      // The puck's pose is its centre (500, 500), outside the wall; its box reaches 530, into the wall's 525.
      const r = run(
        physics,
        [
          { id: "puck", type: "puck", at: [500, 500] },
          { id: "wall", type: "stone", shape: box(545, 500, 20, 100), tags: [] },
        ],
        { game: pucks },
      );
      r.rt.ctx.contacts.watch("puck", { type: "stone" });
      const started = r.step(1);
      expect(started).toHaveLength(1);
      expect(started[0]).toMatchObject({ type: CONTACT_START, entityId: "puck", other: "wall" });
      expect(Math.abs(started[0]!.at.x - 527.5)).toBeLessThanOrEqual(3);

      // Moving the collider away, with its pose left where it was, ends the contact.
      const [handle] = r.rt.ctx.tags.handlesOf("puck");
      if (physics === "rapier") {
        r.rt.ctx.physics!.world.getCollider(handle!).setTranslation({ x: 300, y: 500 });
      } else {
        r.rt.ctx.geometry!.setPose(handle!, 300, 500);
      }
      const ended = r.step(1);
      expect(ended).toHaveLength(1);
      expect(ended[0]).toMatchObject({ type: CONTACT_END, entityId: "puck", other: "wall" });
      r.rt.destroy();
    });
  }

  it("finds a Rapier collider resized in place, which keeps its shape object", () => {
    const r = run(
      "rapier",
      [
        { id: "puck", type: "puck", at: [400, 500] },
        { id: "wall", type: "stone", shape: box(545, 500, 20, 100), tags: [] },
      ],
      { game: pucks },
    );
    r.rt.ctx.contacts.watch("puck", { type: "stone" });
    expect(r.step(1)).toEqual([]);
    const [handle] = r.rt.ctx.tags.handlesOf("puck");
    r.rt.ctx.physics!.world.getCollider(handle!).setHalfExtents({ x: 130, y: 30 });
    const started = r.step(1);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ type: CONTACT_START, entityId: "puck", other: "wall" });
    r.rt.destroy();
  });
});
