import { describe, expect, it } from "vite-plus/test";

import { createDebugDrawSink } from "../debug/draw-sink";
import { createRegistry, defineGame } from "../game/define";
import { runProbe } from "../headless/headless";
import { snapshotDigest } from "../runtime/recorder";
import { createSceneRuntime, NOOP_DEBUG_DRAW } from "../runtime/runtime";
import { expandScene } from "../scene/expand";
import { renderSceneSvg } from "../scene/svg";
import { SCENE_FORMAT_VERSION } from "../scene/types";

type Snap = { tick: number };

/** Draws a line at x = tick, and its tick as text, every step, only while something shows them. */
const drawingGame = defineGame<Snap>({
  id: "debug-draw-test",
  types: [],
  actions: [],
  createRuntime(ctx) {
    let tick = 0;
    return {
      beforeStep() {
        tick++;
        if (!ctx.debug.active) return;
        ctx.debug.line({ x: tick, y: 0 }, { x: tick, y: 1 }, { color: 0x00ff00, width: 2 });
        ctx.debug.text({ x: tick, y: 2 }, `t${tick}`);
      },
      snapshot: () => ({ tick }),
    };
  },
});

const def = {
  v: SCENE_FORMAT_VERSION,
  name: "debug-draw",
  bounds: [-1, -1, 10, 10] as [number, number, number, number],
  settings: { physics: "none" as const },
  entities: [],
};

const registry = createRegistry(drawingGame);

function probe(collectDebugDraw: boolean, ticks = 3) {
  return runProbe({
    rapier: null,
    game: drawingGame,
    registry,
    scene: expandScene(def, registry),
    ticks,
    collectDebugDraw,
  });
}

describe("ctx.debug", () => {
  it("keeps a tick's draws for that tick only", () => {
    const sink = createDebugDrawSink();
    const runtime = createSceneRuntime({
      rapier: null,
      view: null,
      game: drawingGame,
      debugDraw: sink,
    });
    try {
      expect(runtime.load(expandScene(def, runtime.ctx.registry)).ok).toBe(true);
      expect(runtime.ctx.debug.active).toBe(true);
      const first = runtime.step(16, []).debug ?? [];
      const second = runtime.step(16, []).debug ?? [];
      expect(first.map((d) => d.kind)).toEqual(["line", "text"]);
      expect(first[0]).toEqual({
        kind: "line",
        a: { x: 1, y: 0 },
        b: { x: 1, y: 1 },
        style: { color: 0x00ff00, width: 2 },
      });
      expect(second).toHaveLength(2);
      expect(second[0]).toMatchObject({ a: { x: 2, y: 0 } });
      expect(sink.take()).toEqual([]);
    } finally {
      runtime.destroy();
    }
  });

  it("copies what game code passes into plain data", () => {
    const sink = createDebugDrawSink();
    const p = { x: 1, y: 2 };
    const pts = [p, { x: 3, y: 4 }];
    sink.draw.path(pts, { closed: true, layer: "ai" });
    sink.draw.box(p, [2, 1]);
    p.x = 99;
    const [path, box] = sink.take();
    expect(path).toEqual({
      kind: "path",
      pts: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      closed: true,
      style: { layer: "ai" },
    });
    expect(box).toEqual({ kind: "box", at: { x: 1, y: 2 }, size: [2, 1], style: {} });
    expect(JSON.parse(JSON.stringify([path, box]))).toEqual([path, box]);
  });

  it("is inactive with no layer and no collector", () => {
    const runtime = createSceneRuntime({ rapier: null, view: null, game: drawingGame });
    try {
      expect(runtime.ctx.debug).toBe(NOOP_DEBUG_DRAW);
      expect(runtime.ctx.debug.active).toBe(false);
    } finally {
      runtime.destroy();
    }
    const report = probe(false);
    expect(report.debug).toBeUndefined();
  });

  it("reports the last tick's draws with collectDebugDraw", () => {
    const report = probe(true, 5);
    expect(report.debug?.map((d) => d.kind)).toEqual(["line", "text"]);
    expect(report.debug?.[0]).toMatchObject({ a: { x: 5, y: 0 } });
  });

  it("never changes the run or its digest", () => {
    const off = probe(false, 10);
    const on = probe(true, 10);
    expect(snapshotDigest(on.final)).toBe(snapshotDigest(off.final));
    expect(on.events).toEqual(off.events);
    expect(JSON.stringify(on.final)).not.toContain("line");
  });

  it("draws the collected draws in the SVG", () => {
    const report = probe(true, 2);
    const svg = renderSceneSvg(def, { registry, debugDraw: report.debug ?? [] });
    expect(svg).toMatch(/data-debug="line" d="M200 0L200 100" fill="none" stroke="#00ff00"/);
    expect(svg).toContain(">t2</text>");
  });

  it("hands out a frozen no-op when no sink exists, and a sink's draw is frozen too", () => {
    expect(Object.isFrozen(NOOP_DEBUG_DRAW)).toBe(true);
    expect(NOOP_DEBUG_DRAW.active).toBe(false);
    expect(NOOP_DEBUG_DRAW.line({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeUndefined();
    expect(Object.isFrozen(createDebugDrawSink().draw)).toBe(true);
  });
});
