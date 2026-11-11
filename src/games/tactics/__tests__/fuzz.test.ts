// @vitest-environment node
import { fuzz, loadHeadless } from "@jams/engine/headless";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { tacticsGame } from "..";
import { tacticsGoldenInput } from "./pins";

const init = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@dimforge/rapier2d-compat", () => ({ init, default: { init } }));

afterAll(() => {
  expect(init).not.toHaveBeenCalled();
});

describe("fuzz on level 1", () => {
  // Every rollout ends won or lost well inside 3000 slots (about 66k ticks in all).
  it("reaches won within 64 rollouts at seed 7", { timeout: 60_000 }, async () => {
    const loaded = await loadHeadless(tacticsGoldenInput());
    const run = fuzz({
      ...loaded,
      rapier: null,
      game: tacticsGame,
      seed: 7,
      rollouts: 64,
      ticks: 3000,
    });
    if (run.blocked) throw new Error(`fuzz blocked: ${JSON.stringify(run)}`);
    expect(run.results.won ?? 0).toBeGreaterThanOrEqual(1);
    expect(run.results.timeout ?? 0).toBe(0);
    expect(run.legal?.sent).toBeGreaterThan(0);
  });
});
