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
import { createRegistry, defineGame } from "../game/define";
import type { GameCommand, GameDefinition } from "../game/types";
import { replayRecording } from "../headless/recording";
import type { ReleaseManifest } from "../project/release";
import { parseSceneOrThrow } from "../scene/parse";
import { parseRecording, type RunRecording } from "../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import engineYardJson from "../scenes/engine-yard.json";
import type { ToolEvent } from "../tool-router";
import type { GameEventMap, GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { oneSceneVersion } from "./fixtures/live-version";
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
    const pad: { axes: number[]; pressed: boolean[]; timestamp?: number } = {
      axes: [0, 0, 0, 0],
      pressed: Array.from({ length: 17 }, () => false),
    };
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
          ...(pad.timestamp === undefined ? {} : { timestamp: pad.timestamp }),
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
  it("names the release it plays from, and none without one", async () => {
    const release = "5e".repeat(32);
    const project = { id: "yard", snapshot: "a1".repeat(32) };
    const manifest = { project: { ...project, name: "Yard" } } as ReleaseManifest;
    const game = await createGame(document.querySelector("canvas")!, {
      game: testGame,
      registry,
      rapier: async () => rapier,
      scene: yard(),
      release: { id: release, manifest },
    });
    games.push(game);
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    game.play(yard());
    game.step(2);
    game.stop();
    expect(recorded[0]?.release).toBe(release);
    expect(recorded[0]?.project).toEqual(project);
    expect(parseRecording(JSON.stringify(recorded[0]))).toMatchObject({ ok: true });

    const plain = session(await editing(), yard());
    expect(plain).not.toHaveProperty("release");
  });

  it("starts with the persistent value as Play found it, and replays from it to the same end", async () => {
    type Plays = { plays: number };
    const counted: GameDefinition<TestGameSnapshot> = {
      ...testGame,
      persist: {
        initial: () => ({ plays: 0 }),
        schema: z.strictObject({ plays: z.number().int().min(0) }),
      },
      createRuntime(ctx) {
        const inner = testGame.createRuntime(ctx);
        return {
          ...inner,
          onLoad(scene) {
            inner.onLoad?.(scene);
            ctx.persist.set({ plays: (ctx.persist.value as Plays).plays + 1 });
          },
        };
      },
    };
    const game = await editing(counted);
    const doc = yard();
    const first = session(game, doc);
    const second = session(game, doc);
    const plays = (r: RunRecording) => (r.start.persist as Plays | undefined)?.plays;
    expect(plays(first)).toBeTypeOf("number");
    // Stop loads the edit scene again, which counts too.
    expect(plays(second)).toBeGreaterThan(plays(first)!);
    expect(second.start).not.toHaveProperty("entry");
    expect(parseRecording(JSON.stringify(second))).toMatchObject({ ok: true });

    const replay = replayRecording<TestGameSnapshot>({
      rapier,
      game: counted,
      registry: createRegistry(counted),
      scene: doc,
      recording: second,
    });
    if (replay.blocked) throw new Error("replay blocked");
    expect(replay.matches, replay.divergence ?? "").toBe(true);
  });

  /** A game counting its loads in `persist`, noting the value each load found. */
  function countingGame() {
    type Plays = { plays: number };
    const found: number[] = [];
    const def: GameDefinition<TestGameSnapshot> = {
      ...testGame,
      persist: {
        initial: () => ({ plays: 0 }),
        schema: z.strictObject({ plays: z.number().int().min(0) }),
      },
      createRuntime(ctx) {
        const inner = testGame.createRuntime(ctx);
        return {
          ...inner,
          onLoad(scene) {
            inner.onLoad?.(scene);
            const { plays } = ctx.persist.value as Plays;
            found.push(plays);
            ctx.persist.set({ plays: plays + 1 });
          },
        };
      },
    };
    return { def, found, plays: (r: RunRecording) => (r.start.persist as Plays).plays };
  }

  it("replays in the browser from the recording's persistent value, not the instance's", async () => {
    const { def, found, plays } = countingGame();
    const game = await editing(def);
    const doc = yard();
    const first = session(game, doc);
    const later = session(game, doc);
    expect(plays(later)).toBeGreaterThan(plays(first));

    const replayed: RunRecording[] = [];
    game.on("play:recorded", (r) => replayed.push(r));
    found.length = 0;
    expect(game.replay(doc, first)).toMatchObject({ ok: true });
    expect(found).toEqual([plays(first)]);
    game.step(100);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.start.persist).toEqual(first.start.persist);
    expect(replayed[0]!.end).toBe(first.end);
  });

  it("refuses a replay whose start.persist the game's schema rejects, keeping the instance's value", async () => {
    const { def, found, plays } = countingGame();
    const game = await editing(def);
    const doc = yard();
    const rec = session(game, doc);
    const bad: RunRecording = { ...rec, start: { ...rec.start, persist: { plays: -1 } } };
    const report = game.replay(doc, bad);
    expect(report).toMatchObject({ ok: false });
    expect(report.ok ? "" : report.error).toMatch(
      /start\.persist doesn't match the game's persist schema/,
    );
    found.length = 0;
    const next = session(game, doc);
    expect(found[0]).toBe(plays(next));
    expect(plays(next)).toBeGreaterThan(plays(rec));
  });

  /** The seat game, also noting the order and offsets of the actions each tick hands `beforeStep`. */
  function orderGame(subTick: boolean) {
    const { game: seatDef } = seatGame();
    const seen: string[][] = [];
    const game: GameDefinition = {
      ...seatDef,
      input: { ...seatDef.input, subTick },
      createRuntime(ctx) {
        const base = seatDef.createRuntime(ctx);
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            if (actions.length > 0) {
              seen.push(
                actions.map((a) => `${ctx.tick}:${a.action}:${a.player ?? 0}:${a.offset ?? "-"}`),
              );
            }
            base.beforeStep?.(dtMs, actions, commands);
          },
        };
      },
    };
    return { game, seen };
  }

  async function ordered(subTick = false) {
    fakePad();
    const { game: def, seen } = orderGame(subTick);
    const game = await editing(def);
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    return { def, seen, game, recorded };
  }

  it("hands beforeStep a tick's actions seat by seat, live and on replay", async () => {
    const { def, seen, game, recorded } = await ordered();
    const doc = yard();
    expect(game.play(doc)).toMatchObject({ ok: true });
    code(game, "ArrowRight");
    code(game, "KeyD");
    game.step(2);
    code(game, "KeyD", "up");
    code(game, "ArrowRight", "up");
    game.step(2);
    game.stop();
    const live = seen.splice(0);
    expect(live).toEqual([
      ["0:right:0:-", "0:right:1:-"],
      ["2:right:0:-", "2:right:1:-"],
    ]);

    expect(game.replay(doc, recorded[0]!)).toMatchObject({ ok: true });
    game.step(recorded[0]!.ticks);
    expect(seen.splice(0)).toEqual(live);

    const headless = replayRecording({ rapier, game: def, scene: doc, recording: recorded[0]! });
    if (headless.blocked) throw new Error("replay blocked");
    expect(headless.matches, headless.divergence ?? "").toBe(true);
  });

  it("stamps live actions with their sub-tick offsets, and replays them to the same offsets", async () => {
    let now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    onTestFinished(() => clock.mockRestore());
    const { def, seen, game, recorded } = await ordered(true);
    const doc = yard();
    const tickMs = 1000 / 60;
    const at = (c: string, type: "down" | "up", timeStamp: number) => {
      const native = new KeyboardEvent(`key${type}`, { code: c });
      Object.defineProperty(native, "timeStamp", { value: timeStamp });
      game.router.dispatch({ kind: "key", type, key: c, code: c, native });
    };
    expect(game.play(doc)).toMatchObject({ ok: true });
    // The tick that steps at `now` closes the window [now - tickMs, now].
    now = 2000;
    at("KeyD", "down", now - tickMs * 0.75);
    at("ArrowRight", "down", now - tickMs * 0.25);
    game.step(1);
    now = 2100;
    at("KeyD", "up", now - tickMs * 3);
    at("ArrowRight", "up", now + 5);
    game.step(2);
    game.stop();
    const live = seen.splice(0);
    expect(live).toEqual([
      ["0:right:0:0.25", "0:right:1:0.75"],
      ["1:right:0:0", "1:right:1:0.999"],
    ]);
    const rec = recorded[0]!;
    expect(rec.inputs[0]!.filter((e) => e[1] === "b").map((e) => e[0])).toEqual([0.25, 1]);
    expect(rec.inputs[1]!.filter((e) => e[1] === "b").map((e) => e[0])).toEqual([0.75, 1.999]);

    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    game.step(rec.ticks);
    expect(seen.splice(0)).toEqual(live);

    const headless = replayRecording({ rapier, game: def, scene: doc, recording: rec });
    if (headless.blocked) throw new Error("replay blocked");
    expect(headless.matches, headless.divergence ?? "").toBe(true);
  });

  it("places a pad's change at the browser's update time, and at the tick without one", async () => {
    let now = 1000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    onTestFinished(() => clock.mockRestore());
    const { def, seen, game, recorded } = await ordered(true);
    const pad = fakePad();
    const doc = yard();
    const tickMs = 1000 / 60;
    expect(game.play(doc)).toMatchObject({ ok: true });
    now = 2000;
    pad.axes[0] = 1;
    pad.timestamp = now - tickMs * 0.5;
    game.step(1);
    now = 2100;
    pad.axes[0] = 0;
    pad.timestamp = undefined;
    game.step(1);
    now = 2200;
    pad.axes[0] = -1;
    pad.timestamp = 50;
    game.step(1);
    game.stop();
    const live = seen.splice(0);
    expect(live).toEqual([["0:steer:1:0.5"], ["1:steer:1:0.999"], ["2:steer:1:0.999"]]);

    const rec = recorded[0]!;
    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    game.step(rec.ticks);
    expect(seen.splice(0)).toEqual(live);
    const headless = replayRecording({ rapier, game: def, scene: doc, recording: rec });
    if (headless.blocked) throw new Error("replay blocked");
    expect(headless.matches, headless.divergence ?? "").toBe(true);
  });
});

