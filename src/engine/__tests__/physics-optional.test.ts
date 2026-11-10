import { describe, expect, it, vi } from "vite-plus/test";

import { createRegistry, defineGame } from "../game/define";
import { createHeadlessRuntime, runProbe } from "../headless/headless";
import { runPlaytest } from "../headless/playtest";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";

const init = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@dimforge/rapier2d-compat", () => ({ init, default: { init } }));

type Snapshot = { ticks: number };

/** A game whose scenes run without physics: markers and sensors only. */
const board = defineGame<Snapshot>({
  id: "board",
  types: [],
  actions: [{ action: "go", keys: ["space"], description: "Go." }],
  world: { physics: "none" },
  createRuntime: () => {
    let ticks = 0;
    return {
      afterStep: () => void ticks++,
      snapshot: () => ({ ticks }),
    };
  },
});

const registry = createRegistry(board);

const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "board",
  game: "board",
  bounds: [0, 0, 400, 400],
  entities: [
    { id: "start", type: "marker", at: [20, 20], tags: ["spawn"] },
    { id: "goal", type: "sensor", shape: ["box", 300, 300, 20, 20] },
  ],
};

describe("a game without physics", () => {
  it("runs a headless runtime and a probe with no Rapier, never initialising it", () => {
    const rt = createHeadlessRuntime({ registry, scene: expandScene(scene, registry) });
    expect(rt.ctx.physics).toBeNull();
    for (let i = 0; i < 10; i++) rt.step(rt.ctx.time.tickMs, []);
    expect(rt.snapshot()).toEqual({ ticks: 10 });
    expect(rt.stats()).toMatchObject({ backend: "geometry", entities: 2 });
    rt.destroy();

    const probe = runProbe({
      registry,
      scene: expandScene(scene, registry),
      ticks: 5,
      hold: ["go"],
    });
    expect(probe.load.ok).toBe(true);
    expect(probe.final).toEqual({ ticks: 5 });
    expect(init).not.toHaveBeenCalled();
  });

  it("plays a headless playtest with no Rapier, never initialising it", () => {
    const run = runPlaytest({
      registry,
      scene,
      script: { v: 1, steps: [{ hold: ["go"], for: 12 }] },
    });
    if (run.blocked) throw new Error(`blocked at ${run.stage}: ${JSON.stringify(run)}`);
    expect(run.outcome.result).toBe("script-end");
    expect(run.final).toEqual({ ticks: run.ticks });
    expect(init).not.toHaveBeenCalled();
  });
});
