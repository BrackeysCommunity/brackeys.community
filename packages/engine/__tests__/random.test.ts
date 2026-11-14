import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { SAVE_RANDOM_KEY, type SaveFile } from "../game/save-file";
import { createSceneRuntime } from "../runtime/runtime";
import { captureSave, restoreSave } from "../runtime/save-state";
import { defaultSeed, runRandom } from "../runtime/seed";
import type { SceneRuntimeHandle } from "../runtime/types";
import type { ExpandedScene } from "../scene/types";
import { Rng, seedFromString } from "../sim-kit/rng";
import { testGame } from "./fixtures/test-game";

const draws = (rng: Rng, n = 16): number[] => Array.from({ length: n }, () => rng.nextU32());

const SEED_1 = [
  1130556604, 2591592147, 3014952990, 960850752, 2734082507, 3058966613, 1454546984, 2701238177,
  101258157, 3489084290, 1036351801, 4074087287, 1422419863, 176041636, 621062013, 2643171014,
];
const SEED_A = [
  871293208, 3838592715, 3644033032, 2757228547, 2752235078, 1461981494, 3837497992, 1475245297,
  992208414, 2249393891, 3009908223, 3267247518, 2143359802, 3121009557, 100960399, 2348587525,
];
/** The gameless default for a scene named `kitchen-sink`. */
const DEFAULT_KITCHEN_SINK = [
  123346488, 3401069947, 422972460, 1218913000, 615416182, 1172195873, 1281196985, 772599591,
  876266068, 2920767661, 149899948, 2317392761, 357659599, 1503124386, 2435268123, 3049247061,
];

function scene(name: string): ExpandedScene {
  return {
    name,
    bounds: [-100, -100, 100, 100],
    settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
    entities: [],
  };
}

describe("defaultSeed", () => {
  it("hashes `<gameId or engine>:<sceneName>`", () => {
    expect(defaultSeed(null, "kitchen-sink")).toBe(seedFromString("engine:kitchen-sink"));
    expect(defaultSeed(null, "kitchen-sink")).toBe(3050819053);
    expect(defaultSeed("test-game", "yard")).toBe(seedFromString("test-game:yard"));
  });

  it("is stable across calls and differs per scene name and game", () => {
    expect(defaultSeed(null, "a")).toBe(defaultSeed(null, "a"));
    expect(defaultSeed(null, "a")).not.toBe(defaultSeed(null, "b"));
    expect(defaultSeed(null, "a")).not.toBe(defaultSeed("test-game", "a"));
  });
});

describe("runRandom", () => {
  const engine = createRegistry();
  const game = createRegistry(testGame);

  it("pins the first 16 draws for seed 1, seed 'a' and the default", () => {
    expect(draws(runRandom(engine, "x", 1))).toEqual(SEED_1);
    expect(draws(runRandom(engine, "x", "a"))).toEqual(SEED_A);
    expect(draws(runRandom(engine, "kitchen-sink"))).toEqual(DEFAULT_KITCHEN_SINK);
  });

  it("seeds from the game's id when there is a game, the engine's otherwise", () => {
    expect(draws(runRandom(game, "yard"))).toEqual(
      draws(Rng.from(defaultSeed("test-game", "yard"))),
    );
    expect(draws(runRandom(engine, "yard"))).toEqual(draws(Rng.from(defaultSeed(null, "yard"))));
    expect(draws(runRandom(game, "yard"))).not.toEqual(draws(runRandom(engine, "yard")));
  });

  it("an explicit seed overrides the default, whatever the scene", () => {
    expect(draws(runRandom(game, "one", 7))).toEqual(draws(runRandom(engine, "two", 7)));
    expect(draws(runRandom(engine, "x", 0))).toEqual(draws(Rng.from(0)));
  });

  it("gives fork streams independent of each other and of the parent's later draws", () => {
    const parent = runRandom(engine, "x", 1);
    const left = parent.fork("left");
    const right = parent.fork("right");
    const leftDraws = draws(left);
    expect(leftDraws).not.toEqual(draws(right));

    const twin = runRandom(engine, "x", 1);
    const twinLeft = twin.fork("left");
    // The parent drawing more, or another fork drawing, moves nothing in `left`.
    draws(twin, 50);
    twin.fork("right").nextU32();
    expect(draws(twinLeft)).toEqual(leftDraws);

    // Forking doesn't advance the parent.
    expect(draws(parent)).toEqual(SEED_1);
  });
});

describe("ctx.random", () => {
  it("is one sequence per seed, reset at each load", () => {
    const rt = createSceneRuntime({ rapier: null, view: null });
    expect(rt.load(scene("yard"), { seed: 1 })).toMatchObject({ ok: true });
    const first = draws(rt.ctx.random);
    expect(first).toEqual(SEED_1);
    expect(rt.load(scene("yard"), { seed: 1 })).toMatchObject({ ok: true });
    expect(draws(rt.ctx.random)).toEqual(first);
    expect(rt.load(scene("yard"), { seed: "a" })).toMatchObject({ ok: true });
    expect(draws(rt.ctx.random)).toEqual(SEED_A);
    rt.destroy();
  });

  it("defaults to the scene's seed when the run names none", () => {
    const rt = createSceneRuntime({ rapier: null, view: null });
    expect(rt.load(scene("kitchen-sink"))).toMatchObject({ ok: true });
    expect(draws(rt.ctx.random)).toEqual(DEFAULT_KITCHEN_SINK);
    expect(rt.load(scene("other"))).toMatchObject({ ok: true });
    expect(draws(rt.ctx.random)).toEqual(draws(Rng.from(defaultSeed(null, "other"))));
    rt.destroy();

    const withGame = createSceneRuntime({ rapier: null, view: null, game: testGame });
    expect(withGame.load(scene("yard"))).toMatchObject({ ok: true });
    expect(draws(withGame.ctx.random)).toEqual(draws(Rng.from(defaultSeed("test-game", "yard"))));
    withGame.destroy();
  });
});

describe("ctx.random's forks in a world save", () => {
  const save = (rt: SceneRuntimeHandle) => {
    const captured = captureSave(rt, { depth: "world", slot: "forks", now: 0 });
    if (!captured.ok) throw new Error(captured.issue.message);
    return captured.file;
  };
  const restored = (file: SaveFile) => {
    const rt = createSceneRuntime({ rapier: null, view: null });
    expect(rt.load(scene("yard"), { seed: 1 })).toMatchObject({ ok: true });
    expect(restoreSave(rt, file)).toMatchObject({ ok: true });
    return rt;
  };

  it("keeps a restored fork's place through save, restore, save, restore before it is forked again", () => {
    const rt = createSceneRuntime({ rapier: null, view: null });
    expect(rt.load(scene("yard"), { seed: 1 })).toMatchObject({ ok: true });
    const sparks = rt.ctx.random.fork("sparks");
    draws(sparks, 3);
    const first = save(rt);
    const ahead = draws(sparks, 4);
    rt.destroy();

    // Restored, and saved again before anything forks "sparks" there.
    const middle = restored(first);
    const second = save(middle);
    middle.destroy();
    expect(second.world?.systems[SAVE_RANDOM_KEY]).toStrictEqual(
      first.world?.systems[SAVE_RANDOM_KEY],
    );

    const last = restored(second);
    expect(draws(last.ctx.random.fork("sparks"), 4)).toEqual(ahead);
    last.destroy();
  });
});
