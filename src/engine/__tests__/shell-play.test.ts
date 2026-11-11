// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { TimeModel } from "../game/time";
import type { GameAttachment, GameCommand, GameDefinition } from "../game/types";
import { replayRecording } from "../headless/recording";
import type { SceneRuntimeHandle, StepResult } from "../runtime/types";
import { formatScene } from "../scene/format";
import { sceneHash } from "../scene/hash";
import { parseSceneOrThrow } from "../scene/parse";
import type { RunRecording } from "../scene/recording-schema";
import type { SceneDefinition } from "../scene/types";
import engineYardJson from "../scenes/engine-yard.json";
import type { ToolEvent } from "../tool-router";
import type { GameConfig, GameInstance, PlayOutcome, RapierModule } from "../types";
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

const registry = createRegistry(testGame);
const yard = (): SceneDefinition => parseSceneOrThrow(engineYardJson, registry);

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

const games: GameInstance[] = [];
let canvas: HTMLCanvasElement;

beforeEach(() => {
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function makeGame(config: Partial<GameConfig> = {}): Promise<GameInstance> {
  const instance = await createGame(canvas, {
    game: testGame,
    registry: config.game ? undefined : registry,
    rapier: async () => rapier,
    scene: yard(),
    ...config,
  });
  games.push(instance);
  return instance;
}

/** Into edit mode, as the editor opens. */
async function editing(config: Partial<GameConfig> = {}): Promise<GameInstance> {
  const game = await makeGame(config);
  game.start();
  game.stop();
  expect(game.getMode()).toBe("edit");
  return game;
}

/** The loaded world, with the handle's `ctx` and `scene()`. */
const world = (game: GameInstance) => game.runtime() as SceneRuntimeHandle | null;

const press = (key: string, type: "down" | "up" = "down"): ToolEvent => ({
  kind: "key",
  type,
  key,
  native: new KeyboardEvent(`key${type}`, { key }),
});

function recordSteps(game: GameInstance): StepResult[] {
  const steps: StepResult[] = [];
  game.on("scene:step", (r) => steps.push(structuredClone(r)));
  return steps;
}

const speed = (step: StepResult) => (step.game as { velocity: { x: number } }).velocity.x;

/** Play, hold right, run `ticks` ticks; the steps it produced. */
function run(game: GameInstance, doc: SceneDefinition, ticks: number): StepResult[] {
  const steps: StepResult[] = [];
  const record = (r: StepResult) => steps.push(structuredClone(r));
  game.on("scene:step", record);
  expect(game.play(doc)).toMatchObject({ ok: true });
  game.router.dispatch(press("d"));
  game.step(ticks);
  game.off("scene:step", record);
  return steps;
}

describe("Play and Stop", () => {
  it("leaves the document byte-identical across a session", async () => {
    const game = await editing({ dev: true });
    const doc = yard();
    const text = formatScene(doc).text;
    const hash = sceneHash(doc);

    run(game, doc, 200);
    game.stop();
    expect(formatScene(doc).text).toBe(text);
    expect(sceneHash(doc)).toEqual(hash);
    expect(Object.isFrozen(doc)).toBe(false);
  });

  it("gives identical first 120 ticks on play, edit, play", async () => {
    const game = await editing();
    const doc = yard();
    const first = run(game, doc, 120);
    game.stop();
    const second = run(game, doc, 120);

    expect(first).toHaveLength(120);
    expect(first[0]!.tick).toBe(0);
    expect(second).toStrictEqual(first);
    const moved = first.at(-1)!.game as { position: { x: number } };
    expect(moved.position.x).toBeGreaterThan(5);
  });

  it("builds a fresh world per Play and rebuilds the edit world on Stop", async () => {
    const game = await editing();
    const edit = world(game);
    const editScene = edit!.scene();
    game.play(yard());
    const played = world(game);
    expect(played).not.toBe(edit);
    expect(played!.ctx.play).toEqual({ timeOffsetMs: 0 });
    game.step(30);

    game.stop();
    const rebuilt = world(game)!;
    expect(rebuilt).not.toBe(played);
    expect(rebuilt.ctx.play).toBeNull();
    expect(rebuilt.scene()).toStrictEqual(editScene);
    expect(game.getStore().state.mode).toBe("edit");
  });

  it("loads the authored scene on Play and Stop, leaving out what game code spawned", async () => {
    const loadedRuntimeIds: string[][] = [];
    const spawning: GameDefinition = {
      ...testGame,
      createRuntime(ctx) {
        const inner = testGame.createRuntime(ctx);
        return {
          ...inner,
          onLoad(scene) {
            inner.onLoad?.(scene);
            loadedRuntimeIds.push(
              scene.entities.filter((e) => e.id.includes("#")).map((e) => e.id),
            );
            ctx.spawn({ type: "marker", at: [300, 900] });
          },
        };
      },
    };
    const game = await editing({ game: spawning });
    const editScene = world(game)!.scene()!;
    expect(editScene.entities.filter((e) => e.id.includes("#")).map((e) => e.id)).toEqual([
      "marker#1",
    ]);
    game.setMode("play");
    game.step(5);
    game.stop();
    expect(world(game)!.scene()).toStrictEqual(editScene);
    game.play(yard());
    game.stop();
    expect(world(game)!.scene()).toStrictEqual(editScene);
    expect(loadedRuntimeIds.every((ids) => ids.length === 0)).toBe(true);
  });

  it("throws on a mutation of the frozen play document in dev, and not outside it", async () => {
    let mutated = 0;
    const mutating: GameDefinition = {
      ...testGame,
      createRuntime(ctx) {
        const inner = testGame.createRuntime(ctx);
        return {
          ...inner,
          onLoad(scene) {
            inner.onLoad?.(scene);
            if (!ctx.play) return;
            (scene.entities[0] as { name?: string }).name = "renamed";
            mutated++;
          },
        };
      },
    };
    const dev = await editing({ game: mutating, dev: true });
    const report = dev.play(yard());
    expect(report).toMatchObject({
      ok: false,
      error: expect.stringMatching(/read.only|frozen|not extensible/i),
    });
    expect(dev.getMode()).toBe("edit");
    expect(mutated).toBe(0);

    const prod = await editing({ game: mutating, dev: false });
    expect(prod.play(yard()).ok).toBe(true);
    expect(mutated).toBe(1);
  });

  it("blocks Play on validation errors and keeps the edit world", async () => {
    const game = await editing();
    const edit = world(game);
    const doc = yard();
    doc.entities!.push({ ...doc.entities![1]! });
    const report = game.play(doc);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.severity === "error")).toBe(true);
    expect(game.getMode()).toBe("edit");
    expect(world(game)).toBe(edit);
    expect(game.getStore().state.session).toBeNull();
  });

  it("plays from a point, cast onto the floor, and refuses one inside a solid", async () => {
    const game = await editing();
    const ok = game.play(yard(), { at: { x: 6, y: 5 } });
    expect(ok.ok).toBe(true);
    // The floor's top is y 9.6; the avatar's half-height is 0.2.
    expect(world(game)!.ctx.play?.at?.x).toBe(6);
    expect(world(game)!.ctx.play?.at?.y).toBeCloseTo(9.4, 6);
    game.stop();

    const edit = world(game);
    const blocked = game.play(yard(), { at: { x: 10, y: 9.8 } });
    expect(blocked).toMatchObject({ ok: false, reason: "spawn-blocked" });
    expect(blocked.ok ? "" : blocked.error).toMatch(/inside a solid/);
    expect(game.getMode()).toBe("edit");
    expect(world(game)).toBe(edit);
  });

  it("flushes input at Play, so a key pressed before it never reaches tick 0", async () => {
    const game = await editing();
    game.play(yard());
    game.router.dispatch(press("d"));
    const steps = recordSteps(game);
    // A restart is a fresh Play: the held key is dropped with the old world.
    game.play(yard());
    game.step(5);
    expect(steps.map(speed)).toEqual([0, 0, 0, 0, 0]);
  });

  it("snaps the camera to the game's target at Play and restores the editor camera exactly on Stop", async () => {
    const targeted: GameDefinition = {
      ...testGame,
      createRuntime(ctx) {
        const inner = testGame.createRuntime(ctx);
        return { ...inner, cameraTarget: () => inner.snapshot()?.position ?? null };
      },
    };
    const game = await editing({ game: targeted });
    const before = structuredClone(game.getStore().state.camera);
    expect(before.mode).toBe("free");

    game.play(yard(), { at: { x: 15, y: 3 } });
    const camera = game.getStore().state.camera;
    expect(camera.mode).toBe("follow");
    expect(camera.position).not.toEqual(before.position);
    game.step(60);

    game.stop();
    expect(game.getStore().state.camera).toStrictEqual(before);
  });

  it("keeps the remembered edit world across a restart", async () => {
    const game = await editing();
    const edit = world(game)!.scene();
    game.play(yard());
    const moved = yard();
    moved.entities = moved.entities!.filter((e) => e.id !== "crate");
    game.play(moved);
    expect(world(game)!.get("crate")).toBeUndefined();
    game.stop();
    expect(world(game)!.scene()).toStrictEqual(edit);
  });
});

