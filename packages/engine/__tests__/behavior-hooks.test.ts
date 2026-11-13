import { beforeAll, describe, expect, it } from "vite-plus/test";

import { defineBehavior, type BehaviorSystem } from "../game/behaviors";
import { defineEntityType, defineGame, ENGINE_BEHAVIORS } from "../game/define";
import { pointField } from "../game/fields";
import type { SceneSystem } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { createRunTiming } from "../runtime/timing";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import type { RapierModule } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

/** A game whose type system, two behaviors, own hooks and physics step all write to one log. */
function hooksGame() {
  const log: string[] = [];

  const probe = defineEntityType({
    type: "probe",
    description: "A point that logs its system's hooks.",
    fields: { at: pointField("Where it stands.") },
    system: (): SceneSystem => {
      const live = new Set<string>();
      return {
        spawn: (e) => void live.add(e.id),
        despawn: (id) => void live.delete(id),
        clear: () => live.clear(),
        size: () => live.size,
        beforeStep: () => void log.push("type:beforeStep"),
        beforePhysics: () => void log.push("type:beforePhysics"),
        afterStep: () => void log.push("type:afterStep"),
      };
    },
  });

  const recording = (short: string) =>
    defineBehavior({
      name: `hooks/${short}`,
      description: "Logs its tick hooks.",
      fields: {},
      system: (): BehaviorSystem => {
        const live = new Set<string>();
        return {
          attach: (id) => void live.add(id),
          detach: (id) => void live.delete(id),
          clear: () => live.clear(),
          size: () => live.size,
          beforeStep: () => void log.push(`${short}:beforeStep`),
          beforePhysics: () => void log.push(`${short}:beforePhysics`),
          step: () => void log.push(`${short}:step`),
        };
      },
    });

  const game = defineGame({
    id: "hooks",
    types: [probe],
    actions: [],
    behaviors: [recording("a"), recording("b")],
    createRuntime(ctx) {
      return {
        onLoad() {
          const physics = ctx.physics;
          if (!physics) return;
          const step = physics.step.bind(physics);
          physics.step = () => {
            log.push("physics.step");
            step();
          };
        },
        beforeStep: () => void log.push("game:beforeStep"),
        afterStep: () => void log.push("game:afterStep"),
        snapshot: () => null,
      };
    },
  });
  return { game, log };
}

function scene(physics: "rapier" | "none", entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "t",
    bounds: [-10, -10, 10, 10],
    settings: { gravity: [0, 0], physics, grid: null, view: { projection: "orthogonal" } },
    entities,
  };
}

const probeAt = (id: string): RuntimeEntity => ({
  id,
  type: "probe",
  at: [1, 2],
  behaviors: { "hooks/a": {}, "hooks/b": {} },
});

describe("behavior tick hooks", () => {
  it("run in the tick order on Rapier: before physics, after the game's beforeStep", () => {
    const { game, log } = hooksGame();
    const rt = createSceneRuntime({ rapier, view: null, game });
    expect(rt.load(scene("rapier", [probeAt("p")])).ok).toBe(true);
    log.length = 0;
    rt.step(DT, []);
    expect(log).toEqual([
      "type:beforeStep",
      "game:beforeStep",
      "a:beforeStep",
      "b:beforeStep",
      "type:beforePhysics",
      "a:beforePhysics",
      "b:beforePhysics",
      "physics.step",
      "type:afterStep",
      "a:step",
      "b:step",
      "game:afterStep",
    ]);
    rt.destroy();
  });

  it("run beforePhysics right after beforeStep without physics", () => {
    const { game, log } = hooksGame();
    const rt = createSceneRuntime({ rapier, view: null, game });
    expect(rt.load(scene("none", [probeAt("p")])).ok).toBe(true);
    log.length = 0;
    rt.step(DT, []);
    expect(log).toEqual([
      "type:beforeStep",
      "game:beforeStep",
      "a:beforeStep",
      "b:beforeStep",
      "a:beforePhysics",
      "b:beforePhysics",
      "type:afterStep",
      "a:step",
      "b:step",
      "game:afterStep",
    ]);
    rt.destroy();
  });

  it("time each hook as its own part", () => {
    const { game } = hooksGame();
    let now = 0;
    const timing = createRunTiming(() => (now += 1));
    const rt = createSceneRuntime({ rapier, view: null, game, timing });
    rt.load(scene("rapier", [probeAt("p")]));
    rt.step(DT, []);
    const parts = Object.keys(timing.report().tick.parts);
    for (const part of [
      "behavior.hooks/a.beforeStep",
      "behavior.hooks/b.beforeStep",
      "behavior.hooks/a.beforePhysics",
      "behavior.hooks/b.beforePhysics",
      "behavior.hooks/a",
    ])
      expect(parts).toContain(part);
    expect(parts.indexOf("game.beforeStep")).toBeLessThan(
      parts.indexOf("behavior.hooks/a.beforeStep"),
    );
    expect(parts.indexOf("behavior.hooks/b.beforePhysics")).toBeLessThan(
      parts.indexOf("physics.step"),
    );
    rt.destroy();
  });

  it("make a call, and a lap, only for the systems that define them", () => {
    const plain = defineBehavior({
      name: "hooks/plain",
      description: "Steps, with no tick hooks.",
      fields: {},
      system: (): BehaviorSystem => {
        const live = new Set<string>();
        return {
          attach: (id) => void live.add(id),
          detach: (id) => void live.delete(id),
          clear: () => live.clear(),
          size: () => live.size,
          step: () => {},
        };
      },
    });
    const game = defineGame({
      id: "hooks",
      types: [],
      actions: [],
      behaviors: [plain],
      createRuntime: () => ({ snapshot: () => null }),
    });
    const TICKS = 3;
    for (const physics of ["rapier", "none"] as const) {
      let now = 0;
      const timing = createRunTiming(() => (now += 1));
      const rt = createSceneRuntime({ rapier, view: null, game, timing });
      expect(rt.load(scene(physics, [])).ok).toBe(true);
      for (let i = 0; i < TICKS; i++) rt.step(DT, []);
      const parts = timing.report().tick.parts;
      const laps = Object.keys(parts).filter((p) =>
        /^behavior\..*\.(beforeStep|beforePhysics)$/.test(p),
      );
      expect(
        laps.filter((p) => p.startsWith("behavior.hooks/plain.")),
        physics,
      ).toEqual([]);
      expect(Object.keys(parts), physics).toContain("behavior.hooks/plain");
      for (const part of laps) {
        const [, name, hook] = /^behavior\.(.+)\.(beforeStep|beforePhysics)$/.exec(part)!;
        const system = rt.ctx.behavior<BehaviorSystem>(name!);
        expect(typeof system?.[hook as "beforeStep" | "beforePhysics"], part).toBe("function");
        expect(parts[part]!.calls, part).toBe(TICKS);
      }
      for (const { name } of [...ENGINE_BEHAVIORS, plain]) {
        const system = rt.ctx.behavior<BehaviorSystem>(name);
        for (const hook of ["beforeStep", "beforePhysics"] as const)
          if (system?.[hook]) expect(laps, `${name}.${hook}`).toContain(`behavior.${name}.${hook}`);
      }
      rt.destroy();
    }
  });
});
