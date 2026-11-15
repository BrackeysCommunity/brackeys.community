// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { fakeAudioBackend } from "../audio/fake";
import type { AudioSystemOptions } from "../audio/system";
import { createDebugDrawSink } from "../debug/draw-sink";
import { debugTools, type DebugOverlay, type DebugTick } from "../debug/index";
import { createGame } from "../engine";
import { createRegistry, defineGame } from "../game/define";
import type { EngineContext, GameDefinition } from "../game/types";
import { createCheckpoints, type SeekWorld } from "../runtime/seek";
import { parseSceneOrThrow } from "../scene/parse";
import type { RunRecording } from "../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import engineYardJson from "../scenes/engine-yard.json";
import type { ToolEvent } from "../tool-router";
import type { GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { world } from "./fixtures/live-game";
import { oneSceneVersion, worldDigest } from "./fixtures/live-version";
import { testGame } from "./fixtures/test-game";

const audioTicks = vi.hoisted(() => ({ count: 0 }));

vi.mock("../audio/system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../audio/system")>();
  return {
    ...actual,
    createAudioSystem: (opts: AudioSystemOptions) => {
      const system = actual.createAudioSystem(opts);
      const tick = system.tick.bind(system);
      system.tick = (t, events, requests) => {
        audioTicks.count++;
        tick(t, events, requests);
      };
      return system;
    },
  };
});

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

/** Walks `p` by the held keys and folds the game's random stream into a counter; asks for a sound and a flash every 20 ticks. */
const walker: GameDefinition<{ n: number }> = defineGame({
  id: "walker",
  types: [],
  actions: [
    { action: "left", keys: ["a"], description: "Walk left." },
    { action: "right", keys: ["d"], description: "Walk right." },
  ],
  world: { physics: "none" },
  time: { kind: "fixed", rate: 60 },
  createRuntime(ctx: EngineContext) {
    let n = 0;
    return {
      afterStep() {
        const pose = ctx.poses.get("p");
        const dx = (ctx.input.held("right") ? 0.05 : 0) - (ctx.input.held("left") ? 0.05 : 0);
        if (pose) ctx.poses.set("p", pose.x + dx, pose.y, pose.rot);
        n = (n * 31 + (ctx.random.nextU32() % 1000)) % 1_000_003;
        if (ctx.tick % 20 === 0) {
          ctx.present.audio.play("blip");
          ctx.present.effects.flash({ color: 0xffffff, ms: 50 });
        }
      },
      snapshot: () => ({ n }),
      restore: (state) => {
        n = state.n;
      },
    };
  },
});

const LEAVE_AT = 150;

/** Asks the flow for another scene on tick `LEAVE_AT`. */
const leaver: GameDefinition<{ n: number }> = defineGame({
  ...walker,
  id: "leaver",
  createRuntime(ctx: EngineContext) {
    const inner = walker.createRuntime(ctx);
    return {
      ...inner,
      afterStep(...args) {
        inner.afterStep?.(...args);
        if (ctx.tick === LEAVE_AT) ctx.flow.request({ to: "next" });
      },
    };
  },
});

/** Draws a line at x = tick on every step, while a debug-draw layer shows it. */
const drawer: GameDefinition<{ n: number }> = defineGame({
  ...walker,
  id: "drawer",
  createRuntime(ctx: EngineContext) {
    const inner = walker.createRuntime(ctx);
    return {
      ...inner,
      afterStep(...args) {
        inner.afterStep?.(...args);
        if (ctx.debug.active) ctx.debug.line({ x: ctx.tick, y: 0 }, { x: ctx.tick, y: 1 });
      },
    };
  },
});

const walkDoc = (game = "walker"): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  game,
  name: "walk",
  bounds: [0, 0, 40, 20],
  settings: { physics: "none" },
  entities: [{ id: "p", type: "marker", at: [5, 5] }],
});

const key = (k: string, type: "down" | "up" = "down"): ToolEvent => ({
  kind: "key",
  type,
  key: k,
  native: new KeyboardEvent(`key${type}`, { key: k }),
});

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

const games: GameInstance[] = [];