describe("the play session", () => {
  it("records the game's first verdict with its tick and keeps playing", async () => {
    const game = await editing();
    const outcomes: PlayOutcome[] = [];
    game.on("play:outcome", (o) => outcomes.push(o));
    game.play(yard());
    expect(game.getStore().state.session).toEqual({ startTick: 0, outcome: null });
    game.router.dispatch(press("d"));
    game.step(200);

    const { session, mode } = game.getStore().state;
    expect(mode).toBe("play");
    expect(session?.outcome).toMatchObject({ result: "won", entityId: "zone" });
    expect(outcomes).toEqual([session!.outcome]);
    expect(session!.outcome!.tick).toBeGreaterThan(60);
    expect(session!.outcome!.tick).toBeLessThan(120);

    game.stop();
    expect(game.getStore().state.session).toBeNull();
    game.play(yard());
    expect(game.getStore().state.session).toEqual({ startTick: 200, outcome: null });
  });

  it("judges the outcome with the live world's exists and count", async () => {
    const seen: { crate: boolean; ledge: boolean; anyLedge: boolean; props: number }[] = [];
    const judged: GameDefinition = {
      ...testGame,
      createRuntime(ctx) {
        const inner = testGame.createRuntime(ctx);
        let ticks = 0;
        return {
          ...inner,
          beforeStep(...args) {
            inner.beforeStep?.(...args);
            if (++ticks === 5) {
              ctx.destroy("crate");
              ctx.setEnabled("ledge", false);
            }
          },
        };
      },
      play: {
        ...testGame.play!,
        outcome({ world }) {
          if (!world) return null;
          seen.push({
            crate: world.exists("crate"),
            ledge: world.exists("ledge"),
            anyLedge: world.exists("ledge", { enabled: false }),
            props: world.count({ type: "prop" }),
          });
          return world.exists("crate") ? null : { result: "won", cause: "the crate is gone" };
        },
      },
    };
    const game = await editing({ game: judged });
    game.play(yard());
    game.step(10);

    expect(seen[0]).toEqual({ crate: true, ledge: true, anyLedge: true, props: 2 });
    expect(seen.at(-1)).toEqual({ crate: false, ledge: false, anyLedge: true, props: 1 });
    expect(game.getStore().state.session?.outcome).toMatchObject({
      result: "won",
      cause: "the crate is gone",
    });
  });
});

