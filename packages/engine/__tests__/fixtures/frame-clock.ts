/**
 * Driving a browser game's loop by hand in jsdom: the animation frames, the
 * clock they read, a renderer with no GPU, and a scene view that records the
 * camera each frame hands it.
 */
import type { Matrix } from "pixi.js";
import { afterEach, beforeAll, beforeEach, vi } from "vite-plus/test";

import type { GameDefinition } from "../../game/types";
import type { PixiView } from "../../render/pixi-view";
import type { SceneDefinition } from "../../scene/types";
import type { GameInstance, RapierModule } from "../../types";

/** One fixed tick at 60 Hz, ms. */
export const TICK_MS = 1000 / 60;

export type FrameClock = {
  /** Moves the clock on by `ms` and runs the frames the loop asked for. */
  advance(ms: number): void;
  /** Runs `n` frames a tick apart: each steps one tick, then renders. */
  ticks(n: number): void;
  /**
   * Puts back the frame functions and `performance.now` it replaced, for a
   * caller whose globals no `vi.unstubAllGlobals` will undo.
   */
  restore(): void;
};

/**
 * Stubs `requestAnimationFrame` so frames run only when the test says.
 * `performance` makes `performance.now()` read the same clock; `timers`
 * moves vitest's fake timers on with it; `date` sets the faked `Date` to it.
 */
export function manualFrames(
  opts: { performance?: boolean; timers?: boolean; date?: boolean } = {},
): FrameClock {
  let pending: FrameRequestCallback[] = [];
  let now = 0;
  const had = {
    requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame"),
  };
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const nowSpy = opts.performance
    ? vi.spyOn(performance, "now").mockImplementation(() => now)
    : null;
  const advance = (ms: number) => {
    now += ms;
    if (opts.timers) vi.advanceTimersByTime(ms);
    if (opts.date) vi.setSystemTime(now);
    const due = pending;
    pending = [];
    for (const cb of due) cb(now);
  };
  return {
    advance,
    ticks(n) {
      for (let i = 0; i < n; i++) advance(TICK_MS);
    },
    restore() {
      for (const [name, desc] of Object.entries(had)) {
        if (desc) Object.defineProperty(globalThis, name, desc);
        else delete (globalThis as Record<string, unknown>)[name];
      }
      nowSpy?.mockRestore();
    },
  };
}

