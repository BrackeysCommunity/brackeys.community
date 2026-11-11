import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { primitiveFields } from "../../game/primitives";
import type { SceneSystem, SystemFactory } from "../../game/types";
import { createNavSystem } from "../../systems/nav";
import { isNavType, markNavSystem } from "../nav-type";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../types";
import { validateScene } from "../validate";

const inert = (): SceneSystem => ({ spawn() {}, despawn() {}, clear() {}, size: () => 0 });

/** A walk-area type whose own system is the engine's nav system, with no base. */
const lane = defineEntityType({
  type: "lane",
  description: "A walk area named by its system.",
  fields: (env) => primitiveFields("nav", env),
  system: createNavSystem,
});
const registry = createRegistry(
  defineGame({
    id: "lanes",
    types: [lane],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

describe("isNavType", () => {
  it("judges a type the nav system spawns as nav from the type alone", () => {
    expect(isNavType(registry.types.get("lane"))).toBe(true);
    expect(isNavType(registry.types.get("nav"))).toBe(true);
    expect(isNavType(registry.types.get("solid"))).toBe(false);
  });

  it("reads the mark, not the factory's identity, so only a marked factory is nav", () => {
    const own = (system: SystemFactory) => ({ ...registry.types.get("lane")!, system });
    expect(isNavType(own(inert))).toBe(false);
    expect(isNavType(own(markNavSystem(() => inert())))).toBe(true);
  });
});

describe("validateScene on a type whose own system is the nav system", () => {
  it("checks its polygons as walk areas", () => {
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "lanes",
      name: "lanes",
      bounds: [0, 0, 20, 12],
      entities: [{ id: "bowtie", type: "lane", shape: ["poly", 1, 1, 3, 3, 3, 1, 1, 3] }],
    };
    const issues = validateScene(def, registry).filter((i) => i.code === "nav-invalid");
    expect(issues.flatMap((i) => i.entityIds ?? [])).toEqual(["bowtie"]);
  });
});
