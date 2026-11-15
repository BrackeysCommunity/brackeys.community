// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEventLog, EVENT_LOG_CAPACITY } from "../debug/event-log";
import { debugTools, type DebugOverlay } from "../debug/index";
import { loadedRunEvents } from "../editor-ui/session/loaded-run";
import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import { replayRecording } from "../headless/recording";
import type { StepEvent } from "../runtime/types";
import { parseSceneOrThrow } from "../scene/parse";
import type { RunRecording } from "../scene/recording-schema";
import engineYardJson from "../scenes/engine-yard.json";
import type { ToolEvent } from "../tool-router";
import type { GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { testGame } from "./fixtures/test-game";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

const at = { x: 0, y: 0 };
const ev = (tick: number, type: string, more: Partial<StepEvent> = {}): StepEvent => ({
  tick,
  type,
  at,
  ...more,
});

describe("the event log", () => {
  it("keeps 10,000 events by default and drops the oldest past its capacity", () => {
    expect(createEventLog().capacity).toBe(EVENT_LOG_CAPACITY);
    expect(EVENT_LOG_CAPACITY).toBe(10_000);
    const log = createEventLog();
    for (let t = 0; t < 10_050; t++) log.append(t, [ev(t, "tick")]);
    const kept = log.list();
    expect(kept).toHaveLength(10_000);
    expect(kept[0]!.tick).toBe(50);
    expect(kept.at(-1)!.tick).toBe(10_049);

    const small = createEventLog({ capacity: 3 });
    small.append(0, [ev(0, "a"), ev(0, "b")]);
    small.append(1, [ev(1, "c"), ev(1, "d"), ev(1, "e")]);
    expect(small.list().map((e) => e.type)).toEqual(["c", "d", "e"]);
  });

  it("filters by type, entity, since and limit, oldest first", () => {
    const log = createEventLog();
    log.append(0, [ev(0, "sensor:enter", { entityId: "door", other: "hero" })]);
    log.append(3, [
      ev(3, "dialogue:line", { data: { text: "hi" } }),
      ev(3, "coin", { entityId: "c1" }),
    ]);
    log.append(7, [ev(7, "sensor:exit", { entityId: "door", other: "hero" })]);
    log.append(9, [ev(9, "coin", { entityId: "c2" })]);

    const types = (list: readonly StepEvent[]) => list.map((e) => `${e.tick}:${e.type}`);
    expect(types(log.list({ types: ["coin"] }))).toEqual(["3:coin", "9:coin"]);
    expect(types(log.list({ types: ["coin", "dialogue:line"] }))).toEqual([
      "3:dialogue:line",
      "3:coin",
      "9:coin",
    ]);
    expect(types(log.list({ entity: "hero" }))).toEqual(["0:sensor:enter", "7:sensor:exit"]);
    expect(types(log.list({ entity: "c1" }))).toEqual(["3:coin"]);
    expect(types(log.list({ since: 7 }))).toEqual(["7:sensor:exit", "9:coin"]);
    expect(types(log.list({ limit: 2 }))).toEqual(["7:sensor:exit", "9:coin"]);
    expect(log.list({ limit: 0 })).toEqual([]);
    expect(types(log.list({ entity: "door", since: 1, limit: 5 }))).toEqual(["7:sensor:exit"]);
  });

  it("tells subscribers each tick's events and the clear, until they unsubscribe", () => {
    const log = createEventLog();
    const seen: [number, number][] = [];
    const off = log.subscribe((tick, events) => seen.push([tick, events.length]));
    log.append(0, []);
    log.append(1, [ev(1, "a"), ev(1, "b")]);
    log.clear();
    expect(log.list()).toEqual([]);
    expect(seen).toEqual([
      [1, 2],
      [-1, 0],
    ]);
    off();
    log.append(2, [ev(2, "c")]);
    expect(seen).toHaveLength(2);
  });
});

const registry = createRegistry(testGame);
const yard = () => parseSceneOrThrow(engineYardJson, registry);

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

/** A dev host's overlay that draws nothing but lends the engine's debug tools. */
const toolsOnly = (): DebugOverlay => ({
  setPhysics: () => {},
  update: () => {},
  destroy: () => {},
  tools: debugTools(),
});

const key = (k: string, type: "down" | "up" = "down"): ToolEvent => ({
  kind: "key",
  type,
  key: k,
  native: new KeyboardEvent(`key${type}`, { key: k }),
});

/** Walks the avatar right through the zone in a dev shell, then stops: its recording and the shell's log. */
async function livePlay(
  logged = true,
): Promise<{ rec: RunRecording; events: readonly StepEvent[] }> {
  const game = await createGame(document.querySelector("canvas")!, {
    game: testGame,
    registry,
    rapier: async () => rapier,
    scene: yard(),
    dev: true,
    ...(logged ? { debug: toolsOnly } : {}),
  });
  games.push(game);
  const recorded: RunRecording[] = [];
  game.on("play:recorded", (r) => recorded.push(r));
  expect(game.play(yard())).toMatchObject({ ok: true });
  game.router.dispatch(key("d"));
  game.step(180);
  game.router.dispatch(key("d", "up"));
  game.step(20);
  game.stop();
  expect(recorded).toHaveLength(1);
  return { rec: recorded[0]!, events: game.debug.events.list() };
}

describe("a loaded run's event log", () => {
  it("equals the live run's events, from one headless replay in the page", async () => {
    const { rec, events } = await livePlay();
    expect(events.length).toBeGreaterThan(0);
    const run = { recording: rec, name: "Last run" };
    const scene = yard();
    let replays = 0;
    const counted: typeof replayRecording = (opts) => (replays++, replayRecording(opts));
    const log = loadedRunEvents(run, { rapier, game: testGame, registry, scene }, counted);
    expect(log).not.toBeNull();
    // The recording ends at the run's outcome; Play goes on past it.
    const recorded = events.filter((e) => e.tick < rec.ticks);
    expect(recorded.map((e) => e.type)).toContain("sensor:enter");
    expect(log!.list()).toEqual(recorded);
    expect(loadedRunEvents(run, { rapier, game: testGame, registry, scene }, counted)).toBe(log);
    expect(replays).toBe(1);
  });

  it("is null for a run that can't replay here", async () => {
    const { rec } = await livePlay();
    const broken = { ...rec, actions: ["no-such-action"] } as RunRecording;
    expect(
      loadedRunEvents({ recording: broken, name: "x" }, { rapier, registry, scene: yard() }),
    ).toBeNull();
  });

  it("leaves the run's digest unchanged whether or not it is logged", async () => {
    const { rec } = await livePlay();
    const { rec: unlogged, events } = await livePlay(false);
    expect(events).toEqual([]);
    expect(unlogged.outcome).toEqual(rec.outcome);
    const plain = replayRecording({
      rapier,
      game: testGame,
      registry,
      scene: yard(),
      recording: rec,
    });
    const logged = replayRecording({
      rapier,
      game: testGame,
      registry,
      scene: yard(),
      recording: rec,
      onEvents: () => {},
    });
    if (plain.blocked || logged.blocked) throw new Error("replay blocked");
    expect(plain.matches, plain.divergence ?? "").toBe(true);
    expect(logged.matches, logged.divergence ?? "").toBe(true);
    expect(logged.recording.outcome).toEqual(plain.recording.outcome);
    expect(logged.recording.outcome).toEqual(rec.outcome);
  });
});
