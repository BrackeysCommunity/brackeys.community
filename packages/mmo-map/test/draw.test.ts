import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { centreOn } from "../src/camera.ts";
import { ChunkCache, paint } from "../src/draw.ts";
import { buildFrame, type DrawOp } from "../src/frame.ts";
import { DEFAULT_LAYERS } from "../src/layers.ts";
import { resolveStyle } from "../src/style.ts";
import { packStyle, syntheticWorld } from "./support.ts";

// A 2D context that records the calls made on it, standing in for the DOM.
function recorder() {
  const calls: { name: string; args: unknown[] }[] = [];
  let transform = { a: 1, b: 0 };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key === "calls") return calls;
      if (key === "getTransform") return () => transform;
      if (key === "setTransform") {
        return (a: number, b: number) => {
          transform = { a, b };
          calls.push({ name: key, args: [a, b] });
        };
      }
      if (key in target) return target[key];
      return (...args: unknown[]) => calls.push({ name: key, args });
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx, calls, scaleBy: (s: number) => (transform = { a: s, b: 0 }) };
}

class FakeOffscreen {
  readonly rec = recorder();
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return this.rec.ctx;
  }
}

const g = globalThis as unknown as { OffscreenCanvas?: unknown };
const had = g.OffscreenCanvas;
beforeAll(() => {
  g.OffscreenCanvas = FakeOffscreen;
});
afterAll(() => {
  g.OffscreenCanvas = had;
});

const ops: DrawOp[] = [
  { kind: "hex", x: 0, y: 0, size: 1, fill: "rgba(1, 2, 3, 1)" },
  { kind: "hex", x: 3, y: 0, size: 1, fill: "rgba(1, 2, 3, 1)" },
  { kind: "label", x: 0, y: 0, text: "Name", colour: "rgba(0, 0, 0, 1)" },
];

describe("ChunkCache", () => {
  test("one bitmap a key and scale, sized to the ops, labels left out", () => {
    const cache = new ChunkCache(4);
    const a = cache.placed("k", ops, 8);
    expect(cache.placed("k", ops, 8)).toBe(a);
    expect(cache.placed("k", ops, 16)).not.toBe(a);
    expect(a).toMatchObject({ left: -1, top: -1, width: 5, height: 2 });
    const img = a.image as unknown as FakeOffscreen;
    expect([img.width, img.height]).toEqual([40, 16]);
    expect(img.rec.calls.filter((c) => c.name === "fillText")).toHaveLength(0);
    expect(img.rec.calls.filter((c) => c.name === "fill")).toHaveLength(2);
    expect(cache.bitmap("k", ops, 8)).toBe(a.image);
  });

  test("drops the least recently used past max", () => {
    const cache = new ChunkCache(2);
    const a = cache.placed("a", ops, 4);
    cache.placed("b", ops, 4);
    cache.placed("a", ops, 4);
    cache.placed("c", ops, 4);
    expect(cache.placed("a", ops, 4)).toBe(a);
    const b2 = cache.placed("b", ops, 4);
    expect(cache.placed("b", ops, 4)).toBe(b2);
  });
});

describe("paint", () => {
  const style = resolveStyle(packStyle());
  const world = syntheticWorld(12, 4);
  const view = { width: 800, height: 600 };
  const frame = (size: number) => {
    const camera = centreOn({ q: 0, r: 0 }, size);
    return {
      camera,
      f: buildFrame({
        camera,
        view,
        index: world.index,
        regions: world.regions,
        chunks: world.chunks,
        layers: DEFAULT_LAYERS,
        style,
        overlay: {
          world: "test",
          tick: 1,
          viewer: "character",
          tiles: [{ q: 0, r: 0, fog: "sight" }],
          fronts: [],
          self: { character: "c", q: 0, r: 0 },
        },
      }),
    };
  };

  test("blits each base list from the cache, then labels and live ops", () => {
    const { camera, f } = frame(14);
    const { ctx, calls } = recorder();
    const cache = new ChunkCache(64);
    paint(ctx as unknown as CanvasRenderingContext2D, f, camera, view, cache);
    expect(calls[1]).toEqual({ name: "clearRect", args: [0, 0, 800, 600] });
    expect(calls.filter((c) => c.name === "drawImage")).toHaveLength(f.base.length);
    expect(calls.filter((c) => c.name === "fillText").map((c) => c.args[0])).toContain("Rustwater");
    expect(calls.filter((c) => c.name === "stroke").length).toBeGreaterThan(0);
    expect(calls.at(-1)?.name).toBe("restore");
  });

  test("past the largest bitmap scale, draws vectors instead", () => {
    const { camera, f } = frame(30);
    const { ctx, calls } = recorder();
    paint(ctx as unknown as CanvasRenderingContext2D, f, camera, view, new ChunkCache(64));
    expect(calls.filter((c) => c.name === "drawImage")).toHaveLength(0);
    expect(calls.filter((c) => c.name === "fill").length).toBeGreaterThan(100);
  });

  test("the device pixel ratio counts towards the bitmap scale", () => {
    const { camera, f } = frame(14);
    const { ctx, calls, scaleBy } = recorder();
    scaleBy(2);
    paint(ctx as unknown as CanvasRenderingContext2D, f, camera, view, new ChunkCache(64));
    expect(calls.filter((c) => c.name === "drawImage")).toHaveLength(0);
  });

  test("a region name waits until the region spans enough of the view", () => {
    const { camera, f } = frame(1);
    const { ctx, calls } = recorder();
    paint(ctx as unknown as CanvasRenderingContext2D, f, camera, view, new ChunkCache(4));
    expect(calls.filter((c) => c.name === "fillText")).toHaveLength(0);
    const near = frame(3.5);
    const r2 = recorder();
    paint(
      r2.ctx as unknown as CanvasRenderingContext2D,
      near.f,
      near.camera,
      view,
      new ChunkCache(4),
    );
    expect(r2.calls.filter((c) => c.name === "fillText")).toHaveLength(4);
  });
});
