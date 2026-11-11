// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { TimeModel } from "../game/time";
import type { GameDefinition } from "../game/types";
import type { TickInput } from "../input/stream";
import { parseSceneOrThrow } from "../scene/parse";
import type { RunRecording } from "../scene/recording-schema";
import engineYardJson from "../scenes/engine-yard.json";
import type { ToolEvent } from "../tool-router";
import type { GameInstance, RapierModule, UiActionEvent } from "../types";
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

const UI_ACTIONS = ["cursor", "confirm"];
const FRAME_MS = 1000 / 120;

/** The test game plus a UI-only cursor (arrows, the d-pad) and confirm (Enter, the pad's south). */
function uiGame(time: TimeModel) {
  const delivered: number[] = [];
  const inputs: TickInput[] = [];
  const game: GameDefinition = {
    ...testGame,
    time,
    actions: [
      ...testGame.actions!,
      {
        action: "cursor",
        kind: "vector",
        ui: true,
        description: "Moves the selection.",
        bindings: [
          { device: "key", code: "ArrowLeft", axis: "x", value: -1 },
          { device: "key", code: "ArrowRight", axis: "x", value: 1 },
          { device: "key", code: "ArrowUp", axis: "y", value: -1 },
          { device: "key", code: "ArrowDown", axis: "y", value: 1 },
          { device: "pad", button: "dpad-left", axis: "x", value: -1 },
          { device: "pad", button: "dpad-right", axis: "x", value: 1 },
          { device: "pad", button: "dpad-up", axis: "y", value: -1 },
          { device: "pad", button: "dpad-down", axis: "y", value: 1 },
        ],
      },
      {
        action: "confirm",
        ui: true,
        description: "Picks the selection.",
        bindings: [
          { device: "key", code: "Enter" },
          { device: "pad", button: "south" },
        ],
      },
    ],
    createRuntime(ctx) {
      const base = testGame.createRuntime(ctx);
      return {
        ...base,
        beforeStep(dtMs, actions, commands) {
          delivered.push(ctx.tick);
          base.beforeStep?.(dtMs, actions, commands);
        },
      };
    },
  };
  return { game, delivered, inputs };
}

const registry = createRegistry(testGame);
const yard = () => parseSceneOrThrow(engineYardJson, registry);

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

const games: GameInstance[] = [];
let pending: FrameRequestCallback[] = [];
let now = 0;

beforeEach(() => {
  document.body.appendChild(document.createElement("canvas"));
  pending = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  delete (navigator as { getGamepads?: unknown }).getGamepads;
  vi.unstubAllGlobals();
});

function frames(ms: number): void {
  for (let t = 0; t < ms; t += FRAME_MS) {
    now += FRAME_MS;
    const due = pending;
    pending = [];
    for (const cb of due) cb(now);
  }
}

async function makeGame(game: GameDefinition): Promise<GameInstance> {
  const instance = await createGame(document.querySelector("canvas")!, {
    game,
    rapier: async () => rapier,
    scene: yard(),
  });
  games.push(instance);
  return instance;
}

/** A standard pad behind a fake `navigator.getGamepads`, counting its reads. */
function fakePad() {
  const pressed = Array.from({ length: 17 }, () => false);
  const reads = { count: 0 };
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => {
      reads.count++;
      return [
        {
          index: 0,
          id: "fake",
          mapping: "standard",
          connected: true,
          buttons: pressed.map((p) => ({ pressed: p, value: p ? 1 : 0 })),
          axes: [0, 0, 0, 0],
        },
      ];
    },
  });
  const button = (name: number, down: boolean) => void (pressed[name] = down);
  return { button, reads };
}

const SOUTH = 0;
const EAST = 1;
const DPAD_DOWN = 13;

const key = (code: string, type: "down" | "up" = "down", repeat = false): ToolEvent => ({
  kind: "key",
  type,
  key: code,
  code,
  native: new KeyboardEvent(`key${type}`, { key: code, code, repeat }),
});

function listen(game: GameInstance, actions?: readonly string[]) {
  const seen: UiActionEvent[] = [];
  const off = game.input.onAction((e) => seen.push(e), actions ? { actions } : undefined);
  return { seen, off };
}

/** The TickInput of every step the shell takes. */
function spySteps(game: GameInstance): TickInput[] {
  const inputs: TickInput[] = [];
  const runtime = game.runtime()!;
  const step = runtime.step;
  runtime.step = (dt, input, commands) => {
    if (!Array.isArray(input)) inputs.push(structuredClone(input) as TickInput);
    return step(dt, input, commands);
  };
  return inputs;
}

