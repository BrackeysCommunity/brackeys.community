// @vitest-environment jsdom
import { Container } from "pixi.js";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vite-plus/test";
import { z } from "zod";

import { browserArch, createGame } from "../engine";
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
  game.router.dispatch(key(" "));
  game.step(1);
  game.router.dispatch(key(" ", "up"));
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
    expect(rec.inputs[0]).toEqual([
      [0, "b", 0, 1],
      [20, "b", 1, 1],
      [21, "b", 1, 0],
      [21, "b", 0, 0],
      [21, "b", 2, 1],
      [51, "b", 2, 0],
    ]);
    expect(rec.system).toEqual([]);

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

  it("names no physics build for a physics-free scene, though Rapier is loaded", async () => {
    const game = await editing();
    const doc: SceneDefinition = {
      v: 1,
      name: "markers",
      bounds: [0, 0, 500, 500],
      settings: { physics: "none" },
      entities: [{ id: "a", type: "marker", at: [100, 100], tags: ["spawn"] }],
    };
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    expect(game.play(doc)).toMatchObject({ ok: true });
    game.router.dispatch(key("d"));
    game.step(10);
    game.stop();
    const rec = recorded[0]!;
    expect(rec.ticks).toBe(10);
    expect(rec.engine.physics).toBeNull();
    expect(session(game, yard()).engine.physics).toMatch(/^rapier/);

    const replay = replayRecording({
      rapier,
      game: testGame,
      registry,
      scene: doc,
      recording: rec,
    });
    if (replay.blocked) throw new Error("replay blocked");
    expect(replay.warnings).toEqual([]);
    expect(replay.matches, replay.divergence ?? "").toBe(true);
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
    expect(rec.commands).toEqual(["shove", "wait"]);
    expect(rec.inputs[0]!.filter((e) => e[1] === "c")).toEqual([
      [5, "c", 0, { by: 2 }],
      [8, "c", 1],
      [8, "c", 0, { by: -1 }],
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
    expect(recorded[1]!.inputs).toEqual(rec.inputs);
    expect(recorded[1]!.end).toBe(rec.end);

    const headless = replayRecording({ rapier, game: def, scene: doc, recording: rec });
    if (headless.blocked) throw new Error("replay blocked");
    expect(headless.matches, headless.divergence ?? "").toBe(true);
  });
});

describe("seeds in a play session", () => {
  /** The test game with one draw from `ctx.random` at load, kept in its snapshot. */
  const drawGame: GameDefinition = {
    ...testGame,
    createRuntime(ctx) {
      const base = testGame.createRuntime(ctx);
      let draw = 0;
      return {
        ...base,
        onLoad(scene) {
          base.onLoad?.(scene);
          draw = ctx.random.nextU32();
        },
        snapshot() {
          const snap = base.snapshot?.();
          return snap ? { ...snap, draw } : null;
        },
      };
    },
  };

  async function editingDraws() {
    const game = await editing(drawGame);
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    return { game, recorded };
  }

  function walk(
    { game, recorded }: { game: GameInstance; recorded: RunRecording[] },
    doc: SceneDefinition,
    seed?: number | string,
  ): RunRecording {
    const before = recorded.length;
    expect(game.play(doc, seed === undefined ? {} : { seed })).toMatchObject({ ok: true });
    game.router.dispatch(key("d"));
    game.step(15);
    game.router.dispatch(key("d", "up"));
    game.step(5);
    game.stop();
    expect(recorded).toHaveLength(before + 1);
    return recorded.at(-1)!;
  }

  it("records a seeded play's seed, and replays it in the shell and headless to the same digest", async () => {
    const shell = await editingDraws();
    const doc = yard();
    const rec = walk(shell, doc, "lantern");
    expect(rec.seed).toBe("lantern");
    expect(rec.start).toEqual({});
    expect(walk(shell, doc, "moth").end).not.toBe(rec.end);
    const unseeded = walk(shell, doc);
    expect(unseeded.start).not.toHaveProperty("seed");
    expect(unseeded.seed).not.toBe("lantern");
    expect(unseeded.end).not.toBe(rec.end);

    const { game, recorded } = shell;
    const before = recorded.length;
    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    game.step(40);
    expect(recorded).toHaveLength(before + 1);
    expect(recorded.at(-1)!.seed).toBe("lantern");
    expect(recorded.at(-1)!.end).toBe(rec.end);

    const headless = replayRecording({
      rapier,
      game: drawGame,
      scene: doc,
      recording: rec,
    });
    if (headless.blocked) throw new Error("replay blocked");
    expect(headless.matches, headless.divergence ?? "").toBe(true);
  });
});

