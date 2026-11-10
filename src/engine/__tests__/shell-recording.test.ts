// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { GameCommand, GameDefinition } from "../game/types";
import { replayRecording } from "../headless/recording";
import { parseSceneOrThrow } from "../scene/parse";
import type { RunRecording } from "../scene/recording-schema";
import type { SceneDefinition } from "../scene/types";
import engineYardJson from "../scenes/engine-yard.json";
import type { ToolEvent } from "../tool-router";
import type { GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { testGame, type TestGameSnapshot } from "./fixtures/test-game";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const registry = createRegistry(testGame);
const yard = (): SceneDefinition => parseSceneOrThrow(engineYardJson, registry);

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

const games: GameInstance[] = [];

beforeEach(() => {
  document.body.appendChild(document.createElement("canvas"));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function editing(game: GameDefinition = testGame): Promise<GameInstance> {
  const instance = await createGame(document.querySelector("canvas")!, {
    game,
    registry: game === testGame ? registry : createRegistry(game),
    rapier: async () => rapier,
    scene: yard(),
  });
  games.push(instance);
  instance.start();
  instance.stop();
  return instance;
}

const key = (k: string, type: "down" | "up" = "down"): ToolEvent => ({
  kind: "key",
  type,
  key: k,
  native: new KeyboardEvent(`key${type}`, { key: k }),
});

/** Walk right, hop, walk left, then Stop: a `quit` recording. */
function session(game: GameInstance, doc: SceneDefinition): RunRecording {
  const recorded: RunRecording[] = [];
  game.on("play:recorded", (r) => recorded.push(r));
  expect(game.play(doc, { timeOffsetMs: 500 })).toMatchObject({ ok: true });
  game.router.dispatch(key("d"));
  game.step(20);
  game.router.dispatch(key("space"));
  game.step(1);
  game.router.dispatch(key("space", "up"));
  game.router.dispatch(key("d", "up"));
  game.router.dispatch(key("a"));
  game.step(30);
  game.router.dispatch(key("a", "up"));
  game.step(9);
  game.stop();
  expect(recorded).toHaveLength(1);
  return recorded[0]!;
}

describe("recording a play session", () => {
  it("records every edge on its tick, ends as quit at Stop, and replays headless to the same end", async () => {
    const game = await editing();
    const doc = yard();
    const rec = session(game, doc);
    expect(game.recording()).toBe(rec);
    expect(rec).toMatchObject({
      scene: "engine-yard",
      ticks: 60,
      start: { timeOffsetMs: 500 },
      actions: ["right", "push", "left"],
      outcome: { result: "quit", tick: 59 },
    });
    expect(rec.inputs).toEqual([
      [0, 0, 1],
      [20, 1, 1],
      [21, 1, 0],
      [21, 0, 0],
      [21, 2, 1],
      [51, 2, 0],
    ]);

    const replay = replayRecording<TestGameSnapshot>({
      rapier,
      game: testGame,
      registry,
      scene: doc,
      recording: rec,
    });
    if (replay.blocked) throw new Error("replay blocked");
    expect(replay.matches, replay.divergence ?? "").toBe(true);
    expect(replay.warnings).toEqual([]);
  });

  it("finishes at the game's first verdict", async () => {
    const game = await editing();
    game.play(yard());
    game.router.dispatch(key("d"));
    game.step(400);
    const rec = game.recording()!;
    expect(rec.outcome).toMatchObject({ result: "won", entityId: "zone" });
    expect(rec.ticks).toBe(rec.outcome.tick + 1);
    game.stop();
    expect(game.recording()).toBe(rec);
  });

  it("replays a recording in the browser in place of the keyboard, pausing on its last tick", async () => {
    const game = await editing();
    const doc = yard();
    const rec = session(game, doc);
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    game.router.dispatch(key("a"));
    game.step(100);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.end).toBe(rec.end);
    expect(recorded[0]!.inputs).toEqual(rec.inputs);
    expect(game.getStore().state.sim.paused).toBe(true);
  });
});

describe("commands in a play session", () => {
  /** The test game with a `shove` command, logging each step's commands by tick. */
  function commandGame() {
    const delivered: [number, GameCommand[]][] = [];
    let tick = 0;
    const game: GameDefinition = {
      ...testGame,
      commands: {
        shove: { description: "Moves by `by`.", args: z.strictObject({ by: z.number() }) },
        wait: { description: "Takes no args." },
      },
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            tick = ctx.tick;
            if (commands.length > 0) delivered.push([tick, [...commands]]);
            base.beforeStep?.(dtMs, actions, commands);
          },
        };
      },
    };
    return { game, delivered };
  }

  it("records the commands sent on their ticks and replays them through the shell", async () => {
    const { game: def, delivered } = commandGame();
    const game = await editing(def);
    const doc = yard();
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));

    expect(game.play(doc)).toMatchObject({ ok: true });
    game.router.dispatch(key("d"));
    game.step(5);
    expect(game.send({ name: "shove", args: { by: 2 } })).toBe(true);
    game.step(3);
    game.send({ name: "wait" });
    game.send({ name: "shove", args: { by: -1 } });
    game.step(4);
    game.stop();
    expect(recorded).toHaveLength(1);
    const rec = recorded[0]!;
    expect(rec.ticks).toBe(12);
    expect(rec.commands).toEqual([
      [5, "shove", { by: 2 }],
      [8, "wait"],
      [8, "shove", { by: -1 }],
    ]);
    const live = structuredClone(delivered);
    expect(live.map(([t]) => t)).toEqual([5, 8]);

    delivered.length = 0;
    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    expect(game.send({ name: "wait" })).toBe(false);
    game.step(20);
    expect(delivered).toEqual(live);
    expect(recorded).toHaveLength(2);
    expect(recorded[1]!.commands).toEqual(rec.commands);
    expect(recorded[1]!.end).toBe(rec.end);

    const headless = replayRecording({ rapier, game: def, scene: doc, recording: rec });
    if (headless.blocked) throw new Error("replay blocked");
    expect(headless.matches, headless.divergence ?? "").toBe(true);
  });
});
