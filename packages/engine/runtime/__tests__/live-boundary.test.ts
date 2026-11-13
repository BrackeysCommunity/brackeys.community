// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { oneSceneVersion } from "../../__tests__/fixtures/live-version";
import { createRegistry, defineGame } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { prepareRun, startRun } from "../../headless/play-loop";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { preparedVersion } from "../live";

/** Marks a boundary in `onLoad`, and in a step when sent `safe`. */
function boundaryGame(): GameDefinition {
  return defineGame({
    id: "bounds",
    types: [],
    actions: [],
    world: { physics: "none" },
    live: { timings: ["boundary"] },
    commands: { safe: { description: "Marks a safe moment.", args: z.strictObject({}) } },
    createRuntime(ctx) {
      return {
        onLoad: () => ctx.live.boundary("load"),
        beforeStep(_dt, _actions, commands) {
          if (commands.some((c) => c.name === "safe")) ctx.live.boundary("checkpoint");
        },
        snapshot: () => null,
      };
    },
  });
}

const scene = (markers: readonly string[]): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "yard",
  bounds: [0, 0, 10, 10],
  entities: markers.map((id, i) => ({ id, type: "marker", at: [1 + i, 1] })),
});

describe("ctx.live.boundary()", () => {
  it("counts only inside a step: one from onLoad or between ticks lets no boundary swap through", async () => {
    const game = boundaryGame();
    const registry = createRegistry(game);
    const prepared = prepareRun(scene(["start"]), registry);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared.blocked));
    const started = startRun({ rapier: null, game, registry, scene: prepared.scene, play: {} });
    if (!started.ok) throw new Error(JSON.stringify(started.load));
    const { runtime, live } = started;
    const step = (commands: { name: string; args: object }[] = []) => {
      runtime.step(runtime.ctx.time.tickMs, [], commands);
      live.afterTick({ paused: false, changing: false });
    };
    try {
      const v = await oneSceneVersion(scene(["start", "well"]), game);
      const read = preparedVersion(v, registry, game);
      if (!read.ok) throw new Error(JSON.stringify(read.issues));
      live.stage(read.prepared);
      expect(live.activate("yard", v.id, "boundary")).toMatchObject({ timing: "boundary" });

      step();
      expect(runtime.get("well")).toBeUndefined();
      runtime.ctx.live.boundary("between ticks");
      step();
      expect(runtime.get("well")).toBeUndefined();
      expect(live.pending()).toEqual([{ scene: "yard", version: v.id, timing: "boundary" }]);

      step([{ name: "safe", args: {} }]);
      expect(runtime.get("well")).toBeDefined();
      expect(runtime.ctx.live.version).toBe(v.id);
      expect(live.pending()).toEqual([]);
    } finally {
      runtime.destroy();
    }
  });
});