describe("recording a session's TickInputs", () => {
  /** Standard pads behind a fake `navigator.getGamepads`. */
  function fakePad() {
    const pad = { axes: [0, 0, 0, 0], pressed: Array.from({ length: 17 }, () => false) };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        {
          index: 0,
          id: "fake-0",
          mapping: "standard",
          connected: true,
          buttons: pad.pressed.map((pressed) => ({ pressed, value: pressed ? 1 : 0 })),
          axes: [...pad.axes],
        },
      ],
    });
    return pad;
  }

  afterEach(() => {
    delete (navigator as { getGamepads?: unknown }).getGamepads;
  });

  /**
   * Two seats: WASD's walk for seat 0 and the arrows' for seat 1, a pad stick
   * axis, a pointer button and a command. The snapshot keeps what each tick's
   * input state read, so the digest covers every device.
   */
  function seatGame() {
    const seen: { x: number; y: number }[] = [];
    const game: GameDefinition = {
      ...testGame,
      input: { players: { max: 2, join: "auto" } },
      commands: {
        shove: { description: "Moves by `by`.", args: z.strictObject({ by: z.number() }) },
      },
      actions: [
        {
          action: "left",
          description: "Walk left.",
          bindings: [
            { device: "key", code: "KeyA", player: 0 },
            { device: "key", code: "ArrowLeft", player: 1 },
          ],
        },
        {
          action: "right",
          description: "Walk right.",
          bindings: [
            { device: "key", code: "KeyD", player: 0 },
            { device: "key", code: "ArrowRight", player: 1 },
          ],
        },
        { action: "push", description: "Push.", bindings: [{ device: "key", code: "Space" }] },
        {
          action: "steer",
          kind: "axis",
          description: "Steer.",
          bindings: [{ device: "pad", axis: "left-x" }],
        },
        {
          action: "poke",
          description: "Poke.",
          bindings: [{ device: "pointer", button: "primary" }],
        },
      ],
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        const trace: string[] = [];
        return {
          ...base,
          // A still camera, so one screen point stays one world point.
          cameraTarget: () => null,
          beforeStep(dtMs, actions, commands) {
            const at = ctx.input.pointer(0);
            trace.push(
              [
                ctx.tick,
                ctx.input.players().filter((p) => p.joined).length,
                ctx.input.value("steer", 1),
                ctx.input.held("right", 0) ? "r0" : "",
                ctx.input.held("left", 1) ? "l1" : "",
                ctx.input.held("poke", 0) ? "p0" : "",
                at ? `${at.x},${at.y},${at.buttons}` : "-",
                commands.map((c) => c.name).join("+"),
              ].join("|"),
            );
            base.beforeStep?.(dtMs, actions, commands);
          },
          snapshot() {
            const snap = base.snapshot?.();
            return snap ? { ...snap, trace: [...trace] } : null;
          },
        };
      },
      attach: () => ({ onTick: (_dt, at) => void seen.push({ ...at }), destroy() {} }),
    };
    return { game, seen };
  }

  const code = (game: GameInstance, c: string, type: "down" | "up" = "down") =>
    game.router.dispatch({
      kind: "key",
      type,
      key: c,
      code: c,
      native: new KeyboardEvent(`key${type}`, { code: c }),
    });

  const pointer = (game: GameInstance, type: "down" | "move" | "up", x: number, y: number) =>
    game.router.dispatch({
      kind: "pointer",
      type,
      screen: { x, y },
      button: type === "move" ? -1 : 0,
      deltaY: 0,
      native: new MouseEvent(`pointer${type}`),
    });

  async function seated() {
    const pad = fakePad();
    const { game: def, seen } = seatGame();
    const game = await editing(def);
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    return { pad, def, seen, game, recorded };
  }

  it("records pads, the pointer, a command and two seats, and replays them to the same digest", async () => {
    const { pad, def, seen, game, recorded } = await seated();
    const doc = yard();
    expect(game.play(doc)).toMatchObject({ ok: true });
    pointer(game, "move", 40, 30);
    code(game, "KeyD");
    game.step(3);
    pad.axes[0] = 0.8;
    code(game, "ArrowLeft");
    game.step(4);
    pointer(game, "down", 60, 30);
    expect(game.send({ name: "shove", args: { by: 2 } })).toBe(true);
    game.step(2);
    pointer(game, "move", 90, 50);
    pad.axes[0] = -0.5;
    game.step(3);
    pointer(game, "up", 90, 50);
    code(game, "KeyD", "up");
    code(game, "ArrowLeft", "up");
    pad.axes[0] = 0;
    game.step(4);
    game.stop();
    expect(recorded).toHaveLength(1);
    const rec = recorded[0]!;
    const live = seen.splice(0);
    expect(live).toHaveLength(16);

    expect(rec).toMatchObject({ v: 2, ticks: 16, outcome: { result: "quit", tick: 15 } });
    expect(rec.platform.arch).toBe("unknown");
    expect(rec.players[0]).toEqual({
      index: 0,
      devices: expect.arrayContaining(["keyboard", "pointer"]),
    });
    const kinds = (seat: number) => new Set(rec.inputs[seat]!.map((e) => e[1]));
    expect(kinds(0)).toEqual(new Set(["b", "p", "c"]));
    expect(kinds(1)).toEqual(new Set(["b", "a"]));
    expect(rec.system).toContainEqual([0, "j", 1, "pad:0"]);
    // Pointer samples only on the ticks it changed: the move, the press, the drag, the release.
    expect(rec.inputs[0]!.filter((e) => e[1] === "p").map((e) => e[0])).toEqual([0, 7, 9, 12]);

    // The replay steps the recording, whatever the live devices do meanwhile.
    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    pointer(game, "move", 300, 200);
    pointer(game, "down", 300, 200);
    code(game, "ArrowRight");
    pad.axes[0] = 1;
    expect(game.send({ name: "shove", args: { by: 9 } })).toBe(false);
    game.step(rec.ticks);
    expect(recorded).toHaveLength(2);
    expect(game.getStore().state.sim.paused).toBe(true);
    expect(recorded[1]!.end).toBe(rec.end);
    expect(recorded[1]!.inputs).toEqual(rec.inputs);
    expect(recorded[1]!.system).toEqual(rec.system);
    // The attachment saw the recorded pointer on every replayed tick, never the live one.
    expect(seen).toEqual(live);

    const headless = replayRecording({ rapier, game: def, scene: doc, recording: rec });
    if (headless.blocked) throw new Error("replay blocked");
    expect(headless.matches, headless.divergence ?? "").toBe(true);
  });

  it("names the browser's architecture, read once at createGame", async () => {
    const getHighEntropyValues = vi.fn(async () => ({ architecture: "arm", bitness: "64" }));
    Object.defineProperty(navigator, "userAgentData", {
      configurable: true,
      value: { getHighEntropyValues },
    });
    onTestFinished(() => void delete (navigator as { userAgentData?: unknown }).userAgentData);
    const { game, recorded } = await seated();
    for (let i = 0; i < 2; i++) {
      game.play(yard());
      game.step(2);
      game.stop();
    }
    expect(recorded.map((r) => r.platform.arch)).toEqual(["arm64", "arm64"]);
    expect(getHighEntropyValues).toHaveBeenCalledTimes(1);
  });

  it("carries the host's Rapier flavour and project snapshot", async () => {
    const game = await createGame(document.querySelector("canvas")!, {
      game: testGame,
      registry,
      rapier: async () => rapier,
      scene: yard(),
      recording: {
        platform: { flavour: "@dimforge/rapier2d-compat" },
        projectRef: { id: "yard", snapshot: "abc123" },
      },
    });
    games.push(game);
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    game.play(yard());
    game.step(2);
    game.stop();
    expect(recorded[0]?.platform).toMatchObject({
      runtime: "browser",
      flavour: "@dimforge/rapier2d-compat",
    });
    expect(recorded[0]?.project).toEqual({ id: "yard", snapshot: "abc123" });
  });
});

describe("browserArch", () => {
  it("maps client hints to process.arch names, and anything it can't read to unknown", async () => {
    const hints = (values: unknown) =>
      vi.stubGlobal("navigator", { userAgentData: { getHighEntropyValues: async () => values } });
    hints({ architecture: "x86", bitness: "64" });
    expect(await browserArch()).toBe("x64");
    hints({ architecture: "arm", bitness: "64" });
    expect(await browserArch()).toBe("arm64");
    hints({ architecture: "arm", bitness: "32" });
    expect(await browserArch()).toBe("arm");
    hints({ architecture: "" });
    expect(await browserArch()).toBe("unknown");
    vi.stubGlobal("navigator", {
      userAgentData: {
        getHighEntropyValues: () => Promise.reject(new Error("denied")),
      },
    });
    expect(await browserArch()).toBe("unknown");
    vi.stubGlobal("navigator", {});
    expect(await browserArch()).toBe("unknown");
  });
});
