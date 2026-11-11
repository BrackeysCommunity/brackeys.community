import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { SceneView } from "../context";
import { defineGame } from "../game/define";
import type { EngineContext } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import type { StepEvent } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import type { SolidSystem } from "../systems/bodies";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

/** Static colliders, the lift's among them, set off sensors here; with the primitives alone nothing does. */
const lifts = defineGame({
  id: "lifts",
  types: [],
  actions: [],
  collisionGroups: { static: { collidesWith: ["sensor"] } },
  createRuntime: () => ({ snapshot: () => null }),
});

/**
 * The engine yard with its props removed and its sensor moved onto the
 * lift's path, its edges off the lift's per-tick positions so touching
 * never decides a tick.
 */
function yard(physics: "rapier" | "none"): ExpandedScene {
  const scene = engineYard();
  scene.settings.physics = physics;
  scene.entities = scene.entities
    .filter((e) => e.type !== "prop")
    .map(
      (e): RuntimeEntity =>
        e.id === "zone"
          ? { ...e, shape: { type: "box", cx: 17, cy: 7.505, hw: 0.4, hh: 0.3, rotDeg: 0 } }
          : e,
    );
  return scene;
}

function sensorEvents(physics: "rapier" | "none", ticks: number): StepEvent[] {
  const rt = createSceneRuntime({ rapier, view: null, game: lifts });
  const report = rt.load(yard(physics));
  if (!report.ok) throw new Error(report.error);
  expect(rt.stats().backend).toBe(physics === "rapier" ? "rapier" : "geometry");
  const events: StepEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    events.push(...rt.step(DT, []).events.filter((e) => e.type.startsWith("sensor:")));
  }
  rt.destroy();
  return events;
}

describe("the geometry backend", () => {
  it("raises the same sensor events as Rapier for a kinematic follower passing through", () => {
    const onRapier = sensorEvents("rapier", 600);
    const onGeometry = sensorEvents("none", 600);
    const summary = (events: StepEvent[]) =>
      events.map((e) => [e.type, e.entityId, e.other, e.tick]);

    expect(summary(onRapier).map(([type, , other]) => [type, other])).toEqual([
      ["sensor:enter", "lift"],
      ["sensor:exit", "lift"],
      ["sensor:enter", "lift"],
      ["sensor:exit", "lift"],
      ["sensor:enter", "lift"],
    ]);
    expect(summary(onGeometry)).toEqual(summary(onRapier));
    for (const [i, e] of onGeometry.entries()) {
      const r = onRapier[i]!;
      expect(e.at.x).toBeCloseTo(r.at.x, 3);
      expect(e.at.y).toBeCloseTo(r.at.y, 3);
    }
  });
});

// ─── Disable and enable ──────────────────────────────────

