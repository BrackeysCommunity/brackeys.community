// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { materialField, shapeField, tagsField } from "../game/fields";
import { PRIMITIVES } from "../game/primitives";
import { createSceneRuntime } from "../runtime/runtime";
import { styleOf, type SolidSystem } from "../systems/bodies";
import type { RapierModule } from "../types";
import { engineYard } from "./fixtures/engine-yard.expanded";
import { recordingView } from "./fixtures/recording-view";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

function loaded() {
  const rec = recordingView();
  const rt = createSceneRuntime({ rapier, view: rec.view, game: testGame });
  const report = rt.load(engineYard());
  expect(report.ok).toBe(true);
  return { rt, ...rec };
}

describe("systems draw through the scene view", () => {
  it("draws every solid, sensor, prop and follower on spawn, and no marker or note", () => {
    const { live } = loaded();
    expect([...live.keys()].sort()).toEqual(
      ["~solid:0", "~solid:1", "~solid:2", "ledge", "zone", "avatar", "crate", "lift"].sort(),
    );
  });

  it("draws static geometry in place, in its type's style, on the terrain layer", () => {
    const { live } = loaded();
    expect(live.get("~solid:0")).toEqual({
      shape: { type: "box", cx: 1000, cy: 980, hw: 1000, hh: 20, rotDeg: 0 },
      style: PRIMITIVES.solid.style,
      layer: "terrain",
      pose: { x: 0, y: 0, rot: 0 },
    });
    expect(live.get("zone")?.style).toEqual(PRIMITIVES.sensor.style);
  });

  it("draws a prop in its body's frame and poses it there", () => {
    const { live } = loaded();
    expect(live.get("crate")).toMatchObject({
      shape: { type: "circle", cx: 0, cy: 0, r: 20 },
      layer: "body",
      pose: { x: 1200, y: 940, rot: 0 },
    });
  });

  it("poses a follower at its path start, then once per tick as it moves", () => {
    const { rt, live, callsFor } = loaded();
    expect(live.get("lift")?.pose).toEqual({ x: 1700, y: 900, rot: 0 });
    const before = callsFor("lift", "pose").length;

    for (let i = 0; i < 60; i++) rt.step(DT, []);

    expect(callsFor("lift", "pose")).toHaveLength(before + 60);
    expect(callsFor("lift", "draw")).toHaveLength(1);
    const lift = live.get("lift")!;
    expect(lift.pose.x).toBe(1700);
    expect(lift.pose.y).toBeLessThan(900);
  });

  it("removes a visual on despawn, and every visual on unload", () => {
    const { rt, live, callsFor } = loaded();
    rt.ctx.system("solid")!.despawn("ledge");
    expect(callsFor("ledge", "remove")).toHaveLength(1);
    expect(live.has("ledge")).toBe(false);

    rt.unload();
    expect(live.size).toBe(0);
  });

  it("keeps a hidden one-way solid drawn where it is", () => {
    const { rt, live, callsFor } = loaded();
    const solids = rt.ctx.system<SolidSystem>("solid")!;
    solids.gateOneWay(2000, false);
    expect(solids.isHidden("ledge")).toBe(true);
    expect(callsFor("ledge", "pose")).toEqual([]);
    expect(live.get("ledge")?.shape).toMatchObject({ cx: 1400, cy: 800 });
  });

  it("leaves the simulation as a headless run plays it", () => {
    const rec = loaded();
    const headless = createSceneRuntime({ rapier, view: null, game: testGame });
    headless.load(engineYard());
    for (let i = 0; i < 30; i++) {
      rec.rt.step(DT, []);
      headless.step(DT, []);
    }
    expect(rec.rt.snapshot()).toEqual(headless.snapshot());
  });
});

describe("styleOf", () => {
  const lava = defineEntityType({
    type: "lava",
    description: "Hot.",
    base: "sensor",
    fields: { shape: shapeField("Lava shape."), tags: tagsField("Labels.") },
  });
  const slab = defineEntityType({
    type: "slab",
    description: "A styled slab.",
    base: "solid",
    fields: (env) => ({ shape: shapeField("Slab shape."), material: materialField(env) }),
    style: { fill: 0x111111, stroke: 0x222222, alpha: 0.5 },
  });
  const registry = createRegistry(
    defineGame({
      id: "styled",
      types: [lava, slab],
      actions: [],
      materials: {
        ice: { friction: 0, restitution: 0, description: "Slippery.", style: { fill: 0x88ddff } },
      },
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const ctx = { registry };
  const type = (name: string) => registry.types.get(name)!;

  it("falls back to the base primitive's style", () => {
    expect(styleOf(ctx, type("lava"), undefined)).toEqual(PRIMITIVES.sensor.style);
  });

  it("lets the material's style win field by field", () => {
    expect(styleOf(ctx, type("slab"), "ice")).toEqual({
      fill: 0x88ddff,
      stroke: 0x222222,
      alpha: 0.5,
    });
  });

  it("is undefined for a type with no look", () => {
    expect(styleOf(ctx, type("note"), undefined)).toBeUndefined();
  });
});
