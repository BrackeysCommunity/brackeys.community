// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("pixi.js", () => {
  throw new Error("pixi.js was imported");
});

describe("./headless without pixi.js", () => {
  it("can't import pixi.js in this file", async () => {
    await expect(import("pixi.js")).rejects.toThrow();
  });

  it("imports the entry and runs a probe on engine-yard with the test game", async () => {
    const { runProbe } = await import("../index");
    const { engineYard } = await import("../../__tests__/fixtures/engine-yard.expanded");
    const { testGame } = await import("../../__tests__/fixtures/test-game");
    const rapier = await import("@dimforge/rapier2d");

    const report = runProbe({ rapier, game: testGame, scene: engineYard(), ticks: 60 });

    expect(report.load.ok).toBe(true);
    expect(report.ticks).toBe(60);
    expect(report.final).not.toBeNull();
  });
});