beforeEach(() => {
  document.body.appendChild(document.createElement("canvas"));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  audioTicks.count = 0;
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function editing(
  game: GameDefinition,
  scene: SceneDefinition,
  debug?: () => DebugOverlay,
): Promise<GameInstance> {
  const instance = await createGame(document.querySelector("canvas")!, {
    game,
    registry: createRegistry(game),
    rapier: async () => rapier,
    audio: { backend: () => fakeAudioBackend() },
    scene,
    ...(debug ? { dev: true, debug } : {}),
  });
  games.push(instance);
  instance.start();
  instance.stop();
  return instance;
}

/** Plays `doc` with a walk pattern (by default right, rest, left, right), then Stop. */
function walkSession(
  game: GameInstance,
  doc: SceneDefinition,
  ticks: number,
  pattern: readonly (string | null)[] = ["d", null, "a", "d"],
): RunRecording {
  expect(game.play(doc)).toMatchObject({ ok: true });
  const shares = [0.3, 0.2, 0.25, 0.25];
  const legs = pattern.map((k, i) => [k, ticks * (shares[i] ?? 0)] as const);
  for (const [k, n] of legs) {
    if (k) game.router.dispatch(key(k));
    game.step(Math.round(n));
    if (k) game.router.dispatch(key(k, "up"));
  }
  game.stop();
  return game.recording()!;
}

/** What the play world holds now: its digest (entities, game, random, timers) and every pose. */
function stateOf(game: GameInstance, digest = true) {
  const rt = world(game);
  const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
    const p = rt.ctx.poses.get(id)!;
    return [id, p.x, p.y, p.rot];
  });
  return {
    tick: rt.ctx.tick,
    poses,
    game: rt.snapshot(),
    ...(digest ? { digest: worldDigest(rt) } : {}),
  };
}

/** The state a plain replay reaches by stepping `n` ticks. */
function stepped(
  game: GameInstance,
  doc: SceneDefinition,
  rec: RunRecording,
  n: number,
  opts = {},
) {
  expect(game.replay(doc, rec, { paused: true, ...opts })).toMatchObject({ ok: true });
  game.step(n);
  return stateOf(game, !("rapier" in opts));
}

