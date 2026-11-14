// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { CameraRigDef } from "../game/primitives";
import type { EngineContext, GameDefinition } from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import { runPlaytest } from "../headless/playtest";
import type { PlaytestReport, PlaytestRun } from "../headless/playtest-types";
import { createPresentationQueue, type PresentRequest } from "../runtime/present";
import type { ExpandedScene, SceneDefinition } from "../scene/types";
import type { GameInstance } from "../types";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

/** Asks for one of each kind of presentation: at load, before and after a step's physics. */
const presenting: GameDefinition<{ ticks: number }> = defineGame({
  id: "presenting",
  types: [],
  actions: [],
  createRuntime(ctx) {
    let ticks = 0;
    return {
      onLoad() {
        ctx.present.camera.snap({ x: 1, y: 2 });
      },
      beforeStep() {
        if (ctx.tick === 0) ctx.present.camera.shake(0.5, { viewport: 1 });
      },
      afterStep() {
        ticks++;
        if (ctx.tick === 0) ctx.present.effects.flash({ color: 0xffffff, ms: 80 });
        if (ctx.tick === 2) {
          ctx.present.effects.burst("sparks", { x: 3, y: 4 }, { count: 6 });
          ctx.present.audio.music("theme", { at: "tick" });
        }
      },
      snapshot: () => ({ ticks }),
    };
  },
});

const expanded: ExpandedScene = {
  name: "presenting",
  game: "presenting",
  bounds: [0, 0, 10, 10],
  settings: { gravity: [0, 0], physics: "none", grid: null, view: { projection: "orthogonal" } },
  entities: [{ id: "spot", type: "marker", at: [1, 1] }],
};

const doc: SceneDefinition = {
  v: 4,
  game: "presenting",
  name: "presenting",
  bounds: [0, 0, 10, 10],
  settings: { physics: "none" },
  entities: [{ id: "spot", type: "marker", at: [1, 1] }],
};

const TICK_0: PresentRequest[] = [
  { kind: "camera", op: { op: "snap", at: { x: 1, y: 2 } } },
  { kind: "camera", op: { op: "shake", trauma: 0.5, viewport: 1 } },
  { kind: "effect", op: { op: "flash", color: 0xffffff, ms: 80 } },
];
const TICK_2: PresentRequest[] = [
  { kind: "effect", op: { op: "burst", preset: "sparks", at: { x: 3, y: 4 }, count: 6 } },
  { kind: "audio", op: { op: "music", sound: "theme", at: "tick", tick: 2 } },
];

function steps(recordPresentation: boolean, n = 3) {
  const rt = createHeadlessRuntime({ game: presenting, scene: expanded, recordPresentation });
  try {
    return Array.from({ length: n }, () => rt.step(rt.ctx.time.tickMs, []));
  } finally {
    rt.destroy();
  }
}

function report(run: PlaytestRun<unknown>): PlaytestReport<unknown> {
  if (run.blocked) throw new Error(`blocked at ${run.stage}: ${JSON.stringify(run.issues)}`);
  return run;
}

const playtest = (recordPresentation?: boolean) =>
  report(
    runPlaytest({
      game: presenting,
      scene: doc,
      script: { v: 1, steps: [{ wait: 4 }] },
      ...(recordPresentation === undefined ? {} : { recordPresentation }),
    }),
  );

