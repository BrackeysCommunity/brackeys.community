// @vitest-environment jsdom
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import type { RunRecording } from "../scene/recording-schema";
import type { GameInstance, StagedVersion } from "../types";
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

/** Attaches the cellar in `onLoad`, where it also notes `ctx.live.version`. */
function loadGame(seen: (string | null)[]): GameDefinition {
  return defineGame({
    id: "load-start",
    types: [],
    actions: [],
    world: { physics: "none" },
    live: { timings: ["next-load", "boundary", "now"] },
    createRuntime(ctx) {
      return {
        onLoad() {
          seen.push(ctx.live.version);
          ctx.flow.attach("cellar", { label: "low" });
        },
        snapshot: () => ({ ids: [...ctx.query.select()].sort() }),
      };
    },
  });
}

const startedLiveGame = installLiveGames();

async function staged(game: GameInstance, version: StagedVersion): Promise<void> {
  const staging = game.live.stage(version);
  await vi.runAllTimersAsync();
  expect(await staging).toEqual({ ok: true });
}

async function setup() {
  const seen: (string | null)[] = [];
  const def = loadGame(seen);
  const game = await startedLiveGame(def, {
    source: markerSource(["yard", { scene: "cellar", sublevel: true }]),
  });
  const recorded: RunRecording[] = [];
  game.on("play:recorded", (r) => recorded.push(r));
  const ids = () => (world(game).snapshot() as { ids: string[] }).ids;
  return { def, game, seen, recorded, ids };
}

describe("ctx.live.version in the shell's onLoad", () => {
  it("is the version a Play of that version's scene runs, null for another doc, and a replay's start", async () => {
    const t = await setup();
    const doc = markerScene("yard", ["start", "well"]);
    const v1 = await oneSceneVersion(doc, t.def, { scene: "yard" });
    await staged(t.game, v1);
    t.game.live.activate("yard", v1.id, "next-load");

    t.seen.length = 0;
    expect(t.game.play(doc)).toMatchObject({ ok: true });
    expect(t.seen).toEqual([v1.id]);
    t.game.step(2);
    t.game.stop();
    const rec = t.recorded.at(-1)!;
    expect(rec.sceneVersion).toBe(v1.id);

    t.seen.length = 0;
    expect(t.game.play(markerScene("yard", ["start", "torch"]))).toMatchObject({ ok: true });
    expect(t.seen).toEqual([null]);
    t.game.stop();

    t.seen.length = 0;
    const versions = (id: string) => (id === v1.id ? v1 : null);
    expect(t.game.replay(doc, rec, { versions })).toMatchObject({ ok: true });
    expect(t.seen).toEqual([v1.id]);
    t.game.stop();
  });
});

describe("a sublevel moved after the shell's onLoad attach, before the first step", () => {
  it("records the release's own scene the load attached before the move, and replays both in order", async () => {
    const t = await setup();
    const barrel = await oneSceneVersion(markerScene("cellar", ["start", "barrel"]), t.def, {
      scene: "cellar",
    });
    await staged(t.game, barrel);
    const yard = markerScene("yard", ["start"]);

    expect(t.game.play(yard)).toMatchObject({ ok: true });
    t.game.live.activate("cellar", barrel.id, "next-load");
    t.game.step(3);
    const ids = t.ids();
    t.game.stop();
    expect(ids).toEqual(["low:start", "start"]);
    const rec = t.recorded.at(-1)!;
    expect(rec.swaps).toEqual([
      expect.objectContaining({ tick: 0, sublevel: "cellar", version: null }),
      expect.objectContaining({ tick: 0, sublevel: "cellar", version: barrel.id }),
    ]);

    t.game.live.activate("cellar", null, "next-load");
    const versions = (id: string) => (id === barrel.id ? barrel : null);
    expect(t.game.replay(yard, rec, { versions })).toMatchObject({ ok: true });
    t.game.step(3);
    expect(t.ids()).toEqual(ids);
    t.game.stop();
    expect(t.game.recording()?.swaps).toEqual(rec.swaps);
  });
});