describe("simulation controls", () => {
  it("pauses, steps keys pressed while paused, scales time and resets on Stop", async () => {
    const game = await editing();
    game.play(yard());
    game.pause();
    expect(game.getStore().state.sim.paused).toBe(true);

    const steps = recordSteps(game);
    game.router.dispatch(press("d"));
    game.step();
    expect(steps).toHaveLength(1);
    expect(speed(steps[0]!)).toBeGreaterThan(0);

    game.setTimeScale(0.25);
    expect(game.getStore().state.sim.timeScale).toBe(0.25);
    expect(() => game.setTimeScale(-1)).toThrow(RangeError);

    game.stop();
    expect(game.getStore().state.sim).toEqual({ paused: false, timeScale: 1 });
    game.step(3);
    expect(steps).toHaveLength(1);
  });

  it("resumes", async () => {
    const game = await editing();
    game.play(yard());
    game.pause();
    game.resume();
    expect(game.getStore().state.sim.paused).toBe(false);
  });
});

describe("game commands", () => {
  function commandGame() {
    const commands: string[] = [];
    let selection = true;
    const game: GameDefinition = {
      ...testGame,
      attach(): GameAttachment {
        return {
          onCommand: (name) => (commands.push(name), name === "test:one"),
          onCancel: () => {
            const had = selection;
            selection = false;
            return had;
          },
          destroy() {},
        };
      },
    };
    return { game, commands };
  }

  it("go to the attachment, and Escape is offered to the game only in play", async () => {
    const { game: def, commands } = commandGame();
    const game = await editing({ game: def });
    expect(game.command("test:one")).toBe(true);
    expect(game.command("other")).toBe(false);
    expect(commands).toEqual(["test:one", "other"]);
    expect(game.cancel()).toBe(false);

    game.play(yard());
    expect(game.cancel()).toBe(true);
    expect(game.cancel()).toBe(false);
  });
});

