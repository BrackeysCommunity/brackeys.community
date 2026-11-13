// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { LibraryScene } from "../game/flow";
import type { SceneSwap } from "../game/live";
import type { SceneRuntimeHandle } from "../runtime/types";
import type { RunRecording } from "../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import type { GameInstance, SceneSource } from "../types";
import { oneSceneVersion } from "./fixtures/live-version";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const game = defineGame({
  id: "own",
  types: [],
  actions: [],
  world: { physics: "none" },
  live: { timings: ["now"] },
  createRuntime: () => ({ snapshot: () => null }),
});

const scene = (markers: readonly string[]): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "hall",
  bounds: [0, 0, 10, 10],
  entities: markers.map((id, i) => ({ id, type: "marker", at: [1 + i, 1] })),
});

function source(): SceneSource {
  const hall: LibraryScene = { def: scene(["start"]), prefabs: new Map() };
  return {
    list: () => [{ scene: "hall" }],
    start: () => "hall",
    scene: (id) => (id === "hall" ? hall : null),
  };
}

const games: GameInstance[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  document.body.appendChild(document.createElement("canvas"));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const world = (g: GameInstance) => g.runtime() as SceneRuntimeHandle;

describe("Play of a doc while a version is active", () => {
  it("runs a doc that isn't the version as its own: no version in ctx.live, the recording or the next swap's from side", async () => {
    const g = await createGame(document.querySelector("canvas")!, {
      game,
      dev: true,
      flow: { source: source(), loading: false },
    });
    games.push(g);
    g.start();
    const restarted = g.flow.restart();
    await vi.runAllTimersAsync();
    expect(await restarted).toMatchObject({ ok: true, scene: "hall" });

    const v1 = await oneSceneVersion(scene(["start", "well"]), game, { scene: "hall" });
    const staging = g.live.stage(v1);
    await vi.runAllTimersAsync();
    expect(await staging).toEqual({ ok: true });
    g.live.activate("hall", v1.id, "now");
    g.step();
    expect(world(g).ctx.live.version).toBe(v1.id);

    const doc = scene(["start", "torch"]);
    expect(g.play(doc)).toMatchObject({ ok: true });
    expect(world(g).get("torch")).toBeDefined();
    expect(world(g).get("well")).toBeUndefined();
    expect(world(g).ctx.live.version).toBeNull();
    expect(g.live.current("hall")).toBe(v1.id);

    const v2 = await oneSceneVersion(scene(["start", "torch", "rope"]), game, { scene: "hall" });
    const restaged = g.live.stage(v2);
    await vi.runAllTimersAsync();
    expect(await restaged).toEqual({ ok: true });
    const swaps: SceneSwap[] = [];
    g.on("live:swapped", (s) => swaps.push(s));
    g.live.activate("hall", v2.id, "now");
    g.step(3);
    g.stop();

    const rec = g.recording() as RunRecording;
    expect(rec.sceneVersion).toBeUndefined();
    expect(swaps).toHaveLength(1);
    expect(swaps[0]!.from).toMatchObject({ version: null, sceneHash: rec.sceneHash });
    expect(swaps[0]!.to.version).toBe(v2.id);
    expect(rec.swaps?.map((s) => s.version)).toEqual([v2.id]);

    const versions = (id: string) => [v1, v2].find((v) => v.id === id) ?? null;
    const recorded: RunRecording[] = [];
    g.on("play:recorded", (r) => recorded.push(r));
    expect(g.replay(doc, rec, { versions })).toMatchObject({ ok: true });
    expect(world(g).get("torch")).toBeDefined();
    expect(world(g).get("well")).toBeUndefined();
    g.step(rec.ticks + 1);
    expect(world(g).get("rope")).toBeDefined();
    expect(recorded.at(-1)?.end).toEqual(rec.end);
    g.stop();
  });

  it("runs the active version when the doc is that version's scene", async () => {
    const g = await createGame(document.querySelector("canvas")!, {
      game,
      dev: true,
      flow: { source: source(), loading: false },
    });
    games.push(g);
    g.start();
    const restarted = g.flow.restart();
    await vi.runAllTimersAsync();
    expect(await restarted).toMatchObject({ ok: true, scene: "hall" });
    const doc = scene(["start", "well"]);
    const v1 = await oneSceneVersion(doc, game, { scene: "hall" });
    const staging = g.live.stage(v1);
    await vi.runAllTimersAsync();
    expect(await staging).toEqual({ ok: true });
    g.live.activate("hall", v1.id, "next-load");

    expect(g.play(doc)).toMatchObject({ ok: true });
    expect(world(g).ctx.live.version).toBe(v1.id);
    g.step(3);
    g.stop();
    expect(g.recording()?.sceneVersion).toBe(v1.id);
  });
});