describe("seeking a replay", () => {
  it("on a physics-free scene: seek to 300 equals stepping 300, digest and poses, from checkpoints", async () => {
    const doc = walkDoc();
    const game = await editing(walker as GameDefinition, doc);
    const rec = walkSession(game, doc, 900);
    expect(rec.ticks).toBe(900);
    const at300 = stepped(game, doc, rec, 300);
    const at450 = stepped(game, doc, rec, 450);
    const at700 = stepped(game, doc, rec, 700);

    expect(game.replay(doc, rec, { paused: true })).toMatchObject({ ok: true });
    const handle = game.replayHandle()!;
    expect(handle.ticks).toBe(900);
    await handle.seek(300);
    expect(stateOf(game)).toEqual(at300);
    expect(handle.checkpoints).toEqual([0, 300]);

    await handle.seek(700);
    expect(stateOf(game)).toEqual(at700);
    expect(handle.checkpoints).toEqual([0, 300, 600]);

    // Back to 300 restores its checkpoint and steps nothing.
    await handle.seek(300);
    expect(handle.progress).toEqual({ target: 300, from: 300, tick: 300 });
    expect(stateOf(game)).toEqual(at300);

    // 450 restores 300 and re-simulates 150 ticks.
    await handle.seek(450);
    expect(handle.progress).toEqual({ target: 450, from: 300, tick: 450 });
    expect(stateOf(game)).toEqual(at450);
    expect(handle.tick).toBe(450);
    expect(game.getStore().state.sim.paused).toBe(true);

    // Playing on from a sought tick steps the replay's own input.
    game.step(250);
    expect(stateOf(game)).toEqual(at700);
  }, 30_000);

  it("a backward seek restores the checkpoint at or before the target", async () => {
    const doc = walkDoc();
    const game = await editing(walker as GameDefinition, doc);
    const rec = walkSession(game, doc, 700);
    const at320 = stepped(game, doc, rec, 320);
    expect(game.replay(doc, rec, { paused: true, checkpointEvery: 100 })).toMatchObject({
      ok: true,
    });
    const handle = game.replayHandle()!;
    await handle.seek(650);
    expect(handle.checkpoints).toEqual([0, 100, 200, 300, 400, 500, 600]);
    const steps: number[] = [];
    game.on("scene:step", (r) => steps.push(r.tick));
    await handle.seek(320);
    expect(handle.progress).toEqual({ target: 320, from: 300, tick: 320 });
    expect(stateOf(game)).toEqual(at320);
    expect(steps).toEqual([]);
  }, 30_000);

  it("delivers no presentation while seeking: no step listener, sound or flash", async () => {
    const doc = walkDoc();
    const game = await editing(walker as GameDefinition, doc);
    const rec = walkSession(game, doc, 400);
    expect(game.replay(doc, rec, { paused: true })).toMatchObject({ ok: true });
    const steps: number[] = [];
    game.on("scene:step", (r) => steps.push(r.tick));
    const before = audioTicks.count;
    const flash = vi.spyOn(document.body, "appendChild");
    await game.replayHandle()!.seek(350);
    expect(steps).toEqual([]);
    expect(audioTicks.count).toBe(before);
    expect(flash).not.toHaveBeenCalled();
    // Unmuted again once the seek settles.
    game.step(1);
    expect(steps).toEqual([350]);
    expect(audioTicks.count).toBe(before + 1);
  }, 30_000);

  it("starts a replay at `seek`, paused when asked", async () => {
    const doc = walkDoc();
    const game = await editing(walker as GameDefinition, doc);
    const rec = walkSession(game, doc, 400);
    const at250 = stepped(game, doc, rec, 250);
    expect(game.replay(doc, rec, { seek: 250, paused: true })).toMatchObject({ ok: true });
    const handle = game.replayHandle()!;
    await vi.waitFor(() => expect(handle.progress).toEqual({ target: 250, from: 0, tick: 250 }));
    // The last step's yield and the settle can sit a slice apart.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stateOf(game)).toEqual(at250);
    expect(game.getStore().state.sim.paused).toBe(true);
  }, 30_000);

  it("a seek through a flow request ends the replay with its flow outcome, as stepping does", async () => {
    const doc = walkDoc("leaver");
    const game = await editing(leaver as GameDefinition, doc);
    expect(game.play(doc)).toMatchObject({ ok: true });
    game.step(200);
    const rec = game.recording()!;
    expect(rec.outcome).toMatchObject({ result: "flow", tick: LEAVE_AT });
    game.stop();

    expect(game.replay(doc, rec, { paused: true })).toMatchObject({ ok: true });
    game.step(200);
    const steppedOutcome = game.getStore().state.session?.outcome;
    expect(steppedOutcome).toEqual({ result: "flow", to: "next", tick: LEAVE_AT });

    const outcomes: unknown[] = [];
    game.on("play:outcome", (o) => outcomes.push(o));
    expect(game.replay(doc, rec)).toMatchObject({ ok: true });
    const handle = game.replayHandle()!;
    await handle.seek(rec.ticks);
    expect(game.getStore().state.session?.outcome).toEqual(steppedOutcome);
    expect(outcomes).toEqual([steppedOutcome]);
    expect(game.getStore().state.sim.paused).toBe(true);
    expect(handle.tick).toBe(LEAVE_AT + 1);

    // A seek back before it reopens the run.
    await handle.seek(50);
    expect(game.getStore().state.session?.outcome).toBeNull();
  }, 30_000);

  it("hands the debug overlay the sought tick's draws, not the ones from before the seek", async () => {
    const doc = walkDoc("drawer");
    const sink = createDebugDrawSink();
    const seen: DebugTick[] = [];
    const overlay = (): DebugOverlay => ({
      setPhysics: () => {},
      update: (t) => seen.push(t),
      destroy: () => {},
      debugDraw: () => sink,
      tools: debugTools(),
    });
    const game = await editing(drawer as GameDefinition, doc, overlay);
    const rec = walkSession(game, doc, 300);
    expect(game.replay(doc, rec, { paused: true })).toMatchObject({ ok: true });
    game.step(10);
    expect(seen.at(-1)?.draws).toEqual([expect.objectContaining({ a: { x: 9, y: 0 } })]);
    await game.replayHandle()!.seek(200);
    expect(seen.at(-1)?.draws).toEqual([expect.objectContaining({ a: { x: 199, y: 0 } })]);
  }, 30_000);

  it("a seek back never publishes a re-recording that doesn't start at the run's start", async () => {
    const doc = walkDoc();
    const game = await editing(walker as GameDefinition, doc);
    const rec = walkSession(game, doc, 400);
    const published: RunRecording[] = [];
    game.on("play:recorded", (r) => published.push(r));
    expect(game.replay(doc, rec, { paused: true })).toMatchObject({ ok: true });
    const handle = game.replayHandle()!;
    await handle.seek(399);
    await handle.seek(100);
    game.step(400);
    expect(published).toEqual([]);
    // Still a replay to scrub once it reached its end.
    await handle.seek(50);
    expect(handle.tick).toBe(50);
  }, 30_000);

  it("on a Rapier scene: simulates from tick 0, and equals stepping", async () => {
    const registry = createRegistry(testGame);
    const doc = parseSceneOrThrow(engineYardJson, registry);
    const game = await editing(testGame, doc);
    const rec = walkSession(game, doc, 500, ["a", null, "a", null]);
    expect(rec.ticks).toBe(500);
    const at300 = stepped(game, doc, rec, 300, { rapier: true });
    const at100 = stepped(game, doc, rec, 100, { rapier: true });
    expect(game.replay(doc, rec, { paused: true })).toMatchObject({ ok: true });
    const handle = game.replayHandle()!;
    await handle.seek(300);
    expect(handle.checkpoints).toEqual([]);
    expect(stateOf(game, false)).toEqual(at300);
    await handle.seek(100);
    expect(handle.progress).toEqual({ target: 100, from: 0, tick: 100 });
    expect(stateOf(game, false)).toEqual(at100);
  }, 30_000);
});