describe("DOM to world", () => {
  it("follows document-wide moves into the pointer sample only while trackPointer is on", async () => {
    const mouse: { x: number; y: number }[] = [];
    const def: GameDefinition = {
      ...testGame,
      attach: () => ({ onTick: (_dt, at) => void mouse.push(at), destroy() {} }),
    };
    const game = await makeGame({ game: def });
    canvas.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 50,
        right: 740,
        bottom: 410,
        width: 640,
        height: 360,
        x: 100,
        y: 50,
      }) as DOMRect;
    const hud = document.createElement("div");
    document.body.appendChild(hud);
    const move = (clientX: number, clientY: number) =>
      hud.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY, bubbles: true }));
    game.play(yard());

    move(300, 200);
    expect(game.pointerWorld()).toBeNull();

    game.input.trackPointer(true);
    move(300, 200);
    const inside = game.clientToWorld(300, 200);
    expect(game.pointerWorld()).toEqual(inside);
    game.step();
    expect(mouse.at(-1)!.x).toBeCloseTo(inside.x, 4);
    expect(mouse.at(-1)!.y).toBeCloseTo(inside.y, 4);

    // Off the canvas it still moves, so a drag from the HUD shows in the world.
    move(20, 20);
    expect(game.pointerWorld()).toEqual(game.clientToWorld(20, 20));

    game.input.trackPointer(false);
    move(400, 300);
    expect(game.pointerWorld()).toEqual(game.clientToWorld(20, 20));
  });
});