describe("live versions in a play session", () => {
  /** A physics-free game that draws from `ctx.random` each tick and counts its markers into the snapshot. */
  const liveGame: GameDefinition = defineGame({
    id: "live-shell",
    types: [],
    actions: [],
    world: { physics: "none" },
    live: { timings: ["boundary", "now"] },
    createRuntime(ctx) {
      let score = 0;
      return {
        afterStep() {
          score += ctx.random.below(10) + (ctx.exists("well") ? 100 : 0);
        },
        onSwap() {
          score += ctx.random.below(1000);
        },
        snapshot: () => ({ score }),
      };
    },
  });

  const hall = (markers: readonly string[] = ["start"]): SceneDefinition => ({
    v: SCENE_FORMAT_VERSION,
    name: "hall",
    bounds: [0, 0, 10, 10],
    entities: markers.map((id, i) => ({ id, type: "marker", at: [1 + i, 1] })),
  });

  async function livePlay() {
    const game = await createGame(document.querySelector("canvas")!, {
      game: liveGame,
      scene: hall(),
    });
    games.push(game);
    game.start();
    game.stop();
    const recorded: RunRecording[] = [];
    const failed: GameEventMap["live:failed"][] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    game.on("live:failed", (f) => failed.push(f));
    const v = await oneSceneVersion(hall(["start", "well"]), liveGame);
    expect(await game.live.stage(v)).toEqual({ ok: true });
    const versions = (id: string) => (id === v.id ? v : null);
    return { game, recorded, failed, v, versions };
  }

  /** Plays `hall` for 10 ticks, swaps the version in `now`, plays 10 more and stops. */
  function nowSwap({ game, recorded, v }: Awaited<ReturnType<typeof livePlay>>): RunRecording {
    expect(game.play(hall())).toMatchObject({ ok: true });
    game.step(10);
    expect(game.live.activate("hall", v.id, "now")).toMatchObject({ timing: "now" });
    game.step(10);
    game.stop();
    return recorded.at(-1)!;
  }

  it("records a now swap, and replays it through the same apply to the same digest", async () => {
    const t = await livePlay();
    const rec = nowSwap(t);
    expect(rec).not.toHaveProperty("sceneVersion");
    expect(rec.swaps).toEqual([
      expect.objectContaining({ tick: 11, version: t.v.id, strategy: "reconcile", timing: "now" }),
    ]);
    expect(parseRecording(JSON.stringify(rec))).toMatchObject({ ok: true });

    const swapped: number[] = [];
    t.game.on("live:swapped", (s) => swapped.push(s.tick));
    expect(t.game.replay(hall(), rec, { versions: t.versions })).toMatchObject({ ok: true });
    t.game.step(11);
    expect(t.game.runtime()?.get("well")).toBeUndefined();
    t.game.step(30);
    expect(swapped).toEqual([11]);
    const replayed = t.recorded.at(-1)!;
    expect(replayed.end).toBe(rec.end);
    expect(replayed.swaps).toEqual(rec.swaps);
    expect(t.game.getStore().state.sim.paused).toBe(true);
    expect(t.failed).toEqual([]);

    // The swap made the version the scene's own; the replay put that back at Stop.
    t.game.stop();
    expect(t.game.live.current("hall")).toBe(t.v.id);
  });

  it("records the version a Play started on, and replays on it in place of the doc", async () => {
    const t = await livePlay();
    nowSwap(t);
    // The editor's doc as Live in Play left it: the version it built is the scene's own now.
    expect(t.game.play(hall(["start", "well"]))).toMatchObject({ ok: true });
    expect(t.game.runtime()?.get("well")).toBeDefined();
    t.game.step(15);
    t.game.stop();
    const rec = t.recorded.at(-1)!;
    expect(rec.sceneVersion).toBe(t.v.id);
    expect(rec).not.toHaveProperty("swaps");

    t.game.live.activate("hall", null, "next-load");
    expect(t.game.replay(hall(), rec, { versions: t.versions })).toMatchObject({ ok: true });
    expect(t.game.runtime()?.get("well")).toBeDefined();
    t.game.step(20);
    expect(t.recorded.at(-1)!.end).toBe(rec.end);
    expect(t.recorded.at(-1)!.sceneVersion).toBe(t.v.id);
    t.game.stop();
    expect(t.game.live.current("hall")).toBeNull();
  });

  it("doesn't start a replay whose start version is gone", async () => {
    const t = await livePlay();
    nowSwap(t);
    t.game.play(hall());
    t.game.step(5);
    t.game.stop();
    const rec = t.recorded.at(-1)!;
    expect(rec.sceneVersion).toBe(t.v.id);
    const before = t.recorded.length;

    const out = t.game.replay(hall(), rec, { versions: () => null });
    expect(out).toMatchObject({
      ok: false,
      issues: [{ code: "scene-version-removed", severity: "error" }],
    });
    expect(out.issues[0]!.message).toContain(`hall@${t.v.id.slice(0, 12)}`);
    expect(t.game.replay(hall(), rec)).toMatchObject({
      ok: false,
      issues: [{ code: "scene-version-removed" }],
    });
    expect(t.game.getMode()).toBe("edit");
    expect(t.recorded).toHaveLength(before);
  });

  it("stops a replay on the tick whose swap needs a version that is gone", async () => {
    const t = await livePlay();
    const rec = nowSwap(t);
    t.game.live.activate("hall", null, "next-load");

    expect(t.game.replay(hall(), rec, { versions: () => null })).toMatchObject({ ok: true });
    t.game.step(30);
    expect(t.failed).toEqual([
      {
        scene: "hall",
        version: t.v.id,
        issue: expect.objectContaining({ code: "scene-version-removed", detail: { tick: 11 } }),
      },
    ]);
    const stopped = t.recorded.at(-1)!;
    expect(stopped.outcome).toMatchObject({ result: "quit", tick: 10 });
    expect(stopped.ticks).toBe(11);
    expect(stopped).not.toHaveProperty("swaps");
    expect(t.game.getStore().state.sim.paused).toBe(true);
    expect(t.game.runtime()?.get("well")).toBeUndefined();
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
