// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { perfLines, perfPlan } from "../debug/perf";
import { createFrameTimings, TICK_PHASES, type RuntimeTimings } from "../runtime/timings";

describe("the shell's frame timings", () => {
  it("give each part's mean and worst per frame over a window of frames", () => {
    const frames = createFrameTimings(2);
    frames.add("render", 1);
    frames.add("present", 2);
    frames.end();
    expect(frames.view()).toBeNull();
    frames.add("render", 3);
    frames.add("render", 1);
    frames.end();
    expect(frames.view()).toEqual({
      render: { mean: 2.5, max: 4 },
      present: { mean: 1, max: 2 },
    });
    frames.add("render", 9);
    frames.end();
    expect(frames.view()?.render.max).toBe(4);
  });

  it("show in the perf layer's lines after the phases", () => {
    const timings: RuntimeTimings = {
      ticks: 120,
      phases: Object.fromEntries(
        TICK_PHASES.map((p) => [p, { mean: 0.1, max: 0.2 }]),
      ) as RuntimeTimings["phases"],
      systems: {},
      behaviors: {},
      frame: { render: { mean: 0.5, max: 1 }, present: { mean: 1.5, max: 3 } },
    };
    const lines = perfLines(perfPlan(timings));
    const at = lines.indexOf("frame ms (mean / max)");
    expect(at).toBe(1 + TICK_PHASES.length);
    expect(lines.slice(at + 1, at + 3)).toEqual([
      "  render 0.500 / 1.000",
      "  present 1.500 / 3.000",
    ]);
    expect(perfPlan({ ...timings, frame: undefined }).frame).toBeNull();
  });
});
