// @vitest-environment jsdom
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../game/define";
import type { SceneSwap } from "../game/live";
import { findSceneVersion } from "../project/scene-version";
import type { RunRecording } from "../scene/recording-schema";
import { installLiveGames, world } from "./fixtures/live-game";
import { markerScene, markerSource, oneSceneVersion } from "./fixtures/live-version";

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

const scene = (markers: readonly string[]) => markerScene("hall", markers);

const startedLiveGame = installLiveGames();

describe("Play of a doc while a version is active", () => {
  it("runs a doc that isn't the version as its own: no version in ctx.live, the recording or the next swap's from side", async () => {
    const g = await startedLiveGame(game, { source: markerSource(["hall"]) });

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

    const versions = (id: string) => findSceneVersion(id, [v1, v2]);
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
    const g = await startedLiveGame(game, { source: markerSource(["hall"]) });
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
