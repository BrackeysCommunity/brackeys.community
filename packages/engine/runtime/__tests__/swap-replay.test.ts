import { describe, expect, it, vi } from "vite-plus/test";

import type { RecordedSwap } from "../../scene/recording-schema";
import { createSwapReplay, type SwapReplayOptions } from "../live";

const swap = (tick: number): RecordedSwap => ({
  tick,
  version: null,
  strategy: "reconcile",
  timing: "now",
  sceneHash: "s",
  runHash: "r",
});

function setup(ticks: number[]) {
  const applied: number[] = [];
  const stale = vi.fn();
  const live = {
    stage: vi.fn(),
    activate: vi.fn(),
    apply: vi.fn((_scene: string, _target: unknown, o: { tick: number }) => {
      applied.push(o.tick);
      return { ok: true, swap: { strategy: "reconcile", to: { runHash: "r" } } };
    }),
  } as unknown as SwapReplayOptions["live"];
  const replay = createSwapReplay({
    live,
    swaps: ticks.map(swap),
    scene: () => "level",
    resolve: () => ({ ok: false, issues: [] }),
    stale,
  });
  const run = (from: number, to: number) => {
    for (let t = from; t <= to; t++) expect(replay.before(t)).toBeNull();
  };
  return { replay, applied, stale, run };
}

describe("createSwapReplay's from", () => {
  it("skips ahead to the swaps at and after a tick, applying none before it", () => {
    const t = setup([2, 5, 5, 9]);
    t.replay.from(5);
    t.run(5, 10);
    expect(t.applied).toEqual([5, 5, 9]);
    expect(t.stale).not.toHaveBeenCalled();
  });

  it("goes back for a seek behind the swaps already applied", () => {
    const t = setup([2, 5, 9]);
    t.run(0, 10);
    t.replay.from(3);
    t.run(3, 10);
    expect(t.applied).toEqual([2, 5, 9, 5, 9]);
    expect(t.stale).not.toHaveBeenCalled();
  });

  it("leaves nothing to apply past the last swap", () => {
    const t = setup([2]);
    t.replay.from(3);
    t.run(3, 6);
    expect(t.applied).toEqual([]);
  });
});
