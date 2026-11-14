import { describe, expect, it } from "vite-plus/test";

import { PRIMITIVE_SYSTEMS } from "../../runtime/primitives";
import { createSceneRuntime } from "../../runtime/runtime";
import { POSED_PRIMITIVES } from "../behaviors/tween";
import type { SceneSystem } from "../types";

describe("POSED_PRIMITIVES", () => {
  it("lists exactly the primitives whose systems have setPose", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game: null });
    const report = rt.load({
      name: "primitives",
      bounds: [0, 0, 10, 10],
      settings: {
        gravity: [0, 0],
        physics: "none",
        grid: null,
        view: { projection: "orthogonal" },
      },
      entities: [],
    });
    if (!report.ok) throw new Error(report.error);
    const posed = Object.keys(PRIMITIVE_SYSTEMS).filter((type) => {
      const system = rt.ctx.system<SceneSystem>(type);
      expect(system, type).toBeDefined();
      return typeof system?.setPose === "function";
    });
    expect([...posed].sort()).toEqual([...POSED_PRIMITIVES].sort());
    expect([...POSED_PRIMITIVES].sort()).toEqual(
      ["decor", "marker", "node", "prop", "sensor", "solid"].sort(),
    );
    const unposed = Object.keys(PRIMITIVE_SYSTEMS).filter((type) => !posed.includes(type));
    expect(unposed.sort()).toEqual(["camera-region", "follower", "nav"]);
  });
});