describe("send", () => {
  /** The test game with two commands, logging the commands each step delivers. */
  function sendingGame(time?: TimeModel) {
    const delivered: GameCommand[][] = [];
    const game: GameDefinition = {
      ...testGame,
      ...(time ? { time } : {}),
      commands: {
        shove: {
          description: "Moves something by `by`.",
          args: z.strictObject({ by: z.number().int() }),
        },
        wait: { description: "Takes no args." },
      },
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            delivered.push([...commands]);
            base.beforeStep?.(dtMs, actions, commands);
          },
        };
      },
    };
    return { game, delivered };
  }

  /** Drives the loop's frames by hand, from before the game is made. */
  function manualFrames() {
    let pending: FrameRequestCallback[] = [];
    let now = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
    return (ms: number) => {
      for (let t = 0; t < ms; t += 1000 / 120) {
        now += 1000 / 120;
        const due = pending;
        pending = [];
        for (const cb of due) cb(now);
      }
    };
  }

  it("returns false with a dev warning while editing, and queues nothing for Play", async () => {
    const { game: def, delivered } = sendingGame();
    const game = await editing({ game: def, dev: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(game.send({ name: "shove", args: { by: 1 } })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/send\("shove"\).*nothing is playing/));
    warn.mockRestore();

    expect(game.play(yard()).ok).toBe(true);
    game.step(1);
    expect(delivered).toEqual([[]]);
  });

  it("delivers a command on the next simulated tick, once, in the order sent", async () => {
    const { game: def, delivered } = sendingGame();
    const game = await editing({ game: def });
    expect(game.play(yard()).ok).toBe(true);
    game.step(2);
    expect(game.send({ name: "shove", args: { by: 3 } })).toBe(true);
    expect(game.send({ name: "wait" })).toBe(true);
    expect(delivered).toHaveLength(2);
    game.step(2);
    expect(delivered).toEqual([[], [], [{ name: "shove", args: { by: 3 } }, { name: "wait" }], []]);
  });

  it("refuses an unknown name and args that don't fit the command's schema", async () => {
    const { game: def, delivered } = sendingGame();
    const game = await editing({ game: def, dev: true });
    game.play(yard());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(game.send({ name: "shovee" })).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/unknown command "shovee"; did you mean "shove"\?.*shove/),
    );
    expect(game.send({ name: "shove", args: { by: 1.5 } })).toBe(false);
    expect(game.send({ name: "shove", args: { by: 1, extra: true } })).toBe(false);
    expect(game.send({ name: "shove" })).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/bad args for shove/));
    expect(game.send({ name: "wait", args: {} })).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/takes no args/));
    expect(game.send({ name: "@elapsed", args: { ms: -1 } })).toBe(false);
    warn.mockRestore();
    game.step(1);
    expect(delivered).toEqual([[]]);
  });

  it("refuses @elapsed in a game without time.catchUp", async () => {
    const { game: def, delivered } = sendingGame();
    const game = await editing({ game: def, dev: true });
    game.play(yard());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(game.send({ name: "@elapsed", args: { ms: 10_000_000 } })).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/no time\.catchUp/));
    warn.mockRestore();
    game.step(1);
    expect(delivered).toEqual([[]]);
  });

  it("clamps a sent @elapsed to catchUp.maxMs, as elapse() does", async () => {
    const { game: def, delivered } = sendingGame({ kind: "fixed", catchUp: { maxMs: 2000 } });
    const game = await editing({ game: def });
    game.play(yard());
    expect(game.send({ name: "@elapsed", args: { ms: 10_000_000 } })).toBe(true);
    expect(game.send({ name: "@elapsed", args: { ms: 500 } })).toBe(true);
    game.elapse(10_000_000);
    game.step(1);
    expect(delivered).toEqual([
      [
        { name: "@elapsed", args: { ms: 2000 } },
        { name: "@elapsed", args: { ms: 500 } },
        { name: "@elapsed", args: { ms: 2000 } },
      ],
    ]);
  });

  it("hands the game's shell the same send", async () => {
    const { game: def, delivered } = sendingGame();
    let shellSend: ((c: GameCommand) => boolean) | null = null;
    const game = await editing({
      game: {
        ...def,
        attach(shell) {
          shellSend = shell.send;
          return { destroy() {} };
        },
      },
    });
    game.play(yard());
    expect(shellSend!({ name: "shove", args: { by: -2 } })).toBe(true);
    game.step(1);
    expect(delivered).toEqual([[{ name: "shove", args: { by: -2 } }]]);
  });

  it("drops what was queued when Play restarts or stops", async () => {
    const { game: def, delivered } = sendingGame();
    const game = await editing({ game: def });
    game.play(yard());
    game.send({ name: "wait" });
    game.play(yard());
    game.step(1);
    game.send({ name: "wait" });
    game.stop();
    game.play(yard());
    game.step(1);
    expect(delivered).toEqual([[], []]);
  });

  it("never ticks a turns game with no command, and wakes it for one tick per command", async () => {
    const wall = manualFrames();
    const { game: def, delivered } = sendingGame({ kind: "turns", rate: 30 });
    const game = await makeGame({ game: def });
    game.start();
    expect(game.play(yard()).ok).toBe(true);
    wall(2000);
    game.router.dispatch(press("d"));
    wall(500);
    expect(delivered).toEqual([]);
    expect(game.getStore().state.tick).toBe(0);

    expect(game.send({ name: "shove", args: { by: 1 } })).toBe(true);
    wall(1000);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toEqual([{ name: "shove", args: { by: 1 } }]);
    game.send({ name: "wait" });
    wall(1000);
    expect(delivered.map((c) => c.map((x) => x.name))).toEqual([["shove"], ["wait"]]);
  });

  it("wakes an event game on a command, as on a button edge", async () => {
    const wall = manualFrames();
    const { game: def, delivered } = sendingGame({ kind: "event", rate: 30 });
    const game = await makeGame({ game: def });
    game.start();
    game.play(yard());
    wall(500);
    expect(delivered).toEqual([]);
    game.send({ name: "wait" });
    wall(500);
    expect(delivered).toEqual([[{ name: "wait" }]]);
  });
});