describe("presentation requests, headless", () => {
  it("land in each tick's StepResult.present in request order, a load's in tick 0", () => {
    const [t0, t1, t2] = steps(true);
    expect(t0?.present).toEqual(TICK_0);
    expect(t1?.present).toEqual([]);
    expect(t2?.present).toEqual(TICK_2);
  });

  it("are dropped without recordPresentation", () => {
    for (const result of steps(false)) expect(result).not.toHaveProperty("present");
  });

  it("leave the run alone: the same snapshots and events either way", () => {
    const strip = (r: { tick: number; events: unknown; game: unknown }) => ({
      tick: r.tick,
      events: r.events,
      game: r.game,
    });
    expect(steps(true).map(strip)).toEqual(steps(false).map(strip));
  });

  it("land in PlaytestReport.present with their ticks, only when asked", () => {
    const recorded = playtest(true);
    expect(recorded.present).toEqual([
      ...TICK_0.map((r) => ({ ...r, tick: 0 })),
      ...TICK_2.map((r) => ({ ...r, tick: 2 })),
    ]);
    const dropped = playtest();
    expect(dropped).not.toHaveProperty("present");
    expect(dropped.final).toEqual(recorded.final);
    expect(dropped.recording).toEqual(recorded.recording);
  });

  it("copy what they're given, so a caller changing its objects later can't reach them", () => {
    const { queue, take } = createPresentationQueue({ record: true, tick: () => 7 });
    const at = { x: 1, y: 1 };
    const opts = { count: 2 };
    queue.effects.burst("sparks", at, opts);
    queue.camera.follow({ point: at, weight: 2 });
    at.x = 9;
    opts.count = 9;
    expect(take()).toEqual([
      { kind: "effect", op: { op: "burst", preset: "sparks", at: { x: 1, y: 1 }, count: 2 } },
      { kind: "camera", op: { op: "follow", target: { point: { x: 1, y: 1 }, weight: 2 } } },
    ]);
    expect(take()).toEqual([]);
  });

  it("is write-only: every call returns nothing, and a queue that doesn't record keeps nothing", () => {
    const { queue, take } = createPresentationQueue({ record: false, tick: () => 0 });
    expect(Object.keys(queue).sort()).toEqual(["audio", "camera", "effects"]);
    expect(queue.camera.zoom(2, { ms: 300, ease: "quadOut" })).toBeUndefined();
    expect(queue.effects.hitStop(60)).toBeUndefined();
    expect(queue.audio.stop("loop", { fadeMs: 100 })).toBeUndefined();
    expect(take()).toEqual([]);
  });
});

// ─── The shell half: effects and the camera's shake in a browser game ───

/** Drives the loop's frames by hand, `ms` of the fake clock at a time. */
function manualFrames() {
  let pending: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return {
    advance(ms: number) {
      now += ms;
      vi.advanceTimersByTime(ms);
      const due = pending;
      pending = [];
      for (const cb of due) cb(now);
    },
  };
}

type Ask = (ctx: EngineContext) => void;

/** A fixed-rate game that walks a counter and asks for presentation on the ticks `asks` names. */
function asking(asks: Record<number, Ask>, camera?: CameraRigDef): GameDefinition<{ n: number }> {
  return defineGame({
    id: "asking",
    types: [],
    actions: [],
    world: { physics: "none" },
    time: { kind: "fixed", rate: 60 },
    ...(camera ? { camera } : {}),
    createRuntime(ctx) {
      let n = 0;
      return {
        afterStep() {
          n += ctx.tick;
          asks[ctx.tick]?.(ctx);
        },
        snapshot: () => ({ n }),
      };
    },
  });
}

const askingDoc: SceneDefinition = {
  v: 4,
  game: "asking",
  name: "asking",
  bounds: [0, 0, 40, 20],
  settings: { physics: "none" },
  entities: [{ id: "spot", type: "marker", at: [5, 5] }],
};

