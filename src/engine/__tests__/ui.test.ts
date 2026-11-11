// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { parseSceneOrThrow } from "../scene/parse";
import engineYardJson from "../scenes/engine-yard.json";
import type { GameInstance, RapierModule, Vec2 } from "../types";
import { bindText, bindToWorld, watchView } from "../ui/bind";
import { createUiLayer, mountUi } from "../ui/layer";
import type { UiContext } from "../ui/types";
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

const yard = parseSceneOrThrow(engineYardJson, createRegistry(testGame));

/** A ResizeObserver jsdom lacks, whose callbacks the test fires. */
class FakeResizeObserver {
  static live = new Set<FakeResizeObserver>();
  observed: Element[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.live.add(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    FakeResizeObserver.live.delete(this);
  }
  static fire() {
    for (const o of FakeResizeObserver.live) o.callback([], o as unknown as ResizeObserver);
  }
}

let rapier: RapierModule;
let game: GameInstance;
let frame: HTMLDivElement;
let canvas: HTMLCanvasElement;
let box = { left: 30, top: 12, width: 1920, height: 1080 };

const domRect = () =>
  ({
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
  }) as DOMRect;

/** jsdom has no layout: the canvas's box is `box`, and a layer over it shares it. */
function layOut(el: HTMLElement) {
  Object.defineProperties(el, {
    offsetLeft: { configurable: true, get: () => box.left },
    offsetTop: { configurable: true, get: () => box.top },
    offsetWidth: { configurable: true, get: () => box.width },
    offsetHeight: { configurable: true, get: () => box.height },
  });
  el.getBoundingClientRect = domRect;
}

const layer = () => frame.querySelector<HTMLElement>("[data-jams-ui]");

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

beforeEach(async () => {
  box = { left: 30, top: 12, width: 1920, height: 1080 };
  frame = document.createElement("div");
  frame.style.position = "relative";
  canvas = document.createElement("canvas");
  layOut(canvas);
  frame.appendChild(canvas);
  document.body.appendChild(frame);
  game = await createGame(canvas, { game: testGame, rapier: async () => rapier, scene: yard });
  game.stop();
});

afterEach(() => {
  game.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeResizeObserver.live.clear();
});

describe("the UI layer", () => {
  it("sits over the canvas's box as its sibling, and takes no pointer events itself", () => {
    const { root, ...ui } = createUiLayer(canvas);
    expect(root.previousElementSibling).toBe(canvas);
    expect(root.hasAttribute("data-jams-ui")).toBe(true);
    const style = getComputedStyle(root);
    expect(style.position).toBe("absolute");
    expect(style.pointerEvents).toBe("none");
    expect([root.style.left, root.style.top, root.style.width, root.style.height]).toEqual([
      "30px",
      "12px",
      "1920px",
      "1080px",
    ]);

    const button = document.createElement("button");
    button.style.pointerEvents = "auto";
    root.appendChild(button);
    expect(getComputedStyle(button).pointerEvents).toBe("auto");
    ui.destroy();
    expect(layer()).toBeNull();
  });

  it("follows the canvas through a ResizeObserver, and disconnects it on destroy", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { root, ...ui } = createUiLayer(canvas);
    const [observer] = FakeResizeObserver.live;
    expect(observer?.observed).toEqual([canvas]);
    box = { left: 0, top: 40, width: 800, height: 600 };
    FakeResizeObserver.fire();
    expect([root.style.left, root.style.top, root.style.width, root.style.height]).toEqual([
      "0px",
      "40px",
      "800px",
      "600px",
    ]);
    ui.destroy();
    expect(FakeResizeObserver.live.size).toBe(0);
  });

  it("follows the window's resize where no ResizeObserver exists", () => {
    expect(window.ResizeObserver).toBeUndefined();
    const { root, ...ui } = createUiLayer(canvas);
    box = { ...box, width: 1000 };
    window.dispatchEvent(new Event("resize"));
    expect(root.style.width).toBe("1000px");
    ui.destroy();
  });
});

