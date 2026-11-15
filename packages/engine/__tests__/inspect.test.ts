import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { inspectEntity, listEntities, pickEntity } from "../debug/inspect";
import { TEXT } from "../game/behaviors/text";
import { createRegistry, defineGame } from "../game/define";
import type { EngineContext } from "../game/types";
import { createMotionBody, type MotionBody } from "../motion/body";
import { createGridStepper, type GridStepper } from "../motion/grid-step";
import { heldProject } from "../project/runtime-view";
import { snapshotDigest } from "../runtime/recorder";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { RapierModule } from "../types";
import { readHeld } from "./fixtures/held-project";
import { recordingView } from "./fixtures/recording-view";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function scene(entities: EntityDef[], settings: SceneDefinition["settings"]): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "inspect",
    bounds: [-20, -20, 20, 20],
    settings,
    entities,
  };
}

function load(
  entities: EntityDef[],
  physics: "rapier" | "none" = "rapier",
  game = testGame,
): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: physics === "rapier" ? rapier : null, view: null, game });
  const report = rt.load(
    expandScene(scene(entities, { physics, gravity: [0, 9.8] }), createRegistry(game)),
  );
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const step = (rt: SceneRuntimeHandle, n = 1) => {
  for (let i = 0; i < n; i++) rt.step(rt.ctx.time.tickMs, []);
};

/** Survives a JSON round trip unchanged: nothing a worker link would drop. */
const expectPlain = (v: unknown) => expect(JSON.parse(JSON.stringify(v))).toEqual(v);

const crate: EntityDef = {
  id: "crate",
  type: "prop",
  shape: ["box", 0, 0, 0.25, 0.25],
  density: 1,
  restitution: 0,
};
const floor: EntityDef = { id: "floor", type: "solid", shape: ["box", 0, 3, 5, 0.2] };
const PATH = {
  pts: [
    [0, 0],
    [3, 0],
  ],
  mode: "ping_pong",
  speed: 1.5,
  pauseMs: 0,
};