describe("disabling and enabling bodies on the geometry backend", () => {
  const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
    type: "box",
    cx,
    cy,
    hw,
    hh,
    rotDeg: 0,
  });

  /** Runs inside the game's `beforeStep`, after the systems' own. */
  let duringStep: ((ctx: EngineContext) => void) | null = null;

  /** The test game, with static colliders setting off sensors and a hook into its `beforeStep`. */
  const sensing = defineGame({
    ...testGame,
    collisionGroups: {
      dynamic: { collidesWith: ["sensor"] },
      static: { collidesWith: ["sensor"] },
    },
    createRuntime(ctx) {
      const inner = testGame.createRuntime(ctx);
      return {
        ...inner,
        beforeStep(dtMs, actions, commands) {
          inner.beforeStep?.(dtMs, actions, commands);
          duringStep?.(ctx);
        },
      };
    },
  });

  function load(
    entities: RuntimeEntity[],
    physics: "rapier" | "none" = "none",
    view: SceneView | null = null,
  ) {
    duringStep = null;
    const rt = createSceneRuntime({ rapier, view, game: sensing });
    const report = rt.load({
      name: "toggles",
      bounds: [-1000, -1000, 1000, 1000],
      settings: { gravity: [0, 0], physics, grid: null, view: { projection: "orthogonal" } },
      entities,
    });
    if (!report.ok) throw new Error(report.error);
    if (physics === "none") expect(rt.stats().backend).toBe("geometry");
    const steps = (n: number) => {
      const events: (string | number | undefined)[][] = [];
      for (let i = 0; i < n; i++) {
        for (const e of rt.step(DT, []).events) {
          if (e.type.startsWith("sensor:")) events.push([e.type, e.entityId, e.other, e.tick]);
        }
      }
      return events;
    };
    const hits = (shape: ShapeObj) =>
      rt.ctx.space.overlaps(shape, { sensors: true }).map((h) => h.tag.entityId);
    return { rt, steps, hits };
  }

  const zone: RuntimeEntity = { id: "zone", type: "sensor", shape: box(0, 0, 40, 40) };
  const block: RuntimeEntity = { id: "block", type: "solid", shape: box(0, 0, 10, 10) };
  const crate: RuntimeEntity = {
    id: "block",
    type: "prop",
    shape: box(0, 0, 10, 10),
    density: 1,
    restitution: 0,
  };
  const untick = (events: (string | number | undefined)[][]) => events.map((e) => e.slice(0, 3));

  it("a disabled sensor raises nothing, and raises one enter when enabled again", () => {
    const { rt, steps } = load([zone, block]);
    expect(untick(steps(1))).toEqual([["sensor:enter", "zone", "block"]]);

    rt.ctx.setEnabled("zone", false);
    rt.ctx.system("solid")!.despawn("block");
    expect(steps(5)).toEqual([]);
    rt.ctx.system("solid")!.spawn(block);
    expect(steps(5)).toEqual([]);

    rt.ctx.setEnabled("zone", true);
    expect(untick(steps(10))).toEqual([["sensor:enter", "zone", "block"]]);
    rt.destroy();
  });

  it("a disabled sensor forgets what was inside without raising an exit", () => {
    const { rt, steps } = load([zone, block]);
    steps(1);
    rt.ctx.setEnabled("zone", false);
    rt.ctx.system("solid")!.despawn("block");
    rt.ctx.setEnabled("zone", true);
    expect(steps(5)).toEqual([]);
    rt.destroy();
  });

  it("enabled during a step, a sensor raises its enters at that step's afterStep, as on Rapier", () => {
    const enterTick = (physics: "rapier" | "none") => {
      const { rt, steps } = load([zone, physics === "rapier" ? crate : block], physics);
      steps(1);
      rt.ctx.setEnabled("zone", false);
      steps(3);
      const at = rt.ctx.tick;
      duringStep = (ctx) => {
        if (ctx.tick === at) ctx.setEnabled("zone", true);
      };
      const events = steps(3);
      rt.destroy();
      expect(untick(events)).toEqual([["sensor:enter", "zone", "block"]]);
      return (events[0]![3] as number) - at;
    };
    expect(enterTick("none")).toBe(enterTick("rapier"));
  });

  it("a disabled sensor leaves the world, and other sensors stop seeing a disabled solid", () => {
    const other: RuntimeEntity = { id: "other", type: "sensor", shape: box(200, 0, 40, 40) };
    const wall: RuntimeEntity = { id: "wall", type: "solid", shape: box(200, 0, 10, 10) };
    const { rt, steps, hits } = load([other, wall]);
    expect(untick(steps(1))).toEqual([["sensor:enter", "other", "wall"]]);
    rt.ctx.setEnabled("wall", false);
    expect(hits(box(200, 0, 5, 5))).toEqual(["other"]);
    expect(untick(steps(1))).toEqual([["sensor:exit", "other", "wall"]]);
    rt.ctx.setEnabled("other", false);
    expect(hits(box(200, 0, 5, 5))).toEqual([]);
    rt.destroy();
  });

  it("a disabled solid leaves queries and comes back on enable", () => {
    const { rt, hits } = load([block]);
    rt.ctx.setEnabled("block", false);
    expect(hits(box(0, 0, 5, 5))).toEqual([]);
    rt.ctx.setEnabled("block", true);
    expect(hits(box(0, 0, 5, 5))).toEqual(["block"]);
    rt.destroy();
  });

  it("removes a solid's and a sensor's visual on disable and redraws it on enable", () => {
    const log: string[] = [];
    const view: SceneView = {
      draw: (id) => void log.push(`draw ${id}`),
      pose: () => {},
      remove: (id) => void log.push(`remove ${id}`),
      layer: () => ({ visible: true, setVisible: () => {} }) as never,
    };
    const { rt } = load([zone, block], "none", view);
    for (const id of ["zone", "block"]) {
      log.length = 0;
      rt.ctx.setEnabled(id, false);
      expect(log).toEqual([`remove ${id}`]);
      log.length = 0;
      rt.ctx.setEnabled(id, true);
      expect(log).toEqual([`draw ${id}`]);
    }
    rt.destroy();
  });

  it("the one-way gate never re-enables a disabled solid, and enable restores its state", () => {
    const ledge: RuntimeEntity = {
      id: "ledge",
      type: "solid",
      shape: box(0, 0, 50, 5),
      oneWay: true,
    };
    const { rt, hits } = load([ledge]);
    const solids = rt.ctx.system("solid") as SolidSystem;
    rt.ctx.setEnabled("ledge", false);
    solids.gateOneWay(-20, false);
    expect(hits(ledge.shape as ShapeObj)).toEqual([]);
    solids.gateOneWay(20, false);
    rt.ctx.setEnabled("ledge", true);
    expect(solids.isHidden("ledge")).toBe(true);
    expect(hits(ledge.shape as ShapeObj)).toEqual([]);
    solids.gateOneWay(-20, false);
    expect(hits(ledge.shape as ShapeObj)).toEqual(["ledge"]);

    rt.ctx.setEnabled("ledge", false);
    solids.reset!();
    expect(hits(ledge.shape as ShapeObj)).toEqual([]);
    rt.ctx.setEnabled("ledge", true);
    expect(hits(ledge.shape as ShapeObj)).toEqual(["ledge"]);
    rt.destroy();
  });
});
