import { describe, expect, it } from "vite-plus/test";

import { debugModes, ENGINE_DEBUG_LAYERS } from "../debug";
import { createEventLog } from "../debug/event-log";
import { createRegistry } from "../game/define";
import { createSceneRuntime, NOOP_DEBUG_DRAW } from "../runtime/runtime";
import { TICK_PHASES } from "../runtime/timings";
import type { StepEvent } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION } from "../scene/types";

const at = { x: 0, y: 0 };

describe("the debugging contract", () => {
  it("gives ctx.debug a frozen no-op, inactive, without a host's sink", () => {
    const runtime = createSceneRuntime({ rapier: null, view: null });
    try {
      expect(runtime.ctx.debug.active).toBe(false);
      expect(runtime.ctx.debug).toBe(NOOP_DEBUG_DRAW);
      expect(Object.isFrozen(NOOP_DEBUG_DRAW)).toBe(true);
      expect(() => runtime.ctx.debug.line(at, { x: 1, y: 1 })).not.toThrow();
    } finally {
      runtime.destroy();
    }
  });

  it("reports no timings without the option", () => {
    const runtime = createSceneRuntime({ rapier: null, view: null });
    try {
      expect(runtime.timings()).toBeNull();
    } finally {
      runtime.destroy();
    }
  });

  it("leaves StepResult.debug unset without a sink", () => {
    const runtime = createSceneRuntime({ rapier: null, view: null });
    try {
      const registry = createRegistry();
      const report = runtime.load(
        expandScene(
          {
            v: SCENE_FORMAT_VERSION,
            name: "empty",
            bounds: [-1, -1, 1, 1],
            settings: { physics: "none" },
            entities: [],
          },
          registry,
        ),
      );
      expect(report.ok).toBe(true);
      expect(runtime.step(16, []).debug).toBeUndefined();
    } finally {
      runtime.destroy();
    }
  });

  it("registers the perf and debug-draw layers after the grid and the physics", () => {
    expect(debugModes(ENGINE_DEBUG_LAYERS)).toEqual([
      "off",
      "grid",
      "physics",
      "debug-draw",
      "perf",
    ]);
    const byId = new Map(ENGINE_DEBUG_LAYERS.map((l) => [l.id, l]));
    expect(byId.get("perf")?.needs).toEqual({ timings: true });
    expect(byId.get("debug-draw")?.needs).toEqual({ debugDraw: true });
  });

  it("times the eleven phases in tick order", () => {
    expect(TICK_PHASES).toHaveLength(11);
    expect(TICK_PHASES[0]).toBe("systems-before");
    expect(TICK_PHASES.at(-1)).toBe("commit");
  });

  it("keeps an event log of appended ticks, oldest first, within its capacity", () => {
    const log = createEventLog({ capacity: 3 });
    const seen: number[] = [];
    const off = log.subscribe((tick) => seen.push(tick));
    const event = (tick: number, type: string): StepEvent => ({ tick, type, at });
    log.append(0, [event(0, "a"), event(0, "b")]);
    log.append(1, []);
    log.append(2, [event(2, "c"), event(2, "d")]);
    expect(log.list().map((e) => e.type)).toEqual(["b", "c", "d"]);
    expect(seen).toEqual([0, 2]);
    off();
    log.append(3, [event(3, "e")]);
    expect(seen).toEqual([0, 2]);
    log.clear();
    expect(log.list()).toEqual([]);
  });
});
