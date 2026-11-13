// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { shapeField } from "../../game/fields";
import type { EntityDef, SceneDefinition } from "../types";
import { validateScene } from "../validate";

const box = ["box", 0, 0, 0.2, 0.2];

const scene = (entities: EntityDef[]): SceneDefinition => ({
  v: 4,
  name: "t",
  game: "bodies",
  bounds: [0, 0, 20, 20],
  entities,
});

const link: EntityDef = {
  id: "link",
  type: "marker",
  at: [1, 1],
  behaviors: { collider: { shape: box }, body: {}, joint: { kind: "revolute", to: "post" } },
};

const shape = { shape: shapeField("Its shape.") };
const noSystem = () => ({ spawn() {}, despawn() {}, clear() {}, size: () => 0 });

const registry = createRegistry(
  defineGame({
    id: "bodies",
    types: [
      defineEntityType({
        type: "winch",
        description: "A body its own system makes.",
        fields: shape,
        system: noSystem,
        ownsBody: true,
      }),
      defineEntityType({
        type: "glow",
        description: "A picture its own system draws, with no body.",
        fields: shape,
        system: noSystem,
      }),
      defineEntityType({
        type: "winch-prop",
        description: "A prop its own system draws, with no body.",
        base: "prop",
        fields: { ...shape, density: z.number(), restitution: z.number() },
        system: noSystem,
      }),
      defineEntityType({
        type: "crate",
        description: "A prop of the game's.",
        base: "prop",
        fields: {
          ...shape,
          density: z.number(),
          restitution: z.number(),
        },
      }),
    ],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

const refTypes = (target: EntityDef) =>
  validateScene(scene([target, link]), registry).filter((i) => i.code === "joint-ref-type");

describe("joint-ref-type from the registry", () => {
  it("accepts a game type that declares ownsBody, and one based on a primitive that does", () => {
    expect(registry.types.get("crate")?.ownsBody).toBe(true);
    for (const target of [
      { id: "post", type: "winch", shape: ["box", 5, 5, 0.2, 0.2] },
      { id: "post", type: "crate", shape: ["box", 5, 5, 0.2, 0.2], density: 1, restitution: 0 },
    ] satisfies EntityDef[])
      expect(refTypes(target), target.type).toEqual([]);
  });

  it("refuses a game type that declares no body", () => {
    const [hit] = refTypes({ id: "post", type: "glow", shape: ["box", 5, 5, 0.2, 0.2] });
    expect(hit?.entityIds).toEqual(["link", "post"]);
  });

  it("refuses a type based on a body-owning primitive that brings its own system", () => {
    expect(registry.types.get("winch-prop")?.ownsBody).toBeUndefined();
    const [hit] = refTypes({
      id: "post",
      type: "winch-prop",
      shape: ["box", 5, 5, 0.2, 0.2],
      density: 1,
      restitution: 0,
    });
    expect(hit?.entityIds).toEqual(["link", "post"]);
  });

  it("refuses a body whose collider is a sensor, as the load does", () => {
    const [hit] = refTypes({
      id: "post",
      type: "marker",
      at: [5, 5],
      behaviors: { collider: { shape: box, sensor: true }, body: { kind: "kinematic" } },
    });
    expect(hit?.entityIds).toEqual(["link", "post"]);
  });

  it("marks the engine's body-owning primitives, and not the sensor", () => {
    const owns = [...registry.primitives.types.values()]
      .filter((t) => t.ownsBody)
      .map((t) => t.type)
      .sort();
    expect(owns).toEqual(["follower", "prop", "solid"]);
  });
});
