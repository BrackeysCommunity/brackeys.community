import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { shapeField } from "../game/fields";
import type { EngineContext, GameDefinition } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { expandScene } from "../scene/expand";
import type { SceneDefinition } from "../scene/types";
import { createDataSystem, type DataSystem } from "../systems/data";

const zone = defineEntityType({
  type: "zone",
  description: "An area a game's rules read.",
  fields: { shape: shapeField("The area.") },
  system: createDataSystem,
});

let seen: string[] = [];

const game: GameDefinition = defineGame({
  id: "data-zones",
  types: [zone],
  spawnOrder: ["zone"],
  world: { physics: "none" },
  actions: [],
  createRuntime: (ctx: EngineContext) => ({
    onLoad() {
      seen = (ctx.system("zone") as DataSystem).list().map((e) => e.id);
    },
    snapshot: () => null,
  }),
});

const scene: SceneDefinition = {
  v: 4,
  game: "data-zones",
  name: "data-zones",
  bounds: [0, 0, 10, 10],
  settings: { physics: "none" },
  entities: [
    { id: "b", type: "zone", shape: ["box", 2, 2, 1, 1] },
    { id: "a", type: "zone", shape: ["box", 6, 6, 1, 1] },
  ],
} as SceneDefinition;

describe("createDataSystem", () => {
  it("is a system a type with no base can name, and keeps the live entities in spawn order", () => {
    const registry = createRegistry(game);
    const rt = createSceneRuntime({ rapier: null, view: null, game });
    expect(rt.load(expandScene(scene, registry))).toMatchObject({ ok: true });
    expect(seen).toEqual(["b", "a"]);
    const system = rt.ctx.system("zone") as DataSystem;
    expect(system.size()).toBe(2);
    expect(system.get("a")?.shape).toMatchObject({ type: "box", cx: 6 });
    rt.destroy();
  });

  it("keeps a disabled entity's record, updates in place and forgets on despawn", () => {
    const system = createDataSystem();
    const e = (id: string, n: number) => ({ id, type: "zone", n });
    system.spawn(e("a", 1));
    system.spawn(e("b", 1));
    system.disable?.("a");
    expect(system.get("a")).toEqual(e("a", 1));
    system.update?.(e("a", 2), e("a", 1));
    expect(system.list()).toEqual([e("a", 2), e("b", 1)]);
    system.spawn(e("a", 3));
    expect(system.list().map((x) => x.id)).toEqual(["b", "a"]);
    system.despawn("b");
    system.despawn("missing");
    expect(system.size()).toBe(1);
    system.clear();
    expect(system.list()).toEqual([]);
  });
});