describe("presentation requests, in the shell", () => {
  const games: GameInstance[] = [];
  let frames: ReturnType<typeof manualFrames>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    frames = manualFrames();
    document.body.appendChild(document.createElement("canvas"));
  });

  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function playing(def: GameDefinition<{ n: number }>, reducedMotion = false) {
    const game = await createGame(document.querySelector("canvas")!, {
      game: def as GameDefinition,
      reducedMotion,
    });
    games.push(game);
    game.start();
    expect(game.play(askingDoc)).toMatchObject({ ok: true });
    return game;
  }

  const ticks = (g: GameInstance) => g.getStore().state.tick;

  /** Frames of 10 ms until `n` ticks have run; the wall ms each tick count was first seen at. */
  function runTo(g: GameInstance, n: number): Map<number, number> {
    const seen = new Map<number, number>();
    for (let ms = 0; ticks(g) < n && ms < 5000; ms += 10) {
      frames.advance(10);
      if (!seen.has(ticks(g))) seen.set(ticks(g), ms);
    }
    return seen;
  }

  it("hitStop(100) runs no tick for 100 ms of wall time, and the run's digest is the one without it", async () => {
    const plain = await playing(asking({}));
    const start = ticks(plain);
    runTo(plain, start + 20);
    plain.stop();
    const without = plain.recording()!;

    const stopped = await playing(asking({ 3: (ctx) => ctx.present.effects.hitStop(100) }));
    const from = ticks(stopped);
    const seen = runTo(stopped, from + 20);
    stopped.stop();
    const withStop = stopped.recording()!;

    // Tick 3 asked for the stop: the next tick waits out the 100 ms, where the others are a frame or two apart.
    const at3 = seen.get(from + 4)!;
    const at4 = seen.get(from + 5)!;
    expect(at4 - at3).toBeGreaterThanOrEqual(100);
    expect(seen.get(from + 3)! - seen.get(from + 2)!).toBeLessThan(30);
    expect(withStop.ticks).toBe(without.ticks);
    expect(withStop.end).toBe(without.end);
  });

  it("flash adds its div over the canvas, under the UI, and removes it once faded", async () => {
    const game = await playing(asking({ 1: (ctx) => ctx.present.effects.flash({ ms: 80 }) }));
    runTo(game, ticks(game) + 2);
    const overlay = document.querySelector("[data-jams-effects]");
    expect(overlay?.previousElementSibling).toBe(document.querySelector("canvas"));
    expect(overlay?.querySelectorAll("[data-jams-flash]")).toHaveLength(1);
    frames.advance(100);
    expect(overlay?.querySelectorAll("[data-jams-flash]")).toHaveLength(0);
  });

  it("under reduced motion caps the flash at 0.3 alpha and 80 ms", async () => {
    const styles: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) if (r.oldValue) styles.push(r.oldValue);
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
      attributeOldValue: true,
    });
    const game = await playing(
      asking({ 1: (ctx) => ctx.present.effects.flash({ ms: 500, alpha: 0.9 }) }),
      true,
    );
    expect(game.reducedMotion).toBe(true);
    runTo(game, ticks(game) + 2);
    const flash = document.querySelector<HTMLElement>("[data-jams-flash]")!;
    expect(flash.style.transition).toContain("80ms");
    await Promise.resolve();
    observer.disconnect();
    expect(styles.some((s) => /opacity: 0\.3\b/.test(s))).toBe(true);
    expect(styles.some((s) => /opacity: 0\.9\b/.test(s))).toBe(false);
    frames.advance(90);
    expect(document.querySelector("[data-jams-flash]")).toBeNull();
  });

  it("under reduced motion drops the shake: the camera frames as if none was asked for", async () => {
    const shake: Ask = (ctx) => ctx.present.camera.shake(1);
    const rig: CameraRigDef = { damping: 0.05, shake: { maxOffset: 80, maxTurn: 0.1, decay: 0.5 } };
    const cameraAfter = async (asks: Record<number, Ask>, reduced: boolean) => {
      const game = await playing(asking(asks, rig), reduced);
      runTo(game, ticks(game) + 6);
      const { position, zoom } = game.getStore().state.camera;
      game.destroy();
      return { position, zoom };
    };
    const calm = await cameraAfter({}, true);
    expect(await cameraAfter({ 2: shake }, true)).toEqual(calm);
    // The same request with motion on moves it.
    expect(await cameraAfter({ 2: shake }, false)).not.toEqual(calm);
  });

  it("ignores hit-stop in edit mode: Stop ends one, and the editor's clock runs at 1x", async () => {
    const game = await playing(
      asking({
        2: (ctx) => {
          ctx.present.effects.hitStop(1000);
          ctx.present.effects.flash({ ms: 1000 });
        },
      }),
    );
    const from = ticks(game);
    runTo(game, from + 3);
    frames.advance(200);
    // Held: no tick in 200 ms.
    expect(ticks(game)).toBe(from + 3);
    game.setMode("edit");
    expect(game.getStore().state.sim.timeScale).toBe(1);
    expect(document.querySelector("[data-jams-flash]")).toBeNull();
    // The stop's end, long after, leaves the editor's clock alone.
    frames.advance(1000);
    expect(game.getStore().state.sim.timeScale).toBe(1);
    // And Play again ticks at once.
    game.setMode("play");
    const again = ticks(game);
    frames.advance(50);
    expect(ticks(game)).toBeGreaterThan(again);
  });
});