/** The page's reduced-motion preference, stubbed by `stubReducedMotion`. */
export type ReducedMotionStub = {
  /** Changes the preference and fires the query's change listeners. */
  set(reduce: boolean): void;
  /** How many change listeners are attached to the query now. */
  listening(): number;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Stubs `matchMedia` so `(prefers-reduced-motion: reduce)` matches while
 * the preference is on (`initial` to start) and no other query ever does.
 * `vi.unstubAllGlobals` undoes it.
 */
export function stubReducedMotion(initial = false): ReducedMotionStub {
  let reduce = initial;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  vi.stubGlobal("matchMedia", (query: string) => {
    const motion = query === REDUCED_MOTION_QUERY;
    return {
      media: query,
      get matches() {
        return motion && reduce;
      },
      addEventListener(type: string, fn: (e: { matches: boolean }) => void) {
        if (motion && type === "change") listeners.add(fn);
      },
      removeEventListener(type: string, fn: (e: { matches: boolean }) => void) {
        if (type === "change") listeners.delete(fn);
      },
    } as unknown as MediaQueryList;
  });
  return {
    set(next) {
      reduce = next;
      for (const fn of [...listeners]) fn({ matches: next });
    },
    listening: () => listeners.size,
  };
}

/** One draw the stubbed renderer was asked for: what it drew, into which texture (none for the canvas), and how. */
export type StubbedRender = { container: unknown; target?: unknown; transform?: Matrix };

/**
 * A `../renderer` module for `vi.mock` with no GPU: a real Pixi stage
 * holding the world and UI containers (labelled "world" and "ui"), and a
 * renderer whose `render` only hands each draw to `onRender`.
 */
export async function stubRenderer(opts: { onRender?: (o: StubbedRender) => void } = {}) {
  const { Container } = await import("pixi.js");
  return {
    createRenderer: async () => {
      const stage = new Container();
      const worldContainer = new Container({ label: "world" });
      const uiContainer = new Container({ label: "ui" });
      stage.addChild(worldContainer, uiContainer);
      return {
        app: {
          stage,
          renderer: {
            resolution: 1,
            render(o: StubbedRender) {
              opts.onRender?.(o);
            },
          },
        },
        worldContainer,
        uiContainer,
        resize: () => {},
        destroy: () => {},
      };
    },
  };
}

/** What a recording scene view saw: the camera of each frame and the views made, in order. */
export type FrameRecord = {
  frames: { x: number; y: number; zoom: number }[];
  views: PixiView[];
};

/**
 * A `../render/pixi-view` module for `vi.mock` whose views push each frame's
 * camera, and themselves, to `record`.
 */
export async function recordingPixiView(
  importOriginal: <T>() => Promise<T>,
  record: FrameRecord,
): Promise<typeof import("../../render/pixi-view")> {
  const real = await importOriginal<typeof import("../../render/pixi-view")>();
  return {
    ...real,
    createPixiView: (...args: Parameters<typeof real.createPixiView>) => {
      const view = real.createPixiView(...args);
      record.views.push(view);
      return {
        ...view,
        frame(f) {
          record.frames.push({ ...f.camera });
          view.frame!(f);
        },
      } satisfies PixiView;
    },
  };
}

/** A shell driven frame by frame, with `../renderer` and `../render/pixi-view` mocked as above. */
export type PlayRig = {
  /** Runs `n` frames a tick apart: each steps one tick, then renders. */
  advance: (n: number) => void;
  /** The camera the last frame handed the view. */
  lastFrame: () => FrameRecord["frames"][number];
  /** `createGame` on the rig's canvas, destroyed after the test. */
  create: (game: GameDefinition | null, scene?: SceneDefinition) => Promise<GameInstance>;
  /** A started game playing `scene`, its first frame drawn. */
  playing: (scene: SceneDefinition, game?: GameDefinition | null) => Promise<GameInstance>;
  /** A started game editing `scene`, its first frame drawn. */
  editing: (scene: SceneDefinition, game?: GameDefinition | null) => Promise<GameInstance>;
};

/**
 * Sets up the hooks a jsdom test of the shell's camera needs: Rapier once,
 * and for each test a fresh canvas, `seen` emptied and a `manualFrames`
 * clock (`frames` are its options); after it, every game made is destroyed
 * and the stubs undone. Call it where the hooks belong (module scope or a
 * `describe`), with the `seen` record `recordingPixiView` writes to.
 */
export function playRig(
  seen: FrameRecord,
  frames: Parameters<typeof manualFrames>[0] = {},
): PlayRig {
  let rapier: RapierModule;
  let clock: FrameClock;
  let canvas: HTMLCanvasElement;
  const games: GameInstance[] = [];

  beforeAll(async () => {
    rapier = await (await import("./compat-rapier")).loadCompatRapier();
  });
  beforeEach(() => {
    seen.frames.length = 0;
    seen.views.length = 0;
    clock = manualFrames(frames);
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
  });
  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const advance = (n: number) => clock.ticks(n);
  const create: PlayRig["create"] = async (game, scene) => {
    const { createGame } = await import("../../engine");
    const instance = await createGame(canvas, {
      game,
      rapier: async () => rapier,
      ...(scene ? { scene } : {}),
    });
    games.push(instance);
    return instance;
  };
  return {
    advance,
    lastFrame: () => seen.frames[seen.frames.length - 1]!,
    create,
    playing: async (scene, game = null) => {
      const instance = await create(game, scene);
      instance.start();
      // The loop's first frame only starts its clock; the second ticks and renders.
      advance(2);
      return instance;
    },
    editing: async (scene, game = null) => {
      const instance = await create(game);
      instance.setMode("edit");
      instance.loadScene(scene);
      instance.start();
      advance(2);
      return instance;
    },
  };
}