describe("inspectEntity", () => {
  it("shows a prop's velocity, angular velocity and sleep, and its pose and previous pose", () => {
    const rt = load([crate, floor]);
    step(rt, 5);
    const got = inspectEntity(rt, "crate")!;
    expectPlain(got);
    expect(got).toMatchObject({ id: "crate", type: "prop", enabled: true });
    expect(got.body!.velocity.y).toBeGreaterThan(0);
    expect(got.body!.sleeping).toBe(false);
    expect(got.system).toMatchObject({ angular: expect.any(Number), sleeping: false });
    expect(got.pose!.y).toBeGreaterThan(got.prevPose!.y);
    expect(got.entity).toMatchObject({ id: "crate", type: "prop" });
    rt.destroy();
  });

  it("shows what a sensor holds, and contacts name it", () => {
    const zone: EntityDef = { id: "zone", type: "sensor", shape: ["box", 0, 0, 1, 1] };
    const rt = load([zone, { ...crate, shape: ["box", 0, 0, 0.2, 0.2] }]);
    step(rt, 2);
    const got = inspectEntity(rt, "zone")!;
    expect(got.system).toMatchObject({ inside: ["crate"] });
    expect(got.contacts).toEqual(["crate"]);
    rt.destroy();
  });

  it("shows a follower's phase along its path", () => {
    const rt = load(
      [{ id: "lift", type: "follower", shape: ["box", 0, 0, 0.5, 0.1], path: PATH }],
      "none",
    );
    step(rt, 10);
    const got = inspectEntity(rt, "lift")!;
    expect(got.system).toMatchObject({ from: 0, to: 1, direction: 1, waypoints: 2 });
    expect((got.system as { t: number }).t).toBeGreaterThan(0);
    expect(got.body!.velocity.x).toBeCloseTo(1.5, 6);
    rt.destroy();
  });

  it("shows behaviors: path-follow, tween, lifetime and a collider's body", () => {
    const rt = load([
      {
        id: "bob",
        type: "marker",
        at: [0, 0],
        behaviors: {
          "path-follow": { path: PATH },
          tween: { tweens: [{ to: { rot: 1 }, duration: 30 }] },
          lifetime: { ticks: 100 },
        },
      },
      {
        id: "cart",
        type: "marker",
        at: [5, 5],
        behaviors: {
          collider: { shape: ["box", 0, 0, 0.2, 0.2] },
          body: { kind: "kinematic" },
        },
      },
    ]);
    rt.ctx.bodies.setVelocity("cart", { x: 2, y: 0 });
    step(rt, 3);
    const bob = inspectEntity(rt, "bob")!;
    expectPlain(bob);
    expect(bob.behaviors["path-follow"]).toMatchObject({ from: 0, to: 1 });
    expect(bob.behaviors.tween).toMatchObject({
      tweens: [{ to: { rot: 1 }, duration: 30 }],
      paused: false,
    });
    expect(bob.behaviors.lifetime).toMatchObject({ then: "destroy" });
    expect((bob.behaviors.lifetime as { left: number }).left).toBeLessThan(100);
    const cart = inspectEntity(rt, "cart")!;
    expect(cart.behaviors.collider).toMatchObject({ kind: "kinematic", velocity: { x: 2, y: 0 } });
    expect(cart.behaviors.body).toEqual({ kind: "kinematic" });
    expect(cart.body!.velocity).toEqual({ x: 2, y: 0 });
    rt.destroy();
  });

  it("shows a motion body's velocity and last move, and a grid stepper's cell, as owners", () => {
    let hero: MotionBody | null = null;
    let unit: GridStepper | null = null;
    const game = defineGame({
      ...testGame,
      createRuntime: (ctx: EngineContext) => ({
        onLoad() {
          hero = createMotionBody(
            ctx,
            { id: "hero", type: "marker" },
            { x: 1, y: 2 },
            { shape: { type: "box", cx: 0, cy: 0, hw: 0.2, hh: 0.2, rotDeg: 0 } },
          );
          unit = createGridStepper(ctx, "unit", { start: [1, 5], msPerStep: 500 });
        },
        beforeStep() {
          hero?.setVelocity({ x: 1, y: 0 });
          hero?.move({ x: 0.1, y: 0 });
          if (unit && !unit.moving()) unit.step([2, 5]);
          unit?.update(ctx.time.tickMs);
        },
        snapshot: () => null,
      }),
    });
    const rt = createSceneRuntime({ rapier: null, view: null, game });
    const report = rt.load(
      expandScene(
        {
          ...scene(
            [
              { id: "hero", type: "marker", at: [1, 2] },
              { id: "unit", type: "marker", at: [1.5, 5.5] },
            ],
            { physics: "none", gravity: [0, 0], grid: { kind: "square", cell: [1, 1] } },
          ),
          bounds: [0, 0, 12, 8],
        },
        createRegistry(game),
      ),
    );
    if (!report.ok) throw new Error(report.error);
    step(rt, 2);
    const h = inspectEntity(rt, "hero")!;
    expect(h.owners?.motion).toMatchObject({
      velocity: { x: 1, y: 0 },
      enabled: true,
      last: { blocked: false, hits: [] },
    });
    expect(h.body!.velocity).toEqual({ x: 1, y: 0 });
    const u = inspectEntity(rt, "unit")!;
    expect(u.owners?.["grid-step"]).toMatchObject({ cell: [2, 5], moving: true, from: [1, 5] });
    rt.destroy();
  });

  it("shows anim's AnimState", () => {
    const art = heldProject(
      readHeld(fileURLToPath(new URL("../scenes/", import.meta.url)), (path) =>
        ["art/hero.json", "art/kitchen.animation.json"].includes(path),
      ).files,
      createRegistry(),
      { projectId: "p", name: "P" },
    );
    const rt = createSceneRuntime({
      rapier: null,
      view: null,
      registry: createRegistry(),
      project: art.runtime,
    });
    const report = rt.load({
      name: "anim",
      bounds: [-10, -10, 10, 10],
      settings: {
        gravity: [0, 0],
        physics: "none",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [
        {
          id: "hero",
          type: "marker",
          at: [0, 0],
          behaviors: {
            anim: { clip: "idle", source: "kitchen-animation" },
            sprite: { asset: "hero", frame: "hero-0" },
          },
        },
      ],
    });
    expect(report.ok, JSON.stringify(report)).toBe(true);
    step(rt, 5);
    const got = inspectEntity(rt, "hero")!;
    expect(got.behaviors.anim).toEqual(rt.ctx.anim.state("hero"));
    expect(got.behaviors.anim).toMatchObject({ clip: "idle", playing: true });
    rt.destroy();
  });

  it("reports a disabled entity as enabled: false", () => {
    const rt = load([crate, floor]);
    rt.ctx.setEnabled("crate", false);
    const got = inspectEntity(rt, "crate")!;
    expect(got.enabled).toBe(false);
    expect(listEntities(rt).find((r) => r.id === "crate")).toMatchObject({ enabled: false });
    rt.destroy();
  });

  it("shows a spawned entity's velocity under its runtime id", () => {
    const rt = load([floor]);
    const bullet = rt.ctx.spawn({
      type: "prop",
      shape: ["box", 0, 0, 0.1, 0.1],
      density: 1,
      restitution: 0,
    });
    rt.ctx.bodies.setVelocity(bullet.id, { x: 4, y: 0 });
    step(rt);
    const got = inspectEntity(rt, bullet.id)!;
    expect(got.id).toBe(bullet.id);
    expect(got.body!.velocity.x).toBeCloseTo(4, 3);
    expect(listEntities(rt).map((r) => r.id)).toContain(bullet.id);
    rt.destroy();
  });

  it("lists an owner's timers", () => {
    const rt = load([crate]);
    rt.ctx.timers.after(10, { emit: "ping" }, { owner: "crate" });
    rt.ctx.timers.every(5, { emit: "tick" }, { owner: "crate" });
    rt.ctx.timers.after(3, { emit: "other" });
    const got = inspectEntity(rt, "crate")!;
    expect(got.timers.map((t) => t.kind)).toEqual(["after", "every"]);
    expect(got.timers[0]!.due).toBeGreaterThan(0);
    rt.destroy();
  });

  it("gives function-form timers and coroutines their due tick", () => {
    const rt = load([crate]);
    const tick = rt.ctx.tick;
    rt.ctx.timers.after(4, () => {}, { owner: "crate" });
    rt.ctx.timers.start(
      function* () {
        yield 2;
      },
      { owner: "crate" },
    );
    const got = inspectEntity(rt, "crate")!;
    expect(got.timers.map((t) => t.kind)).toEqual(["after", "co"]);
    expect(got.timers[0]!.due).toBeGreaterThan(tick);
    expect(got.timers.every((t) => t.due >= 0)).toBe(true);
    rt.destroy();
  });

  it("reports the runtime tree's parent, and follows a reparent", () => {
    const rt = load(
      [
        { id: "yard", type: "node", at: [0, 0] },
        { id: "other", type: "node", at: [5, 0] },
        { id: "kid", type: "marker", at: [1, 0], parent: "yard" },
      ],
      "none",
    );
    expect(inspectEntity(rt, "kid")!.parent).toBe("yard");
    expect(inspectEntity(rt, "yard")!.parent).toBeNull();
    rt.ctx.tree.setParent("kid", "other");
    expect(inspectEntity(rt, "kid")!.parent).toBe("other");
    rt.ctx.tree.setParent("kid", null);
    expect(inspectEntity(rt, "kid")!.parent).toBeNull();
    rt.destroy();
  });

  it("answers each standard behavior's and the nav system's inspect as plain JSON", () => {
    const rt = load([
      floor,
      { id: "walk", type: "nav", shape: ["poly", -5, -5, 5, -5, 5, 5, -5, 5] },
      { id: "goal", type: "marker", at: [3, 0] },
      {
        id: "bin",
        type: "marker",
        at: [-3, 0],
        behaviors: {
          spawner: { cap: 2, rate: 0.5, type: "solid", fields: { shape: ["box", 0, 0, 0.1, 0.1] } },
        },
      },
      {
        id: "anchor",
        type: "marker",
        at: [-1, -2],
        behaviors: { collider: { shape: ["box", 0, 0, 0.1, 0.1] }, body: { kind: "static" } },
      },
      {
        id: "link",
        type: "marker",
        at: [-0.5, -2],
        behaviors: {
          body: {},
          collider: { shape: ["box", 0, 0, 0.1, 0.1] },
          joint: { kind: "revolute", to: "anchor", anchorA: [-0.5, 0], anchorB: [0, 0] },
        },
      },
      {
        id: "updraft",
        type: "marker",
        at: [4, -2],
        behaviors: {
          collider: { sensor: true, shape: ["box", 0, 0, 0.3, 0.3] },
          "force-area": { force: [0, -15] },
        },
      },
      { id: "seat", type: "marker", at: [1, 1], behaviors: { "player-input": {} } },
      { id: "courier", type: "marker", at: [-2, 0], behaviors: { "nav-agent": { to: "goal" } } },
      {
        id: "runner",
        type: "marker",
        at: [2, 2],
        behaviors: {
          "character-side-view": {},
          collider: { shape: ["box", 0, 0, 0.1, 0.2] },
        },
      },
      {
        id: "walker",
        type: "marker",
        at: [-2, 2],
        behaviors: { "character-top-down": {}, collider: { shape: ["circle", 0, 0, 0.15] } },
      },
    ]);
    const shown = createSceneRuntime({
      rapier: null,
      view: recordingView({ sprites: true }).view,
      game: testGame,
    });
    const report = shown.load(
      expandScene(
        scene(
          [
            { id: "chime", type: "marker", at: [0, 0], behaviors: { audio: { sound: "clink" } } },
            { id: "sign", type: "marker", at: [0, 0], behaviors: { text: { text: "Hello" } } },
            { id: "pic", type: "marker", at: [0, 0], behaviors: { sprite: { size: [0.4, 0.4] } } },
          ],
          { physics: "none", gravity: [0, 0] },
        ),
        createRegistry(testGame),
      ),
    );
    if (!report.ok) throw new Error(report.error);
    step(rt, 3);
    step(shown, 3);
    const cases: [on: SceneRuntimeHandle, id: string, name: string, keys: string[]][] = [
      [shown, "chime", "audio", ["sound", "playing", "voice"]],
      [shown, "sign", "text", ["shown", "disabled"]],
      [shown, "pic", "sprite", ["frame", "look", "layer"]],
      [rt, "bin", "spawner", ["on", "live", "owed", "burst"]],
      [rt, "link", "joint", ["target", "joined", "held", "disabled"]],
      [rt, "updraft", "force-area", ["on", "inside"]],
      [rt, "seat", "player-input", ["seat", "joined"]],
      [rt, "courier", "nav-agent", ["on", "to", "target", "path", "next", "stuckTicks", "blocked"]],
      [rt, "runner", "character-side-view", ["intent", "held", "grounded", "disabled"]],
      [rt, "walker", "character-top-down", ["intent", "disabled"]],
    ];
    for (const [on, id, name, keys] of cases) {
      const got = inspectEntity(on, id)!;
      expectPlain(got);
      const shown = got.behaviors[name];
      expect(shown, `${id} ${name}`).toBeTypeOf("object");
      expect(Object.keys(shown as object).sort(), `${id} ${name}`).toEqual([...keys].sort());
    }
    expect(inspectEntity(shown, "sign")!.behaviors.text).toEqual({ shown: null, disabled: false });
    shown.ctx.entity("sign")!.getBehavior(TEXT)!.set("Bye");
    expect(inspectEntity(shown, "sign")!.behaviors.text).toMatchObject({ shown: { text: "Bye" } });
    expect(inspectEntity(rt, "link")!.behaviors.joint).toMatchObject({ target: "anchor" });
    expect(inspectEntity(rt, "courier")!.behaviors["nav-agent"]).toMatchObject({ target: "goal" });
    const nav = inspectEntity(rt, "walk")!;
    expectPlain(nav);
    expect(nav.system).toMatchObject({ mode: "walk", revision: expect.any(Number) });
    rt.destroy();
    shown.destroy();
  });

  it("answers an occupant's cell on a grid", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: testGame });
    const report = rt.load(
      expandScene(
        {
          ...scene([{ id: "pawn", type: "marker", at: [1.5, 2.5], behaviors: { occupant: {} } }], {
            physics: "none",
            gravity: [0, 0],
            grid: { kind: "square", cell: [1, 1] },
          }),
          bounds: [0, 0, 8, 8],
        },
        createRegistry(testGame),
      ),
    );
    if (!report.ok) throw new Error(report.error);
    step(rt);
    const got = inspectEntity(rt, "pawn")!;
    expectPlain(got);
    expect(got.behaviors.occupant).toEqual({ cell: [1, 2], blocks: expect.any(Boolean) });
    rt.destroy();
  });

  it("is null for an id that isn't live", () => {
    const rt = load([crate]);
    expect(inspectEntity(rt, "nobody")).toBeNull();
    rt.destroy();
  });
});

