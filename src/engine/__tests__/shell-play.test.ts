// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { GameAttachment, GameDefinition } from "../game/types";
import type { SceneRuntimeHandle, StepResult } from "../runtime/types";
import { formatScene } from "../scene/format";
import { sceneHash } from "../scene/hash";
import { parseSceneOrThrow } from "../scene/parse";
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
vi.mock("../assets", () => ({ initAssets: async () => {} }));

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
    expect(moved.position.x).toBeGreaterThan(500);
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
    const ok = game.play(yard(), { at: { x: 600, y: 500 } });
    expect(ok.ok).toBe(true);
    // The floor's top is y 960; the avatar's half-height is 20.
    expect(world(game)!.ctx.play?.at).toEqual({ x: 600, y: 940 });
    game.stop();

    const edit = world(game);
    const blocked = game.play(yard(), { at: { x: 1000, y: 980 } });
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

    game.play(yard(), { at: { x: 1500, y: 300 } });
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