describe("seeking across a live swap", () => {
  const liveGame: GameDefinition = defineGame({
    id: "live-seek",
    types: [],
    actions: [{ action: "right", keys: ["d"], description: "Walk right." }],
    world: { physics: "none" },
    time: { kind: "fixed", rate: 60 },
    live: { timings: ["boundary", "now"] },
    createRuntime(ctx: EngineContext) {
      let n = 0;
      return {
        onSwap() {
          n += ctx.random.below(1000);
        },
        afterStep() {
          n = (n * 7 + (ctx.random.nextU32() % 97) + (ctx.get("well") ? 1 : 0)) % 100_003;
        },
        snapshot: () => ({ n }),
        restore: (state: { n: number }) => {
          n = state.n;
        },
      };
    },
  });

  const hall = (markers: readonly string[] = ["start"]): SceneDefinition => ({
    v: SCENE_FORMAT_VERSION,
    name: "hall",
    bounds: [0, 0, 10, 10],
    settings: { physics: "none" },
    entities: markers.map((id, i) => ({ id, type: "marker", at: [1 + i, 1] })),
  });

  it("a recording with a now swap at 240, sought to 400 and back to 200, matches stepping", async () => {
    const game = await createGame(document.querySelector("canvas")!, {
      game: liveGame,
      scene: hall(),
    });
    games.push(game);
    game.start();
    game.stop();
    const v = await oneSceneVersion(hall(["start", "well"]), liveGame);
    expect(await game.live.stage(v)).toEqual({ ok: true });
    const versions = (id: string) => (id === v.id ? v : null);

    expect(game.play(hall())).toMatchObject({ ok: true });
    game.step(239);
    expect(game.live.activate("hall", v.id, "now")).toMatchObject({ timing: "now" });
    game.step(261);
    game.stop();
    const rec = game.recording()!;
    expect(rec.swaps).toEqual([expect.objectContaining({ tick: 240, timing: "now" })]);

    const opts = { versions };
    const at400 = stepped(game, hall(), rec, 400, opts);
    const at200 = stepped(game, hall(), rec, 200, opts);
    expect(at400.poses.map(([id]) => id)).toContain("well");
    expect(at200.poses.map(([id]) => id)).not.toContain("well");

    expect(game.replay(hall(), rec, { paused: true, ...opts })).toMatchObject({ ok: true });
    const handle = game.replayHandle()!;
    await handle.seek(400);
    expect(stateOf(game)).toEqual(at400);
    expect(handle.checkpoints).toEqual([0, 300]);
    await handle.seek(200);
    expect(stateOf(game)).toEqual(at200);
    // Past the swap again from the restored start.
    await handle.seek(400);
    expect(stateOf(game)).toEqual(at400);
    // Back past the swap onto the later version's checkpoint, then before it.
    await handle.seek(350);
    game.step(50);
    expect(stateOf(game)).toEqual(at400);
  }, 30_000);
});

describe("checkpoints", () => {
  it("stop checkpointing, rather than throw, when the game's snapshot throws", () => {
    const checkpoints = createCheckpoints(10);
    const world: SeekWorld = {
      tick: () => 10,
      step: () => true,
      snapshot: () => {
        throw new DataCloneError();
      },
      version: () => null,
      restore: () => true,
      restart: () => true,
    };
    expect(() => checkpoints.take(world)).not.toThrow();
    expect(checkpoints.refused).toBe(true);
    expect(checkpoints.ticks()).toEqual([]);
  });
});

class DataCloneError extends Error {}