describe("listEntities", () => {
  it("lists rows in spawn order with type and pose, filtered by the selector", () => {
    const rt = load([floor, crate]);
    const rows = listEntities(rt);
    expect(rows.map((r) => r.id)).toEqual(["floor", "crate"]);
    expect(rows[1]).toMatchObject({ type: "prop", enabled: true, at: { x: 0, y: 0 } });
    expect(listEntities(rt, { type: "prop" }).map((r) => r.id)).toEqual(["crate"]);
    expectPlain(rows);
    rt.destroy();
  });
});

describe("pickEntity", () => {
  it("picks the topmost entity under the point: layer, then z, then the later spawn", () => {
    const box = (id: string, z?: number): EntityDef => ({
      id,
      type: "solid",
      shape: ["box", 0, 0, 1, 1],
      ...(z !== undefined ? { z } : {}),
    });
    const rt = load([box("low"), box("high", 2), box("late")], "none");
    expect(pickEntity(rt, { x: 0.5, y: 0.5 })).toBe("high");
    rt.ctx.setEnabled("high", false);
    expect(pickEntity(rt, { x: 0.5, y: 0.5 })).toBe("late");
    expect(pickEntity(rt, { x: 9, y: 9 })).toBeNull();
    rt.destroy();
  });
});

describe("inspection is read-only", () => {
  it("inspecting every entity every tick never changes a digest", () => {
    const entities: EntityDef[] = [
      crate,
      floor,
      { id: "zone", type: "sensor", shape: ["box", 0, 2, 2, 1] },
      { id: "lift", type: "follower", shape: ["box", 0, -3, 0.5, 0.1], path: PATH },
      {
        id: "bob",
        type: "marker",
        at: [2, -2],
        behaviors: { tween: { tweens: [{ to: { y: -1 }, duration: 20 }] } },
      },
    ];
    const run = (inspect: boolean): string[] => {
      const rt = load(entities);
      const digests: string[] = [];
      for (let i = 0; i < 90; i++) {
        if (inspect) {
          for (const row of listEntities(rt)) inspectEntity(rt, row.id);
          pickEntity(rt, { x: 0, y: 0 });
        }
        rt.step(rt.ctx.time.tickMs, []);
        const poses = listEntities(rt).map((r) => [r.id, rt.ctx.poses.get(r.id)]);
        digests.push(snapshotDigest({ snapshot: rt.snapshot(), poses }));
      }
      rt.destroy();
      return digests;
    };
    expect(run(true)).toEqual(run(false));
  });
});
