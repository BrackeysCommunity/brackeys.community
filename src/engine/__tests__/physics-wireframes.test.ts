import type { Graphics } from "pixi.js";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createColliderTags } from "../collider-tags";
import {
  colliderShape,
  colliderTint,
  createPhysicsWireframes,
  geometryWireframes,
} from "../debug/physics-wireframes";
import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { shapeField, tagsField } from "../game/fields";
import { createPhysicsWorld, posedBodyDesc, shapeColliderDesc } from "../physics";
import { createGeometryWorld } from "../runtime/geometry-world";
import { createSceneRuntime } from "../runtime/runtime";
import { expandScene } from "../scene/expand";
import type { Pt, SceneDefinition, ShapeObj } from "../scene/types";
import type { RapierModule } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function roundTrip(shape: ShapeObj): ShapeObj | null {
  const pw = createPhysicsWorld(rapier);
  const body = pw.addRigidBody(posedBodyDesc(rapier.RigidBodyDesc.fixed(), shape));
  const collider = pw.addCollider(shapeColliderDesc(rapier, shape), body);
  const out = colliderShape(collider, rapier.ShapeType);
  pw.destroy();
  return out;
}

function expectClose(actual: unknown, expected: unknown): void {
  if (typeof expected === "number") {
    expect(actual).toBeCloseTo(expected, 3);
  } else if (Array.isArray(expected)) {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((v, i) => expectClose((actual as unknown[])[i], v));
  } else if (expected && typeof expected === "object") {
    expect(Object.keys(actual as object).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, v] of Object.entries(expected)) {
      expectClose((actual as Record<string, unknown>)[k], v);
    }
  } else {
    expect(actual).toEqual(expected);
  }
}

describe("colliderShape", () => {
  const triangle: Pt[] = [
    [100, 50],
    [140, 50],
    [120, 90],
  ];

  it.each<[string, ShapeObj]>([
    ["a rotated box", { type: "box", cx: 30, cy: 40, hw: 20, hh: 5, rotDeg: 30 }],
    ["a circle", { type: "circle", cx: -10, cy: 15, r: 7 }],
    ["a rotated capsule", { type: "capsule", cx: 5, cy: 6, r: 3, halfLen: 12, rotDeg: -60 }],
    ["a convex polygon", { type: "poly", pts: triangle }],
    [
      "a chain",
      {
        type: "chain",
        pts: [
          [0, 0],
          [50, 20],
          [100, 0],
        ],
      },
    ],
  ])("rebuilds %s from its Rapier collider", (_, shape) => {
    const out = roundTrip(shape);
    expect(out).not.toBeNull();
    if (out?.type === "poly" && shape.type === "poly") {
      for (const p of shape.pts) {
        expect(out.pts.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 1e-3)).toBe(true);
      }
      expect(out.pts).toHaveLength(shape.pts.length);
      return;
    }
    expectClose(out, shape);
  });

  it("applies the body's pose to polygon points", () => {
    const pw = createPhysicsWorld(rapier);
    const body = pw.addRigidBody(
      rapier.RigidBodyDesc.fixed()
        .setTranslation(10, 20)
        .setRotation(Math.PI / 2),
    );
    const collider = pw.addCollider(
      shapeColliderDesc(rapier, {
        type: "chain",
        pts: [
          [0, 0],
          [5, 0],
        ],
      }),
      body,
    );
    expectClose(colliderShape(collider, rapier.ShapeType), {
      type: "chain",
      pts: [
        [10, 20],
        [10, 25],
      ],
    });
    pw.destroy();
  });
});

describe("colliderTint", () => {
  const registry = createRegistry(
    defineGame({
      id: "tinted",
      types: [
        defineEntityType({
          type: "goal",
          description: "A sensor with no look of its own.",
          base: "sensor",
          fields: { shape: shapeField("Goal shape."), tags: tagsField("Labels.") },
        }),
      ],
      actions: [],
      materials: {
        ice: { friction: 0, restitution: 0, description: "Slippery.", style: { fill: 0x88ddff } },
      },
      createRuntime: () => ({ snapshot: () => null }),
    }),
  );
  const style = (type: string) => registry.types.get(type)!.style!;

  it("tints a based type in its base primitive's look", () => {
    expect(registry.types.get("goal")!.style).toBeUndefined();
    expect(colliderTint({ entityId: "g", type: "goal" }, registry)).toBe(style("sensor").stroke);
  });

  it("keeps the type's stroke over a material's fill", () => {
    const tag = { entityId: "s", type: "solid", material: "ice" };
    expect(style("solid").stroke).not.toBe(0x88ddff);
    expect(colliderTint(tag, registry)).toBe(style("solid").stroke);
  });

  it("gives untagged and unknown colliders no tint", () => {
    expect(colliderTint(undefined, registry)).toBeUndefined();
    expect(colliderTint({ entityId: "x", type: "nope" }, registry)).toBeUndefined();
  });
});

