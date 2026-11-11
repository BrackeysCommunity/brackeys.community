// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import {
  createGame,
  fadeTransition,
  mountUi,
  type GameInstance,
  type SceneSource,
  type TransitionRunner,
} from "@jams/engine";
import { cellKey, type LibraryScene, type SceneLibrary } from "@jams/engine/game";
import {
  loadHeadless,
  replayRecording,
  runPlaytest,
  type InputScriptStepV2,
  type InputScriptV2,
  type PlaytestReport,
  type RunRecording,
} from "@jams/engine/headless";
import { sceneListFlow } from "@jams/engine/project";
import {
  createRegistry,
  parsePrefab,
  parseSceneOrThrow,
  prefabLibrary,
  type Prefab,
  type SceneDefinition,
} from "@jams/engine/scene";
import { Container } from "pixi.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  initialProgress,
  TACTICS_OPENED,
  tacticsGame,
  type TacticsProgress,
  type TacticsRunSnapshot,
} from "..";
import sceneList from "../scene-list.json";
import { mountTacticsHud } from "../ui/index";
import { resultLines, unitName } from "../ui/menu";
import { tacticsHeldProject, tacticsProjectView } from "./pins";

const init = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@dimforge/rapier2d-compat", () => ({ init, default: { init } }));

// The shell's Pixi renderer, stood in for so the shell runs under jsdom.
vi.mock("../../../engine/renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

afterAll(() => {
  expect(init).not.toHaveBeenCalled();
});

const here = (path: string) => new URL(path, import.meta.url);
const json = (path: string): unknown => JSON.parse(readFileSync(here(path), "utf8"));

const registry = createRegistry(tacticsGame);
const prefabs = prefabLibrary(
  ["../scenes/prefabs/knight.json", "../scenes/prefabs/archer.json"].map((path): Prefab => {
    const parsed = parsePrefab(json(path), registry);
    if (!parsed.ok) throw new Error(`${path} doesn't parse`);
    return parsed.prefab;
  }),
);
const sceneDef = (id: string): SceneDefinition =>
  parseSceneOrThrow(json(`../scenes/${id}.json`), registry);

/** The project's scene list with every listed scene, as a host resolves them. */
function library(extra: Record<string, SceneDefinition> = {}): SceneLibrary {
  const { scenes: list } = sceneListFlow(sceneList);
  const scenes = new Map<string, LibraryScene>(
    list.map(({ scene }) => [scene, { def: sceneDef(scene), prefabs }]),
  );
  for (const [id, def] of Object.entries(extra)) scenes.set(id, { def, prefabs });
  return {
    list: [...list, ...Object.keys(extra).map((scene) => ({ scene }))],
    scenes,
  };
}

const level1Script = json("../scenes/level-1.script.json") as InputScriptV2;
const golden = json("./fixtures/level-1.recording.json") as RunRecording;

async function playFrom(
  scene: string,
  steps: InputScriptStepV2[],
  flow: SceneLibrary | null = library(),
): Promise<PlaytestReport<TacticsRunSnapshot>> {
  const loaded = await loadHeadless({
    files: { scene: json(`../scenes/${scene}.json`), prefabs: [...prefabs.values()] },
    registry,
    project: tacticsProjectView(),
  });
  const run = runPlaytest<TacticsRunSnapshot>({
    ...loaded,
    rapier: null,
    game: tacticsGame,
    script: { v: 2, seed: 1, maxTicks: 8000, steps },
    ...(flow ? { flow } : {}),
  });
  if (run.blocked) throw new Error(`playtest blocked: ${JSON.stringify(run)}`);
  return run;
}

/** Menu → level 1 (won on level-1.script.json) → result → menu → level 2, on one script. */
const tour: InputScriptStepV2[] = [
  { command: "start" },
  ...(level1Script.steps ?? []),
  { command: "menu" },
  { command: "start" },
];

describe("the second game's flow, headless", () => {
  it("goes menu → level 1 → result → menu on one script, then Start goes on to level 2", async () => {
    const r = await playFrom("menu", tour);
    expect(r.segments!.map((s) => s.scene)).toEqual([
      "menu",
      "level-1",
      "result",
      "menu",
      "level-2",
    ]);
    expect(r.segments!.map((s) => s.end)).toEqual([
      { result: "flow", tick: 0, to: "level-1" },
      { result: "flow", tick: golden.outcome.tick, to: "result" },
      { result: "flow", tick: 0, to: "menu" },
      { result: "flow", tick: 0, to: "level-2" },
      { result: "script-end", tick: expect.any(Number) },
    ]);
    // Level 1 plays as the level-1 golden does, and ends on the tick the red side falls.
    expect(r.segments![1]!.ticks).toBe(golden.ticks);
    expect(r.final?.screen).toBeUndefined();
    expect(Object.keys(r.final!.units).sort()).toEqual([
      "blue-archer/unit",
      "blue-knight-1/unit",
      "blue-knight-2/unit",
      "red-archer/unit",
      "red-knight/unit",
    ]);
  });

  it("carries the progress through persist: level 1 cleared, the roster standing, the result's lines", async () => {
    const [menu, level, result, back, level2] = (await playFrom("menu", tour)).segments!.map(
      (s) => s.recording,
    );
    const won = result!.start.persist as TacticsProgress;
    expect(menu!.start.persist).toEqual(initialProgress());
    expect(level!.start.persist).toEqual(initialProgress());
    expect(won).toEqual({
      cleared: ["level-1"],
      roster: ["blue-archer/unit", "blue-knight-1/unit"],
      last: { level: "level-1", result: "won", turns: 6 },
    });
    expect(back!.start.persist).toEqual(won);
    expect(level2!.start.persist).toEqual(won);
    expect(level!.next).toEqual({ scene: "result" });

    const titles: Record<string, string> = { "level-1": "Ford" };
    const lines = resultLines(won, (s) => titles[s] ?? s, 2);
    expect(lines.heading).toBe("Victory");
    expect(lines.lines).toEqual([
      "Ford won in 6 turns",
      "Still standing: Blue archer, Blue knight 1",
      "Levels cleared: 1 of 2",
    ]);
  });

  it("replays each scene's recording alone to its own digest", async () => {
    const r = await playFrom("menu", tour);
    for (const seg of r.segments!) {
      const def = sceneDef(seg.scene);
      const run = replayRecording<TacticsRunSnapshot>({
        scene: def,
        prefabs,
        registry,
        project: tacticsProjectView(),
        rapier: null,
        game: tacticsGame,
        recording: seg.recording,
        flow: library(),
      });
      if (run.blocked) throw new Error(`replay of ${seg.scene} blocked`);
      expect(run.matches, `${seg.scene}: ${run.divergence ?? ""}`).toBe(true);
    }
  });

  it("records a lost level's defeat for the result scene", async () => {
    // Red alone on the board: the level is lost the moment it loads.
    const doomed = sceneDef("level-1");
    doomed.name = "doomed";
    doomed.instances = (doomed.instances ?? []).filter((i) => i.id.startsWith("red-"));
    const solo = runPlaytest<TacticsRunSnapshot>({
      scene: doomed,
      prefabs,
      registry,
      project: tacticsProjectView(),
      rapier: null,
      game: tacticsGame,
      script: { v: 2, seed: 1, steps: [{ wait: 2 }] },
      flow: library({ doomed }),
    });
    if (solo.blocked) throw new Error("blocked");
    expect(solo.segments!.map((s) => [s.scene, s.end.result])).toEqual([
      ["doomed", "flow"],
      ["result", "script-end"],
    ]);
    expect(solo.segments![1]!.recording.start.persist).toEqual({
      cleared: [],
      roster: [],
      last: { level: "doomed", result: "lost", turns: 1 },
    });
    const lines = resultLines(
      solo.segments![1]!.recording.start.persist as TacticsProgress,
      (s) => s,
      2,
    );
    expect(lines).toEqual({
      heading: "Defeat",
      lines: ["doomed lost after 1 turn", "Levels cleared: 0 of 2"],
    });
  });

  it("refuses a level's orders on the menu and the menu's start on a level", async () => {
    const r = await playFrom("menu", [{ command: "end-turn" }, { wait: 1 }], library());
    expect(r.segments).toHaveLength(1);
    expect(r.outcome.result).toBe("script-end");
    expect(r.final?.screen).toBe("menu");
    const l = await playFrom("level-1", [{ command: "start" }, { wait: 1 }], library());
    expect(l.segments).toHaveLength(1);
    expect(l.final?.next).toBeUndefined();
  });
});

describe("level 2's stair", () => {
  const onStair: InputScriptStepV2[] = [
    { command: "move", args: { unit: "blue-knight-2/unit", to: [3, 5] } },
    { wait: 32 },
  ];

  it("attaches the cellar two rows under the board when a unit steps on it", async () => {
    const r = await playFrom("level-2", onStair);
    const final = r.final!;
    expect(final.units["cellar:guard/unit"]).toMatchObject({
      side: "red",
      class: "knight",
      cell: [8, 6],
    });
    expect([final.grid.cols, final.grid.rows]).toEqual([12, 8]);
    // The cellar's pillar walls its cell, and its rubble costs a move.
    expect(final.grid.walls).toContain(cellKey([2, 7]));
    expect(final.grid.costs).toContainEqual([cellKey([4, 6]), 10]);
    expect(r.events.filter((e) => e.type === TACTICS_OPENED)).toEqual([
      expect.objectContaining({
        entityId: "stair",
        other: "blue-knight-2/unit",
        data: { sublevel: "cellar", units: ["cellar:guard/unit"] },
      }),
    ]);
  });

  it("stays shut when its offset is off the board's cells, judged in whole px", async () => {
    const def = sceneDef("level-2");
    const stair = def.entities?.find((e) => e.id === "stair");
    if (!stair) throw new Error("level 2 has no stair");
    stair.offset = [0.5, 6];
    const lib = library();
    const scenes = new Map(lib.scenes).set("level-2", { def, prefabs });
    const loaded = await loadHeadless({
      files: { scene: def, prefabs: [...prefabs.values()] },
      registry,
      project: tacticsProjectView(),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = runPlaytest<TacticsRunSnapshot>({
      ...loaded,
      rapier: null,
      game: tacticsGame,
      dev: true,
      script: { v: 2, seed: 1, steps: onStair },
      flow: { list: lib.list, scenes },
    });
    if (r.blocked) throw new Error("blocked");
    expect(warn.mock.calls.map(([m]) => String(m))).toEqual([
      expect.stringContaining("doesn't put its cells on the main scene's"),
    ]);
    warn.mockRestore();
    expect(Object.keys(r.final!.units)).not.toContain("cellar:guard/unit");
    expect(r.events.some((e) => e.type === TACTICS_OPENED)).toBe(false);
  });

  it("stays shut where the run has no scene list", async () => {
    const r = await playFrom("level-2", onStair, null);
    expect(Object.keys(r.final!.units)).not.toContain("cellar:guard/unit");
    expect([r.final!.grid.cols, r.final!.grid.rows]).toEqual([12, 6]);
  });
});

describe("the menu's words", () => {
  it("names units from their ids, sublevel prefix and all", () => {
    expect(unitName("blue-knight-1/unit")).toBe("Blue knight 1");
    expect(unitName("cellar:guard/unit")).toBe("Guard");
  });

  it("has nothing to say before any level", () => {
    expect(resultLines(initialProgress(), (s) => s, 2)).toEqual({
      heading: "No level played yet",
      lines: [],
    });
  });
});

/** The scene list as a host's synchronous source. */
function source(): SceneSource {
  const lib = library();
  return {
    list: () => lib.list,
    start: () => sceneListFlow(sceneList).start,
    scene: (id) => lib.scenes.get(id) ?? null,
  };
}

/** A loader with nothing to fetch: textures stay placeholders. */
const loader = {
  async load() {
    return { failed: [] };
  },
  retain() {},
  release() {},
  texture: () => null,
  destroy() {},
} as unknown as NonNullable<Parameters<typeof createGame>[1]["assets"]>["loader"];

describe("the second game's flow in the shell", () => {
  const games: GameInstance[] = [];
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fades out and back in from the menu's Start into level 1, the menu standing down for the HUD", async () => {
    const held = tacticsHeldProject();
    const log: string[] = [];
    const fade = fadeTransition();
    const veil = () => document.querySelector<HTMLElement>("[data-jams-fade]");
    const transition: TransitionRunner = async (phase, spec, layer) => {
      log.push(`${phase} ${spec.kind} ${spec.ms}`);
      await fade(phase, spec, layer);
      log.push(`${phase} ${veil()?.style.opacity ?? "gone"}`);
    };
    const game = await createGame(canvas, {
      game: tacticsGame,
      dev: true,
      assets: { loader, view: held.view, kinds: held.kinds },
      flow: { source: source(), transition, loading: false },
    });
    games.push(game);
    game.start();
    const unmount = mountUi(game, canvas, mountTacticsHud);

    const started = game.flow.restart();
    await vi.runAllTimersAsync();
    expect(await started).toMatchObject({ ok: true, scene: "menu" });
    const start = document.querySelector<HTMLButtonElement>('button[data-command="start"]');
    expect(start?.textContent).toBe("Start");
    expect(
      document.querySelector('button[data-action="continue"]')?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(document.querySelector(".tactics-menu-note")?.textContent).toBe(
      game.saves.store.describe,
    );
    expect(document.querySelector(".tactics-menu")?.textContent).toContain("Next: Ford");
    expect(document.querySelector<HTMLElement>(".tactics-hud")?.hidden).toBe(true);
    log.length = 0;

    start!.click();
    game.step();
    await vi.advanceTimersByTimeAsync(100);
    // Halfway through the out half the veil is fading in over everything.
    expect(veil()?.style.opacity).toBe("1");
    expect(log).toEqual(["out fade 400"]);

    await vi.runAllTimersAsync();
    expect(log).toEqual(["out fade 400", "out 1", "in fade 400", "in gone"]);
    expect(game.flow.current()).toBe("level-1");
    expect(veil()).toBeNull();
    expect(document.querySelector(".tactics-menu")).toBeNull();
    expect(document.querySelector<HTMLElement>(".tactics-hud")?.hidden).toBe(false);
    unmount();
  });
});