describe("commands per seat", () => {
  /** Two seats; each step's commands land in `delivered` and the snapshot, so the digest covers them. */
  function seatedGame() {
    const delivered: [number, GameCommand[]][] = [];
    let shellSend: ((c: GameCommand) => boolean) | null = null;
    const game: GameDefinition = {
      ...testGame,
      input: { players: { max: 2, join: "host" } },
      commands: {
        shove: { description: "Moves by `by`.", args: z.strictObject({ by: z.number() }) },
        drop: { description: "A card dropped from the page." },
      },
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        const seen: string[] = [];
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            if (commands.length > 0) delivered.push([ctx.tick, structuredClone([...commands])]);
            for (const c of commands) seen.push(`${ctx.tick}:${c.player ?? 0}:${c.name}`);
            base.beforeStep?.(dtMs, actions, commands);
          },
          snapshot() {
            const snap = base.snapshot?.();
            return snap ? { ...snap, seen: [...seen] } : null;
          },
        };
      },
      attach(shell) {
        shellSend = shell.send;
        return { destroy() {} };
      },
    };
    return { game, delivered, shellSend: (c: GameCommand) => shellSend!(c) };
  }

  it("records each send as a c event on its seat and replays it in the shell and headless", async () => {
    const { game: def, delivered, shellSend } = seatedGame();
    const game = await editing({ game: def });
    const recorded: RunRecording[] = [];
    game.on("play:recorded", (r) => recorded.push(r));
    const doc = yard();

    expect(game.play(doc)).toMatchObject({ ok: true });
    game.step(2);
    // The host's send, the game's shell and a page drop all go through one queue.
    expect(game.send({ name: "shove", args: { by: 1 }, player: 1 })).toBe(true);
    expect(shellSend({ name: "shove", args: { by: 2 } })).toBe(true);
    expect(game.send({ name: "drop", player: 0 })).toBe(true);
    game.step(3);
    expect(shellSend({ name: "drop", player: 1 })).toBe(true);
    game.step(2);
    game.stop();

    expect(recorded).toHaveLength(1);
    const rec = recorded[0]!;
    expect(rec.commands).toEqual(["shove", "drop"]);
    const cs = (seat: number) => (rec.inputs[seat] ?? []).filter((e) => e[1] === "c");
    expect(cs(0)).toEqual([
      [2, "c", 0, { by: 2 }],
      [2, "c", 1],
    ]);
    expect(cs(1)).toEqual([
      [2, "c", 0, { by: 1 }],
      [5, "c", 1],
    ]);
    // Seat 0 first, then seat 1, each in the order sent: the order a replay decodes.
    const live = structuredClone(delivered);
    expect(live).toEqual([
      [
        2,
        [
          { name: "shove", args: { by: 2 } },
          { name: "drop" },
          { name: "shove", args: { by: 1 }, player: 1 },
        ],
      ],
      [5, [{ name: "drop", player: 1 }]],
    ]);

    delivered.length = 0;
    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    expect(game.send({ name: "drop", player: 1 })).toBe(false);
    game.step(rec.ticks);
    expect(delivered).toEqual(live);
    expect(recorded).toHaveLength(2);
    expect(recorded[1]!.inputs).toEqual(rec.inputs);
    expect(recorded[1]!.end).toBe(rec.end);

    const headless = replayRecording({ rapier, game: def, scene: doc, recording: rec });
    if (headless.blocked) throw new Error("replay blocked");
    expect(headless.matches, headless.divergence ?? "").toBe(true);
  });

  it("refuses a seat past max with player-unknown, queueing nothing", async () => {
    const { game: def, delivered, shellSend } = seatedGame();
    const game = await editing({ game: def, dev: true });
    game.play(yard());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(game.send({ name: "drop", player: 2 })).toBe(false);
    expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/send\("drop"\): player-unknown/));
    expect(shellSend({ name: "drop", player: -1 })).toBe(false);
    expect(game.send({ name: "drop", player: 0.5 })).toBe(false);
    warn.mockRestore();
    game.step(1);
    expect(delivered).toEqual([]);
  });

  it("puts a one-seat game's seat 1 past max", async () => {
    const { game: def, delivered } = (() => {
      const seated = seatedGame();
      const { input: _input, ...rest } = seated.game;
      return { ...seated, game: rest };
    })();
    const game = await editing({ game: def });
    game.play(yard());
    expect(game.send({ name: "drop", player: 1 })).toBe(false);
    expect(game.send({ name: "drop" })).toBe(true);
    game.step(1);
    expect(delivered).toEqual([[0, [{ name: "drop" }]]]);
  });
});

