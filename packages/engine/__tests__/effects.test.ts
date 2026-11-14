// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { createEffectLayer, createShellEffectLayer } from "../render/effects";
import type { SceneDefinition } from "../scene/types";
import type { GameInstance } from "../types";
import { createEffectOverlay, createTransitionLayer, createUiLayer } from "../ui/layer";
import { manualFrames } from "./fixtures/frame-clock";

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

function fakeLoop(scale = 1) {
  const calls: number[] = [];
  return {
    calls,
    getTimeScale: () => scale,
    setTimeScale: (s: number) => {
      calls.push(s);
      scale = s;
    },
  };
}

let host: HTMLDivElement;
let reduced = false;

function setup(loop = fakeLoop()) {
  const layer = document.createElement("div");
  host.append(layer);
  const fx = createEffectLayer(layer, loop, { reducedMotion: () => reduced });
  const flashes = () => [...layer.querySelectorAll<HTMLElement>("[data-jams-flash]")];
  return { fx, loop, layer, flashes };
}

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  vi.useRealTimers();
  host.remove();
});

describe("flash", () => {
  it("covers the layer and fades out over 120 ms by default", () => {
    const { fx, flashes } = setup();
    fx.flash({ color: 0xff0000 });
    const [el] = flashes();
    expect(el).toBeDefined();
    expect(el!.style.position).toBe("absolute");
    expect(el!.style.inset).toMatch(/^0(px)?$/);
    expect(el!.style.pointerEvents).toBe("none");
    expect(el!.style.background).toMatch(/rgb\(255, 0, 0\)|#ff0000/);
    expect(el!.style.transition).toBe("opacity 120ms linear");
    expect(el!.style.opacity).toBe("0");
    vi.advanceTimersByTime(119);
    expect(flashes()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(flashes()).toHaveLength(0);
  });

  it("fades over the requested ms", () => {
    const { fx, flashes } = setup();
    fx.flash({ ms: 300 });
    const el = flashes()[0]!;
    expect(el.style.transition).toBe("opacity 300ms linear");
    vi.advanceTimersByTime(299);
    expect(flashes()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(flashes()).toHaveLength(0);
  });

  it("starts from the requested alpha, clamped to 0..1, before fading", () => {
    const { fx, layer } = setup();
    const starts: string[] = [];
    const append = layer.append.bind(layer);
    vi.spyOn(layer, "append").mockImplementation((...nodes) => {
      for (const n of nodes) if (n instanceof HTMLElement) starts.push(n.style.opacity);
      append(...nodes);
    });
    fx.flash({ alpha: 0.5 });
    fx.flash({ alpha: 7 });
    fx.flash();
    expect(starts).toEqual(["0.5", "1", "0.8"]);
  });

  it("caps alpha at 0.3 and the fade at 80 ms under reduced motion", () => {
    reduced = true;
    const { fx, layer, flashes } = setup();
    const starts: string[] = [];
    const append = layer.append.bind(layer);
    vi.spyOn(layer, "append").mockImplementation((...nodes) => {
      for (const n of nodes) if (n instanceof HTMLElement) starts.push(n.style.opacity);
      append(...nodes);
    });
    fx.flash({ alpha: 1, ms: 500 });
    fx.flash({ alpha: 0.1, ms: 40 });
    expect(starts).toEqual(["0.3", "0.1"]);
    expect(flashes().map((el) => el.style.transition)).toEqual([
      "opacity 80ms linear",
      "opacity 40ms linear",
    ]);
    vi.advanceTimersByTime(40);
    expect(flashes()).toHaveLength(1);
    vi.advanceTimersByTime(40);
    expect(flashes()).toHaveLength(0);
  });

  it("reads reduced motion at each flash", () => {
    const { fx, flashes } = setup();
    fx.flash();
    reduced = true;
    fx.flash();
    expect(flashes().map((el) => el.style.transition)).toEqual([
      "opacity 120ms linear",
      "opacity 80ms linear",
    ]);
  });

  it("falls back to the default fade for a bad ms", () => {
    const { fx, flashes } = setup();
    fx.flash({ ms: -5 });
    fx.flash({ ms: Number.NaN });
    expect(flashes().map((el) => el.style.transition)).toEqual([
      "opacity 120ms linear",
      "opacity 120ms linear",
    ]);
  });
});

describe("hitStop", () => {
  it("sets the time scale to 0 and restores the previous one after ms of wall time", () => {
    const { fx, loop } = setup(fakeLoop(0.5));
    fx.hitStop(100);
    expect(loop.getTimeScale()).toBe(0);
    vi.advanceTimersByTime(99);
    expect(loop.getTimeScale()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(loop.getTimeScale()).toBe(0.5);
    expect(loop.calls).toEqual([0, 0.5]);
  });

  it("extends overlapping stops to the latest end", () => {
    const { fx, loop } = setup();
    fx.hitStop(100);
    vi.advanceTimersByTime(60);
    fx.hitStop(100);
    vi.advanceTimersByTime(60);
    expect(loop.getTimeScale()).toBe(0);
    vi.advanceTimersByTime(39);
    expect(loop.getTimeScale()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(loop.getTimeScale()).toBe(1);
    expect(loop.calls).toEqual([0, 1]);
  });

  it("keeps the later end when a shorter stop overlaps", () => {
    const { fx, loop } = setup();
    fx.hitStop(200);
    vi.advanceTimersByTime(50);
    fx.hitStop(20);
    vi.advanceTimersByTime(100);
    expect(loop.getTimeScale()).toBe(0);
    vi.advanceTimersByTime(50);
    expect(loop.getTimeScale()).toBe(1);
  });

  it("is unchanged by reduced motion and ignores a non-positive ms", () => {
    reduced = true;
    const { fx, loop } = setup();
    fx.hitStop(0);
    fx.hitStop(-10);
    fx.hitStop(Number.POSITIVE_INFINITY);
    expect(loop.calls).toEqual([]);
    fx.hitStop(30);
    vi.advanceTimersByTime(30);
    expect(loop.calls).toEqual([0, 1]);
  });

  it("leaves a scale set during the stop alone", () => {
    const { fx, loop } = setup();
    fx.hitStop(100);
    loop.setTimeScale(2);
    vi.advanceTimersByTime(100);
    expect(loop.getTimeScale()).toBe(2);
  });

  it("keeps a scale the host reports through timeScaleSet, 0 included", () => {
    for (const set of [0, 2]) {
      const loop = fakeLoop(0.5);
      const fx = createShellEffectLayer(host, loop, { reducedMotion: () => false });
      fx.hitStop(100);
      loop.setTimeScale(set);
      fx.timeScaleSet();
      vi.advanceTimersByTime(200);
      expect(loop.getTimeScale()).toBe(set);
      fx.clear();
      expect(loop.calls).toEqual([0, set]);
    }
  });

  it("starts a fresh stop after a reported scale, ending on that scale", () => {
    const loop = fakeLoop();
    const fx = createShellEffectLayer(host, loop, { reducedMotion: () => false });
    fx.hitStop(100);
    loop.setTimeScale(2);
    fx.timeScaleSet();
    fx.hitStop(50);
    expect(loop.getTimeScale()).toBe(0);
    vi.advanceTimersByTime(50);
    expect(loop.getTimeScale()).toBe(2);
    expect(loop.calls).toEqual([0, 2, 0, 2]);
  });

  it("ignores timeScaleSet with no stop running", () => {
    const loop = fakeLoop(0.5);
    const fx = createShellEffectLayer(host, loop, { reducedMotion: () => false });
    fx.timeScaleSet();
    fx.hitStop(40);
    vi.advanceTimersByTime(40);
    expect(loop.calls).toEqual([0, 0.5]);
  });
});

describe("hit-stop in the shell", () => {
  const games: GameInstance[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    document.body.appendChild(document.createElement("canvas"));
  });

  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.querySelector("canvas")?.remove();
    vi.unstubAllGlobals();
  });

  /** Asks for a long hit-stop on its second tick. */
  const stopping = defineGame({
    id: "stopping",
    types: [],
    actions: [],
    world: { physics: "none" },
    time: { kind: "fixed", rate: 60 },
    createRuntime: (ctx) => ({
      afterStep() {
        if (ctx.tick === 2) ctx.present.effects.hitStop(500);
      },
      snapshot: () => null,
    }),
  });

  const doc: SceneDefinition = {
    v: 4,
    game: "stopping",
    name: "stopping",
    bounds: [0, 0, 20, 20],
    settings: { physics: "none" },
    entities: [],
  };

  it("keeps a time scale of 0 that the host set during the stop", async () => {
    const frames = manualFrames({ timers: true });
    const game = await createGame(document.querySelector("canvas")!, {
      game: stopping as GameDefinition,
      reducedMotion: false,
    });
    games.push(game);
    game.start();
    expect(game.play(doc)).toMatchObject({ ok: true });
    const tick = () => game.getStore().state.tick;
    for (let ms = 0; tick() < 3 && ms < 1000; ms += 10) frames.advance(10);
    const held = tick();
    frames.advance(100);
    expect(tick()).toBe(held);
    game.setTimeScale(0);
    for (let i = 0; i < 80; i++) frames.advance(10);
    expect(tick()).toBe(held);
    expect(game.getStore().state.sim.timeScale).toBe(0);
    game.setTimeScale(1);
    frames.advance(50);
    expect(tick()).toBeGreaterThan(held);
  });
});

describe("clear", () => {
  it("restores the scale, cancels the stop and removes every flash", () => {
    const { fx, loop, flashes } = setup(fakeLoop(0.25));
    fx.flash();
    fx.flash({ ms: 400 });
    fx.hitStop(500);
    expect(loop.getTimeScale()).toBe(0);
    fx.clear();
    expect(loop.getTimeScale()).toBe(0.25);
    expect(flashes()).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(loop.calls).toEqual([0, 0.25]);
    fx.clear();
    expect(loop.calls).toEqual([0, 0.25]);
  });
});

describe("createEffectOverlay", () => {
  function canvasInFrame() {
    const frame = document.createElement("div");
    const canvas = document.createElement("canvas");
    frame.append(canvas);
    host.append(frame);
    return { frame, canvas };
  }
  const order = (frame: HTMLElement) =>
    [...frame.children].map((el) =>
      el.hasAttribute("data-jams-effects")
        ? "effects"
        : el.hasAttribute("data-jams-ui")
          ? "ui"
          : el.hasAttribute("data-jams-transition")
            ? "transition"
            : el.tagName.toLowerCase(),
    );

  it("sits under the UI layer whether it is made before or after it", () => {
    const before = canvasInFrame();
    createEffectOverlay(before.canvas);
    createUiLayer(before.canvas);
    createTransitionLayer(before.canvas);
    expect(order(before.frame)).toEqual(["canvas", "effects", "transition", "ui"]);

    const after = canvasInFrame();
    createUiLayer(after.canvas);
    createEffectOverlay(after.canvas);
    expect(order(after.frame)).toEqual(["canvas", "effects", "ui"]);
  });

  it("never takes input and leaves with destroy", () => {
    const { frame, canvas } = canvasInFrame();
    const overlay = createEffectOverlay(canvas);
    expect(overlay.root.style.pointerEvents).toBe("none");
    expect(overlay.root.getAttribute("aria-hidden")).toBe("true");
    const fx = createEffectLayer(overlay.root, fakeLoop(), { reducedMotion: () => false });
    fx.flash();
    expect(overlay.root.querySelector<HTMLElement>("[data-jams-flash]")?.style.pointerEvents).toBe(
      "none",
    );
    overlay.destroy();
    expect(frame.querySelector("[data-jams-effects]")).toBeNull();
  });
});
