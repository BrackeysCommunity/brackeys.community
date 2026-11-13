// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { LibraryScene } from "../game/flow";
import type { GameDefinition } from "../game/types";
import type { RunRecording } from "../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import type { GameInstance, SceneSource, StagedVersion } from "../types";
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

const ATTACH = 3;

/** Attaches the cellar after tick `ATTACH`; its snapshot names every live entity. */
const subGame: GameDefinition = defineGame({
  id: "sub-shell",
  types: [],
  actions: [],
  world: { physics: "none" },
  live: { timings: ["next-load", "boundary", "now"] },
  createRuntime(ctx) {
    return {
      afterStep() {
        if (ctx.tick === ATTACH) ctx.flow.attach("cellar", { label: "low" });
      },
      snapshot: () => ({ ids: [...ctx.query.select()].sort() }),
    };
  },
});

const scene = (name: string, markers: readonly string[]): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  game: subGame.id,
  bounds: [0, 0, 10, 10],
  settings: { physics: "none" },
  entities: markers.map((id, i) => ({ id, type: "marker", at: [1 + i, 1] })),
});

const yard = () => scene("yard", ["start"]);

function source(): SceneSource {
  const scenes = new Map<string, LibraryScene>([
    ["yard", { def: yard(), prefabs: new Map() }],
    ["cellar", { def: scene("cellar", ["door"]), prefabs: new Map() }],
  ]);
  return {
    list: () => [{ scene: "yard" }, { scene: "cellar", sublevel: true }],
    start: () => "yard",
    scene: (id) => scenes.get(id) ?? null,
  };
}

const games: GameInstance[] = [];

beforeEach(() => {
  document.body.appendChild(document.createElement("canvas"));
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
});

async function setup() {
  const game = await createGame(document.querySelector("canvas")!, {
    game: subGame,
    scene: yard(),
    flow: { source: source(), loading: false },
  });
  games.push(game);
  game.start();
  game.stop();
  const recorded: RunRecording[] = [];
  game.on("play:recorded", (r) => recorded.push(r));
  const barrel = await oneSceneVersion(scene("cellar", ["door", "barrel"]), subGame, {
    scene: "cellar",
  });
  expect(await game.live.stage(barrel)).toEqual({ ok: true });
  const versions = (id: string): StagedVersion | null => (id === barrel.id ? barrel : null);
  const cellar = () => (game.runtime()!.snapshot() as { ids: string[] }).ids;
  /** Plays the yard past the attach and stops: the recording and the cellar as it attached. */
  const playRun = () => {
    expect(game.play(yard())).toMatchObject({ ok: true });
    game.step(ATTACH + 3);
    const ids = cellar();
    game.stop();
    return { rec: recorded.at(-1)!, ids };
  };
  const replayRun = (rec: RunRecording) => {
    expect(game.replay(yard(), rec, { versions })).toMatchObject({ ok: true });
    game.step(ATTACH + 3);
    const ids = cellar();
    game.stop();
    return ids;
  };
  return { game, barrel, playRun, replayRun };
}

describe("a sublevel's live version across a recording's start", () => {
  it("records the version the sublevel ran at the start, and replays it after it was moved back", async () => {
    const t = await setup();
    t.game.live.activate("cellar", t.barrel.id, "next-load");
    const { rec, ids } = t.playRun();
    expect(ids).toEqual(["low:barrel", "low:door", "start"]);
    expect(rec.swaps).toEqual([
      expect.objectContaining({ tick: 0, sublevel: "cellar", version: t.barrel.id }),
    ]);

    t.game.live.activate("cellar", null, "next-load");
    expect(t.replayRun(rec)).toEqual(ids);
    // The replay gave the cellar back the version it had before.
    expect(t.game.live.current("cellar")).toBeNull();
  });

  it("replays a run on the release's own sublevel while a live version is active", async () => {
    const t = await setup();
    const { rec, ids } = t.playRun();
    expect(ids).toEqual(["low:door", "start"]);
    expect(rec).not.toHaveProperty("swaps");

    t.game.live.activate("cellar", t.barrel.id, "next-load");
    expect(t.replayRun(rec)).toEqual(ids);
    expect(t.game.live.current("cellar")).toBe(t.barrel.id);
  });
});