describe("setMode", () => {
  it("plays the loaded scene and stops back to it", async () => {
    const game = await editing();
    const edit = world(game)!.scene();
    game.setMode("play");
    expect(game.getMode()).toBe("play");
    expect(world(game)!.ctx.play).not.toBeNull();
    game.setMode("edit");
    expect(game.getMode()).toBe("edit");
    expect(world(game)!.scene()).toStrictEqual(edit);
  });
});

describe("key target", () => {
  it("routes keys from the key target but keeps play input to the input target's focus", async () => {
    const shell = document.createElement("div");
    const panel = document.createElement("button");
    shell.append(canvas, panel);
    document.body.appendChild(shell);
    const game = await makeGame({ keyTarget: shell });
    game.start();
    const seen: { key: string; outside: boolean }[] = [];
    game.router.register({
      id: "spy",
      priority: 1000,
      accepts(e) {
        if (e.kind === "key") seen.push({ key: e.key, outside: e.outsideTarget === true });
        return false;
      },
      handle() {},
    });
    const steps = recordSteps(game);

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    game.step();
    expect(seen).toEqual([{ key: "d", outside: true }]);
    expect(speed(steps[0]!)).toBe(0);

    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    game.step();
    expect(seen.at(-1)).toEqual({ key: "d", outside: false });
    expect(speed(steps[1]!)).toBeGreaterThan(0);
  });

  it("offers a key typed into a field only to consumers that ask for it", async () => {
    const shell = document.createElement("div");
    const field = document.createElement("input");
    shell.append(canvas, field);
    document.body.appendChild(shell);
    const game = await makeGame({ keyTarget: shell });
    game.start();
    const plain: string[] = [];
    const typing: string[] = [];
    const spy = (id: string, log: string[], editable: boolean) =>
      game.router.register({
        id,
        priority: 1000,
        editable,
        accepts(e) {
          if (e.kind === "key" && e.type === "down") log.push(e.key);
          return false;
        },
        handle() {},
      });
    spy("plain", plain, false);
    spy("typing", typing, true);
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(plain).toEqual([]);
    expect(typing).toEqual(["x"]);
  });
});
