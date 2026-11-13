// @vitest-environment jsdom
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import type { AssetBundle } from "../project/bundle";
import type { RunRecording } from "../scene/recording-schema";
import type { GameInstance, StagedVersion } from "../types";
import { installLiveGames, noopLoader, world } from "./fixtures/live-game";
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

const STEPS = 6;

/** Attaches the cellar in `onLoad`, or after tick `at`; its snapshot names every live entity. */
const subGame = (at: "load" | number): GameDefinition =>
  defineGame({
    id: "sub-shell",
    types: [],
    actions: [],
    world: { physics: "none" },
    live: { timings: ["next-load", "boundary", "now"] },
    createRuntime(ctx) {
      const attach = () => void ctx.flow.attach("cellar", { label: "low" });
      return {
        onLoad: () => (at === "load" ? attach() : undefined),
        afterStep: () => (ctx.tick === at ? attach() : undefined),
        snapshot: () => ({ ids: [...ctx.query.select()].sort() }),
      };
    },
  });

const yard = () => markerScene("yard", ["start"]);

/** Counts retains and loads per bundle name, as the version holds use them. */
function bundleLoader() {
  const held = new Map<string, number>();
  const loaded: string[] = [];
  const bump = (bundle: AssetBundle, by: number) =>
    held.set(bundle.name, (held.get(bundle.name) ?? 0) + by);
  const loader = noopLoader({
    async load(bundle: AssetBundle) {
      loaded.push(bundle.name);
      return { failed: [] };
    },
    retain: (bundle) => bump(bundle, 1),
    release: (bundle) => bump(bundle, -1),
  });
  return { loader, held, loaded };
}

const startedLiveGame = installLiveGames();

async function setup(at: "load" | number) {
  const counting = bundleLoader();
  const def = subGame(at);
  const game: GameInstance = await startedLiveGame(def, {
    source: markerSource(["yard", { scene: "cellar", sublevel: true }]),
    loader: counting.loader,
  });
  const recorded: RunRecording[] = [];
  game.on("play:recorded", (r) => recorded.push(r));
  const barrel = await oneSceneVersion(markerScene("cellar", ["start", "barrel"]), def, {
    scene: "cellar",
    assets: {
      crate: {
        key: "k-crate",
        kind: "texture",
        path: "art/crate.png",
        sha256: "c".repeat(64),
        bytes: 100,
        storage: "blob",
        file: `live/${"c".repeat(64)}.png`,
        meta: { format: "png", width: 16, height: 16 },
      },
    },
    bundle: { entries: ["crate"], bytes: 100 },
  });
  const staging = game.live.stage(barrel);
  await vi.runAllTimersAsync();
  expect(await staging).toEqual({ ok: true });
  const versions = (id: string): StagedVersion | null => (id === barrel.id ? barrel : null);
  const ids = () => (world(game).snapshot() as { ids: string[] }).ids;
  /** Plays the yard past the attach and stops: the recording and the cellar as it attached. */
  const playRun = () => {
    expect(game.play(yard())).toMatchObject({ ok: true });
    game.step(STEPS);
    const seen = ids();
    game.stop();
    return { rec: recorded.at(-1)!, ids: seen };
  };
  /** The barrel version's hold: its retains, net. */
  const hold = () => counting.held.get(`live:${barrel.id}`) ?? 0;
  return { game, barrel, versions, ids, playRun, hold, loaded: counting.loaded };
}

describe.each([
  ["after tick 3", 3 as const],
  ["in onLoad", "load" as const],
])("a sublevel's live version across a recording's start, attached %s", (_, at) => {
  it("records the version the sublevel ran at the start, and replays it after it was moved back", async () => {
    const t = await setup(at);
    t.game.live.activate("cellar", t.barrel.id, "next-load");
    const { rec, ids } = t.playRun();
    expect(ids).toEqual(["low:barrel", "low:start", "start"]);
    expect(rec.swaps).toEqual([
      expect.objectContaining({ tick: 0, sublevel: "cellar", version: t.barrel.id }),
    ]);

    t.game.live.activate("cellar", null, "next-load");
    expect(t.hold()).toBe(0);
    expect(t.game.replay(yard(), rec, { versions: t.versions })).toMatchObject({ ok: true });
    // A version only the replay brings in is held and preloaded while it runs.
    expect(t.hold()).toBe(1);
    expect(t.loaded).toContain(`live:${t.barrel.id}`);
    t.game.step(STEPS);
    expect(t.ids()).toEqual(ids);
    t.game.stop();
    // The replay re-recorded the start it replayed, and gave the cellar back what it had before.
    expect(t.game.recording()?.swaps).toEqual(rec.swaps);
    expect(t.game.live.current("cellar")).toBeNull();
    expect(t.hold()).toBe(0);
  });

  it("replays a run on the release's own sublevel while a live version is active, keeping its hold", async () => {
    const t = await setup(at);
    const { rec, ids } = t.playRun();
    expect(ids).toEqual(["low:start", "start"]);
    expect(rec).not.toHaveProperty("swaps");

    t.game.live.activate("cellar", t.barrel.id, "next-load");
    expect(t.hold()).toBe(1);
    expect(t.game.replay(yard(), rec, { versions: t.versions })).toMatchObject({ ok: true });
    expect(t.hold()).toBe(1);
    t.game.step(STEPS);
    expect(t.ids()).toEqual(ids);
    t.game.stop();
    expect(t.game.live.current("cellar")).toBe(t.barrel.id);
    expect(t.hold()).toBe(1);
  });

  it("doesn't start a replay whose start's sublevel version is gone, and keeps what was active", async () => {
    const t = await setup(at);
    t.game.live.activate("cellar", t.barrel.id, "next-load");
    const { rec } = t.playRun();
    const report = t.game.replay(yard(), rec, { versions: () => null });
    expect(report).toMatchObject({ ok: false });
    expect(report.issues[0]).toMatchObject({ code: "scene-version-removed" });
    expect(t.game.live.current("cellar")).toBe(t.barrel.id);
    expect(t.hold()).toBe(1);
  });
});