describe("wireframes over a geometry world", () => {
  const registry = createRegistry();
  const style = (type: string) => registry.types.get(type)!.style!;

  function world() {
    const geometry = createGeometryWorld(registry);
    const tags = createColliderTags();
    const floor = geometry.add({
      shape: { type: "box", cx: 0, cy: 0, hw: 1, hh: 0.1, rotDeg: 0 },
      body: "static",
      pose: { x: 2, y: 3, rot: 0 },
    });
    const zone = geometry.add({
      shape: { type: "circle", cx: 0, cy: 0, r: 0.2 },
      body: "static",
      sensor: true,
      pose: { x: 0.5, y: 0.6, rot: 0 },
    });
    const loose = geometry.add({
      shape: {
        type: "chain",
        pts: [
          [0, 0],
          [0.4, 0],
        ],
      },
      body: "static",
    });
    tags.set(floor, { entityId: "floor", type: "solid" });
    tags.set(zone, { entityId: "zone", type: "sensor" });
    return { geometry, tags, floor, zone, loose };
  }

  it("lists every collider's world shape in handle order, tinted by its tag", () => {
    const { geometry, tags, floor, zone, loose } = world();
    expect(geometryWireframes(geometry, { tags, registry })).toEqual([
      {
        handle: floor,
        shape: expect.objectContaining({ type: "box", cx: 2, cy: 3, hw: 1, hh: 0.1 }),
        tint: style("solid").stroke,
      },
      {
        handle: zone,
        shape: expect.objectContaining({ type: "circle", cx: 0.5, cy: 0.6, r: 0.2 }),
        tint: style("sensor").stroke,
      },
      {
        handle: loose,
        shape: {
          type: "chain",
          pts: [
            [0, 0],
            [0.4, 0],
          ],
        },
        tint: undefined,
      },
    ]);
    geometry.remove(zone);
    geometry.setPose(floor, 2.1, 3);
    expect(geometryWireframes(geometry, { tags, registry }).map((w) => w.handle)).toEqual([
      floor,
      loose,
    ]);
    expect(geometryWireframes(geometry, { tags, registry })[0]!.shape).toMatchObject({ cx: 2.1 });
  });

  it("draws the geometry world when the scene has no physics, and nothing without a world", () => {
    const { geometry, tags } = world();
    const wireframes = createPhysicsWireframes();
    try {
      wireframes.update({ physics: null, geometry, tags, registry });
      // Traced in world px inside a container scaled back to metres.
      expect(wireframes.container.scale.x).toBe(1 / 100);
      const box = wireframes.container.getLocalBounds();
      expect(box.minX).toBeLessThanOrEqual(0);
      expect(box.maxX).toBeGreaterThanOrEqual(300);
      expect(box.maxY).toBeGreaterThanOrEqual(310);
      wireframes.update({ physics: null, geometry: null, tags, registry });
      expect(wireframes.container.getLocalBounds().width).toBe(0);
    } finally {
      wireframes.destroy();
    }
  });

  it("draws a physics-free runtime's colliders from its context", () => {
    const def: SceneDefinition = {
      v: 4,
      name: "free",
      bounds: [0, 0, 10, 10],
      settings: { physics: "none" },
      solid: [["box", 5, 9.2, 4, 0.2]],
      entities: [{ id: "zone", type: "sensor", shape: ["box", 9, 8.3, 0.4, 0.3] }],
    };
    const runtime = createSceneRuntime({ rapier: null, view: null, registry });
    const wireframes = createPhysicsWireframes();
    try {
      expect(runtime.load(expandScene(def, registry)).ok).toBe(true);
      const { ctx } = runtime;
      expect(ctx.physics).toBeNull();
      const drawn = geometryWireframes(ctx.geometry!, ctx);
      expect(drawn.map((w) => ctx.tags.get(w.handle)?.entityId)).toEqual(["~solid:0", "zone"]);
      wireframes.update(ctx);
      const box = wireframes.container.getLocalBounds();
      // In world px: the strokes reach a couple of px past the shapes.
      expect(box.minX).toBeGreaterThan(95);
      expect(box.minX).toBeLessThanOrEqual(100);
      expect(box.maxX).toBeGreaterThanOrEqual(940);
      expect(box.maxX).toBeLessThan(945);
    } finally {
      wireframes.destroy();
      runtime.destroy();
    }
  });

  it("strokes in screen px at the camera's scale", () => {
    const { geometry, tags } = world();
    const wireframes = createPhysicsWireframes(100);
    const widths = () =>
      wireframes.container.children.flatMap((g) =>
        (g as Graphics).context.instructions
          .filter((i) => i.action === "stroke")
          .map((i) => (i.data.style as { width: number }).width),
      );
    try {
      wireframes.update({ physics: null, geometry, tags, registry });
      expect(new Set(widths())).toEqual(new Set([1.5, 2]));
      // 250 canvas px per metre: 2.5 per world px, so 1.5 screen px is 0.6 world px.
      wireframes.update({ physics: null, geometry, tags, registry }, 250);
      const scaled = [...new Set(widths().map((w) => Math.round(w * 1e9) / 1e9))].sort(
        (a, b) => a - b,
      );
      expect(scaled).toEqual([0.6, 0.8]);
    } finally {
      wireframes.destroy();
    }
  });
});