describe("mountUi", () => {
  it("mounts and unmounts leaving no node, subscription or listener behind", () => {
    const store = game.getStore();
    const subscribed = store.listeners.size;
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const destroy = vi.fn();
    const before = frame.childElementCount;

    const unmount = mountUi(game, canvas, (ctx) => {
      const label = document.createElement("span");
      ctx.root.appendChild(label);
      // Left bound on purpose: mountUi drops what the context made.
      ctx.watch(
        (s) => s.tick,
        () => {},
      );
      bindText(label, ctx, (s) => s.phase);
      bindToWorld(label, ctx, () => ({ x: 1, y: 1 }));
      return { destroy };
    });
    expect(layer()?.childElementCount).toBe(1);
    expect(store.listeners.size).toBeGreaterThan(subscribed);

    unmount();
    expect(destroy).toHaveBeenCalledOnce();
    expect(layer()).toBeNull();
    expect(frame.childElementCount).toBe(before);
    expect(store.listeners.size).toBe(subscribed);
    const resizeCalls = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => (type as string) === "resize");
    expect(resizeCalls(add)).toHaveLength(1);
    expect(resizeCalls(remove).map(([, fn]) => fn)).toEqual(resizeCalls(add).map(([, fn]) => fn));

    unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("disconnects its ResizeObserver on unmount", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const unmount = mountUi(game, canvas, () => ({ destroy() {} }));
    expect(FakeResizeObserver.live.size).toBe(1);
    unmount();
    expect(FakeResizeObserver.live.size).toBe(0);
  });

  it("removes the layer when mount throws", () => {
    const subscribed = game.getStore().listeners.size;
    expect(() =>
      mountUi(game, canvas, (ctx) => {
        ctx.watch(
          (s) => s.tick,
          () => {},
        );
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(layer()).toBeNull();
    expect(game.getStore().listeners.size).toBe(subscribed);
  });

  it("builds the context: slice, settings and reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" })),
    );
    let seen: UiContext<{ score: number }> | null = null;
    const unmount = mountUi<{ score: number }>(game, canvas, (ctx) => {
      seen = ctx;
      return { destroy() {} };
    });
    const ctx = seen as UiContext<{ score: number }> | null;
    expect(ctx?.root).toBe(layer());
    expect(ctx?.canvas).toBe(canvas);
    expect(ctx?.settings).toEqual({});
    expect(ctx?.reducedMotion).toBe(true);
    game.getStore().setState((s) => ({ ...s, game: { score: 3 } }));
    expect(ctx?.slice()).toEqual({ score: 3 });
    game.getStore().setState((s) => ({ ...s, game: null }));
    expect(ctx?.slice()).toBeNull();
    unmount();
  });

  it("reads settings from the project's runtime view, and no reduced motion without matchMedia", () => {
    const project: ProjectRuntimeView = {
      settings: { lives: 3 },
      engine: {},
      table: () => [],
      asset: () => undefined,
      inputMap: null,
    };
    let settings: unknown;
    let reducedMotion: boolean | undefined;
    const unmount = mountUi({ ...game, project: () => project }, canvas, (ctx) => {
      ({ settings, reducedMotion } = ctx);
      return { destroy() {} };
    });
    expect(settings).toEqual({ lives: 3 });
    expect(reducedMotion).toBe(false);
    unmount();
  });

  it("watch calls once now, then once per change by identity", () => {
    const calls: [string, string | undefined][] = [];
    let unwatch = () => {};
    const unmount = mountUi(game, canvas, (ctx) => {
      unwatch = ctx.watch(
        (s) => s.debugMode,
        (value, prev) => calls.push([value, prev]),
      );
      return { destroy() {} };
    });
    const store = game.getStore();
    expect(calls).toEqual([["off", undefined]]);
    store.setState((s) => ({ ...s, tick: s.tick + 1 }));
    store.setState((s) => ({ ...s, debugMode: "off" }));
    expect(calls).toHaveLength(1);
    store.setState((s) => ({ ...s, debugMode: "colliders" }));
    store.setState((s) => ({ ...s, tick: s.tick + 1 }));
    expect(calls).toEqual([
      ["off", undefined],
      ["colliders", "off"],
    ]);
    unwatch();
    store.setState((s) => ({ ...s, debugMode: "off" }));
    expect(calls).toHaveLength(2);
    unmount();
  });
});

describe("bindText", () => {
  it("keeps textContent equal to format(select(state))", () => {
    const el = document.createElement("span");
    const unmount = mountUi(game, canvas, (ctx) => {
      ctx.root.appendChild(el);
      const unbind = bindText(
        el,
        ctx,
        (s) => s.debugMode,
        (mode) => `debug: ${mode}`,
      );
      return { destroy: unbind };
    });
    expect(el.textContent).toBe("debug: off");
    game.getStore().setState((s) => ({ ...s, debugMode: "colliders" }));
    expect(el.textContent).toBe("debug: colliders");
    unmount();
    game.getStore().setState((s) => ({ ...s, debugMode: "off" }));
    expect(el.textContent).toBe("debug: colliders");
  });

  it("writes a value as text without a format, and null as empty", () => {
    const el = document.createElement("span");
    const unmount = mountUi(game, canvas, (ctx) => {
      bindText(el, ctx, (s) => s.game as number | null);
      return { destroy() {} };
    });
    expect(el.textContent).toBe("");
    game.getStore().setState((s) => ({ ...s, game: 42 }));
    expect(el.textContent).toBe("42");
    unmount();
  });
});

