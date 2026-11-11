import { beforeAll, describe, expect, it } from "vite-plus/test";

import { defineEntityType, defineGame } from "../game/define";
import { primitiveFields } from "../game/primitives";
import { createSceneRuntime } from "../runtime/runtime";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import { createSolidSystem, type SolidSystem } from "../systems/bodies";
import type { RapierModule } from "../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

const scene = (entities: RuntimeEntity[]): ExpandedScene => ({
  name: "t",
  bounds: [-100, -100, 100, 100],
  settings: { gravity: [0, 10], physics: "rapier", grid: null, view: { projection: "orthogonal" } },
  entities,
});

const slab = defineEntityType({
  type: "slab",
  description: "A solid every entity of which is one-way from above.",
  base: "solid",
  fields: (env) => primitiveFields("solid", env),
  oneWay: true,
});

const ledge = defineEntityType({
  type: "ledge",
  description: "A solid one-way on its left face.",
  base: "solid",
  fields: (env) => primitiveFields("solid", env),
  oneWay: "left",
});

const vent = defineEntityType({
  type: "vent",
  description: "A one-way solid whose system names its own side.",
  base: "solid",
  fields: (env) => primitiveFields("solid", env),
  system: (ctx, type) => createSolidSystem(ctx, type, { oneWay: "right" }),
  oneWay: true,
});

const game = defineGame({
  id: "one-way-types",
  types: [slab, ledge, vent],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

function load(entities: RuntimeEntity[]) {
  const rt = createSceneRuntime({ rapier, view: null, game });
  rt.load(scene(entities));
  const tagOf = (id: string) => rt.ctx.tags.get(rt.ctx.tags.handlesOf(id)[0]!);
  return { rt, tagOf };
}

describe("one-way type metadata in physics", () => {
  it("a solid type declaring oneWay is one-way in its solid system", () => {
    const { rt, tagOf } = load([
      { id: "s", type: "slab", shape: box(0, 1, 0.5, 0.06) },
      { id: "floor", type: "solid", shape: box(0, 20, 50, 1) },
    ]);
    const slabs = rt.ctx.system<SolidSystem>("slab")!;
    expect(tagOf("s")).toMatchObject({ oneWay: true, oneWaySide: "up" });
    expect(tagOf("floor")?.oneWay).toBeUndefined();

    // The slab's top is at 0.94 m: feet within 0.04 m of it stand on it, deeper ones pass.
    slabs.gateOneWay(0.97, false);
    expect(slabs.isHidden("s")).toBe(false);
    slabs.gateOneWay(1.2, false);
    expect(slabs.isHidden("s")).toBe(true);
    slabs.gateOneWay(0.5, false);
    expect(slabs.isHidden("s")).toBe(false);
    rt.destroy();
  });

  it("a type-wide side gates by that face", () => {
    const { rt, tagOf } = load([{ id: "l", type: "ledge", shape: box(0, 0, 1, 1) }]);
    const ledges = rt.ctx.system<SolidSystem>("ledge")!;
    expect(tagOf("l")).toMatchObject({ oneWay: true, oneWaySide: "left" });

    ledges.gateOneWaySides({ minX: -3, maxX: -1, minY: -1, maxY: 1 }, false);
    expect(ledges.isHidden("l")).toBe(false);
    ledges.gateOneWaySides({ minX: 1, maxX: 3, minY: -1, maxY: 1 }, false);
    expect(ledges.isHidden("l")).toBe(true);
    rt.destroy();
  });

  it("an entity's own side wins over the type's", () => {
    const { rt, tagOf } = load([
      { id: "down", type: "slab", shape: box(0, 0, 1, 1), oneWay: "down" },
      { id: "kept", type: "ledge", shape: box(5, 0, 1, 1), oneWay: true },
      { id: "off", type: "ledge", shape: box(10, 0, 1, 1), oneWay: false },
    ]);
    expect(tagOf("down")).toMatchObject({ oneWay: true, oneWaySide: "down" });
    expect(tagOf("kept")).toMatchObject({ oneWay: true, oneWaySide: "left" });
    expect(tagOf("off")).toMatchObject({ oneWay: true, oneWaySide: "left" });

    const slabs = rt.ctx.system<SolidSystem>("slab")!;
    slabs.gateOneWaySides({ minX: -1, maxX: 1, minY: 1, maxY: 3 }, false);
    expect(slabs.isHidden("down")).toBe(false);
    slabs.gateOneWaySides({ minX: -1, maxX: 1, minY: -3, maxY: -1 }, false);
    expect(slabs.isHidden("down")).toBe(true);
    rt.destroy();
  });

  it("a system's own option wins over the type's metadata", () => {
    const { rt, tagOf } = load([
      { id: "v", type: "vent", shape: box(0, 0, 1, 1) },
      { id: "up", type: "vent", shape: box(5, 0, 1, 1), oneWay: "up" },
    ]);
    expect(tagOf("v")).toMatchObject({ oneWay: true, oneWaySide: "right" });
    expect(tagOf("up")).toMatchObject({ oneWay: true, oneWaySide: "up" });
    rt.destroy();
  });
});
