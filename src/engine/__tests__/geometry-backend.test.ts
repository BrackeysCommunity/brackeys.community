import { beforeAll, describe, expect, it } from "vite-plus/test";

import { defineGame } from "../game/define";
import { createSceneRuntime } from "../runtime/runtime";
import type { StepEvent } from "../runtime/types";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";

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
          ? { ...e, shape: { type: "box", cx: 1700, cy: 750.5, hw: 40, hh: 30, rotDeg: 0 } }
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