describe("bindToWorld", () => {
  /** The client point the label's transform puts it at, from the layer's corner. */
  function labelClient(el: HTMLElement): Vec2 {
    const m = /translate\((-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\)/.exec(el.style.transform);
    if (!m) throw new Error(`no translate in "${el.style.transform}"`);
    const origin = layer()!.getBoundingClientRect();
    return { x: origin.left + Number(m[1]), y: origin.top + Number(m[2]) };
  }

  /** The label sits where the world point is, within 0.01 client px. */
  function expectOver(el: HTMLElement, world: Vec2) {
    const at = labelClient(el);
    const scale = game.getStore().state.camera.scale * game.getStore().state.camera.zoom;
    const back = game.clientToWorld(at.x, at.y);
    expect(Math.abs(back.x - world.x) * scale).toBeLessThan(0.01);
    expect(Math.abs(back.y - world.y) * scale).toBeLessThan(0.01);
  }

  function mountLabel(at: () => Vec2 | null) {
    const el = document.createElement("span");
    const unmount = mountUi(game, canvas, (ctx) => {
      layOut(ctx.root);
      ctx.root.appendChild(el);
      return { destroy: bindToWorld(el, ctx, at) };
    });
    return { el, unmount };
  }

  it("follows a world point through pans and zooms", () => {
    const target = { x: 12.5, y: 7.25 };
    const { el, unmount } = mountLabel(() => target);
    expect(el.style.position).toBe("absolute");
    expectOver(el, target);
    game.panBy({ x: -120, y: 45 });
    expectOver(el, target);
    game.zoomAt({ x: 700, y: 300 }, 1.75);
    expectOver(el, target);
    game.zoomAt({ x: 1500, y: 900 }, 0.5);
    expectOver(el, target);
    unmount();
  });

  it("follows a world point through a resize of the canvas", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const target = { x: 9, y: 5 };
    const { el, unmount } = mountLabel(() => target);
    expectOver(el, target);
    box = { left: 0, top: 64, width: 1280, height: 720 };
    game.resize(1280, 720);
    FakeResizeObserver.fire();
    expect(layer()!.style.width).toBe("1280px");
    expectOver(el, target);
    // A move of the canvas alone (no game resize) keeps the label over the point too.
    box = { ...box, left: 200 };
    FakeResizeObserver.fire();
    expectOver(el, target);
    unmount();
  });

  it("follows a moving point on store changes, and hides while at() is null", () => {
    let target: Vec2 | null = { x: 4, y: 4 };
    const { el, unmount } = mountLabel(() => target);
    expect(el.style.visibility).toBe("");
    target = null;
    game.getStore().setState((s) => ({ ...s, tick: s.tick + 1 }));
    expect(el.style.visibility).toBe("hidden");
    target = { x: 6, y: 3 };
    game.getStore().setState((s) => ({ ...s, tick: s.tick + 1 }));
    expect(el.style.visibility).toBe("");
    expectOver(el, target);
    unmount();
  });
});

describe("watchView", () => {
  it("calls now, on pans, zooms, store changes and canvas resizes, and stops on unsubscribe", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const scales: number[] = [];
    let unwatch = () => {};
    const unmount = mountUi(game, canvas, (ctx) => {
      layOut(ctx.root);
      unwatch = watchView(ctx, () => {
        const a = ctx.game.worldToClient({ x: 0, y: 0 });
        const b = ctx.game.worldToClient({ x: 1, y: 1 });
        scales.push(b.x - a.x);
      });
      return { destroy: () => unwatch() };
    });
    expect(scales).toHaveLength(1);
    game.zoomAt({ x: 700, y: 300 }, 2);
    expect(scales.at(-1)! / scales[0]!).toBeCloseTo(2, 6);
    const afterZoom = scales.length;
    game.panBy({ x: -40, y: 10 });
    expect(scales.length).toBeGreaterThan(afterZoom);
    const beforeResize = scales.length;
    FakeResizeObserver.fire();
    expect(scales.length).toBe(beforeResize + 1);
    unwatch();
    const stopped = scales.length;
    game.getStore().setState((s) => ({ ...s, tick: s.tick + 1 }));
    FakeResizeObserver.fire();
    expect(scales).toHaveLength(stopped);
    unmount();
  });
});