describe("input.onAction", () => {
  it("delivers cursor, confirm and the pad's d-pad from a turns game with no tick running", async () => {
    const pad = fakePad();
    const { game: def, delivered } = uiGame({ kind: "turns", rate: 30 });
    const game = await makeGame(def);
    game.start();
    expect(game.play(yard()).ok).toBe(true);
    const { seen } = listen(game);
    frames(100);

    game.router.dispatch(key("ArrowRight"));
    expect(seen.at(-1)).toMatchObject({
      action: "cursor",
      kind: "vector",
      player: 0,
      device: "keyboard",
      vector: { x: 1, y: 0 },
    });
    game.router.dispatch(key("ArrowRight", "up"));
    expect(seen.at(-1)).toMatchObject({ action: "cursor", vector: { x: 0, y: 0 } });

    game.router.dispatch(key("Enter"));
    game.router.dispatch(key("Enter", "down", true));
    game.router.dispatch(key("Enter", "up"));
    const confirms = seen.filter((e) => e.action === "confirm");
    expect(confirms).toEqual([
      expect.objectContaining({ kind: "button", device: "keyboard", down: true }),
      expect.objectContaining({ down: true, repeat: true }),
      expect.objectContaining({ down: false }),
    ]);
    expect(confirms[0]!.repeat).not.toBe(true);

    const before = seen.length;
    pad.button(DPAD_DOWN, true);
    frames(FRAME_MS);
    expect(seen.slice(before)).toEqual([
      expect.objectContaining({
        action: "cursor",
        kind: "vector",
        device: "pad:0",
        vector: { x: 0, y: 1 },
      }),
    ]);
    pad.button(DPAD_DOWN, false);
    pad.button(SOUTH, true);
    frames(FRAME_MS);
    const polled = seen.slice(before + 1);
    expect(polled).toHaveLength(2);
    expect(polled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "cursor", device: "pad:0", vector: { x: 0, y: 0 } }),
        expect.objectContaining({ action: "confirm", device: "pad:0", down: true }),
      ]),
    );
    // Each frame delivers a pad edge once: holding it raises nothing more.
    frames(100);
    expect(seen).toHaveLength(before + 3);

    expect(delivered).toEqual([]);
    expect(game.getStore().state.tick).toBe(0);
  });

  it("delivers only the actions a listener names", async () => {
    fakePad();
    const { game: def } = uiGame({ kind: "turns", rate: 30 });
    const game = await makeGame(def);
    game.start();
    game.play(yard());
    const { seen } = listen(game, ["confirm"]);
    const all = listen(game);
    game.router.dispatch(key("ArrowDown"));
    game.router.dispatch(key("KeyD"));
    game.router.dispatch(key("Enter"));
    expect(seen.map((e) => e.action)).toEqual(["confirm"]);
    expect(all.seen.map((e) => e.action)).toEqual(["cursor", "right", "confirm"]);
  });

  it("polls the pads every frame while listened, editing or paused, and stops on unsubscribe", async () => {
    const pad = fakePad();
    const { game: def } = uiGame({ kind: "fixed", rate: 30 });
    const game = await makeGame(def);
    game.start();
    game.stop();
    frames(100);
    // Editing reads no pads for the simulation.
    expect(pad.reads.count).toBe(0);

    const { seen, off } = listen(game);
    frames(FRAME_MS * 10);
    expect(pad.reads.count).toBeGreaterThanOrEqual(9);
    pad.button(SOUTH, true);
    frames(FRAME_MS);
    expect(seen).toEqual([expect.objectContaining({ action: "confirm", down: true })]);
    pad.button(SOUTH, false);
    frames(FRAME_MS);
    expect(seen.at(-1)).toMatchObject({ action: "confirm", down: false });

    game.play(yard());
    game.pause();
    const paused = seen.length;
    pad.button(EAST, true);
    pad.button(DPAD_DOWN, true);
    frames(FRAME_MS * 3);
    expect(seen.slice(paused)).toEqual([
      expect.objectContaining({ action: "cursor", vector: { x: 0, y: 1 } }),
    ]);
    expect(game.getStore().state.tick).toBe(0);

    game.stop();
    off();
    off();
    const reads = pad.reads.count;
    const delivered = seen.length;
    pad.button(DPAD_DOWN, false);
    pad.button(SOUTH, true);
    frames(FRAME_MS * 10);
    expect(pad.reads.count).toBe(reads);
    expect(seen).toHaveLength(delivered);
  });

  it("keeps UI actions out of every TickInput, the pad's frame and tick polls each seeing its edges", async () => {
    const pad = fakePad();
    const { game: def } = uiGame({ kind: "fixed", rate: 30 });
    const game = await makeGame(def);
    game.start();
    game.play(yard());
    const inputs = spySteps(game);
    const { seen } = listen(game);

    game.router.dispatch(key("Enter"));
    game.router.dispatch(key("ArrowUp"));
    game.router.dispatch(key("KeyD"));
    pad.button(DPAD_DOWN, true);
    frames(200);
    pad.button(SOUTH, true);
    game.router.dispatch(key("Enter", "up"));
    frames(200);
    game.step(3);

    expect(inputs.length).toBeGreaterThan(10);
    const ticked = inputs.flatMap((i) => i.actions.map((a) => a.action));
    expect(ticked).toContain("right");
    for (const name of UI_ACTIONS) expect(ticked).not.toContain(name);
    // The listener heard the pad's south once, though the tick poll read it too.
    const padConfirms = seen.filter((e) => e.action === "confirm" && e.device === "pad:0");
    expect(padConfirms).toEqual([expect.objectContaining({ down: true })]);
  });

  it("records empty seat streams for a session that pressed only UI actions", async () => {
    const { game: def } = uiGame({ kind: "fixed", rate: 30 });
    const game = await makeGame(def);
    game.start();
    game.stop();
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    listen(game);

    expect(game.play(yard()).ok).toBe(true);
    game.step(2);
    game.router.dispatch(key("Enter"));
    game.router.dispatch(key("ArrowLeft"));
    game.step(3);
    game.router.dispatch(key("Enter", "up"));
    game.router.dispatch(key("ArrowLeft", "up"));
    game.step(2);
    game.stop();

    expect(recorded).toHaveLength(1);
    const rec = recorded[0]!;
    for (const name of UI_ACTIONS) expect(rec.actions).not.toContain(name);
    expect(rec.inputs.every((seat) => seat.length === 0)).toBe(true);
  });
});
