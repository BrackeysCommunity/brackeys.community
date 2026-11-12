// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import { TACTICS_GOLDEN_DIGEST } from "../../../src/games/tactics/__tests__/pins";
import { judgeTactics } from "../browser-compare";
import { rapierSpy } from "../browser/physics-free";
import { runTactics } from "../browser/tactics";
import { REPO } from "../pack";

const init = vi.hoisted(() => vi.fn());
vi.mock("@dimforge/rapier2d-compat", () => ({ default: { init }, init }));

const BROWSER_DIR = join(REPO, "scripts/engine-smoke/browser");

const never = () => rapierSpy(() => Promise.reject(new Error("the tactics replay loaded Rapier")));

describe("runTactics", () => {
  it("replays level 1's golden recording to the pin with no physics, the same every time", async () => {
    const spy = never();
    const a = await runTactics(spy.load);
    const b = await runTactics(spy.load);
    expect(a).toMatchObject({ physics: "none", result: "won", replayMatches: true });
    expect(a.digest).toBe(TACTICS_GOLDEN_DIGEST);
    expect(b).toEqual(a);
    expect(judgeTactics({ ...a, rapierLoads: spy.calls() })).toBeNull();
    expect(spy.calls()).toBe(0);
    expect(init).not.toHaveBeenCalled();
  }, 60_000);
});

describe("the tactics page run", () => {
  const sourcesOf = (file: string) =>
    [...readFileSync(join(BROWSER_DIR, file), "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1]!,
    );

  it("reaches the engine through public entries and the game through its entry and golden files", () => {
    const sources = sourcesOf("tactics.ts");
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      if (source.startsWith("@jams/engine")) expect(source).toMatch(/^@jams\/engine(\/[a-z-]+)?$/);
      else
        expect(source).toMatch(
          /^\.\.\/\.\.\/\.\.\/src\/games\/tactics(\/__tests__\/(pins|fixtures\/level-1\.recording\.json))?$/,
        );
    }
    expect(sources.some((s) => s.includes("packages/engine"))).toBe(false);
    expect(sources).not.toContain("@dimforge/rapier2d-compat");
  });

  it("is reported by the page beside the other runs", () => {
    expect(sourcesOf("main.ts")).toContain("./tactics");
  });
});
