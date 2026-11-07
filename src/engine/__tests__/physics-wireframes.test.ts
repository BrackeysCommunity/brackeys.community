import { beforeAll, describe, expect, it } from "vite-plus/test";

import { colliderShape, colliderTint } from "../debug/physics-wireframes";
import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { shapeField, tagsField } from "../game/fields";
import { createPhysicsWorld, posedBodyDesc, shapeColliderDesc } from "../physics";
import type { Pt, ShapeObj } from "../scene/types";
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
