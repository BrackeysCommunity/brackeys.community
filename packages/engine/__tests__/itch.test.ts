// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { checkItchLayout, ITCH_LIMITS } from "../export/itch";
import type { SceneIssue } from "../scene/types";

const BUILD = [
  { path: "index.html", bytes: 900 },
  { path: "credits.html", bytes: 2_000 },
  { path: "release.json", bytes: 5_000 },
  { path: "code/main-3f9a1c.js", bytes: 300_000 },
  { path: "data/0a.json", bytes: 1_000 },
  { path: "assets/1b.png", bytes: 40_000 },
];

const layout = (issues: SceneIssue[]) => issues.map((i) => [i.code, i.path, i.got]);

describe("ITCH_LIMITS", () => {
  it("holds itch.io's stated HTML5 limits", () => {
    expect(ITCH_LIMITS).toEqual({
      maxFiles: 1000,
      maxTotalBytes: 500_000_000,
      maxFileBytes: 200_000_000,
      maxPathLength: 240,
    });
  });
});

describe("checkItchLayout", () => {
  it("passes a build with index.html at the root inside every limit", () => {
    expect(checkItchLayout(BUILD)).toEqual([]);
  });

  it("fails too many files, as one error on the file list", () => {
    const many = Array.from({ length: ITCH_LIMITS.maxFiles }, (_, i) => ({
      path: `data/${String(i).padStart(4, "0")}.json`,
      bytes: 1,
    }));
    expect(checkItchLayout([...many.slice(0, -BUILD.length), ...BUILD])).toEqual([]);
    const issues = checkItchLayout([...many, ...BUILD]);
    expect(layout(issues)).toEqual([
      ["export-itch-layout", "/build/files", String(ITCH_LIMITS.maxFiles + BUILD.length)],
    ]);
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toMatch(/at most 1000/);
  });

  it("fails a build over the total size", () => {
    const quarter = ITCH_LIMITS.maxTotalBytes / 4;
    const big = [1, 2, 3, 4, 5].map((n) => ({ path: `assets/${n}.ogg`, bytes: quarter }));
    expect(layout(checkItchLayout([...BUILD, ...big]))).toEqual([
      ["export-itch-layout", "/build/files", String(5 * quarter + 348_900)],
    ]);
  });

  it("fails one file over the per-file size, pointing at its row in build.files", () => {
    const issues = checkItchLayout([
      ...BUILD,
      { path: "assets/music.ogg", bytes: ITCH_LIMITS.maxFileBytes + 1 },
    ]);
    // build.files sorted, without release.json: assets/1b.png, assets/music.ogg, …
    expect(layout(issues)).toEqual([
      ["export-itch-layout", "/build/files/1/path", String(ITCH_LIMITS.maxFileBytes + 1)],
    ]);
    expect(issues[0]!.message).toContain("assets/music.ogg");
    expect(checkItchLayout([...BUILD, { path: "a.ogg", bytes: ITCH_LIMITS.maxFileBytes }])).toEqual(
      [],
    );
  });

  it("fails a path over the length limit, counting characters", () => {
    const at = (n: number) => `assets/${"é".repeat(n - "assets/".length)}`;
    expect(checkItchLayout([...BUILD, { path: at(ITCH_LIMITS.maxPathLength), bytes: 1 }])).toEqual(
      [],
    );
    const issues = checkItchLayout([
      ...BUILD,
      { path: at(ITCH_LIMITS.maxPathLength + 1), bytes: 1 },
    ]);
    expect(issues.map((i) => [i.code, i.got])).toEqual([
      ["export-itch-layout", String(ITCH_LIMITS.maxPathLength + 1)],
    ]);
  });

  it("fails a nested root: index.html in a folder", () => {
    const nested = BUILD.map((f) => ({ ...f, path: `game/${f.path}` }));
    const issues = checkItchLayout(nested);
    expect(layout(issues)).toEqual([["export-itch-layout", "/build/files", "game/index.html"]]);
    expect(issues[0]!.message).toMatch(/root/);
  });

  it("fails a build with no index.html at all", () => {
    const issues = checkItchLayout(BUILD.filter((f) => f.path !== "index.html"));
    expect(layout(issues)).toEqual([["export-itch-layout", "/build/files", ""]]);
  });

  it("fails dotfiles, dot folders and __MACOSX", () => {
    for (const path of [".DS_Store", "assets/.hidden.png", ".git/config", "__MACOSX/index.html"]) {
      const issues = checkItchLayout([...BUILD, { path, bytes: 10 }]);
      expect(
        issues.map((i) => [i.code, i.got]),
        path,
      ).toEqual([["export-itch-layout", path]]);
    }
  });

  it("fails every file that would land outside the root folder", () => {
    for (const path of ["../escape.js", "/abs/index.js", "C:/game.js", "code\\main.js", "a//b"]) {
      const issues = checkItchLayout([...BUILD, { path, bytes: 10 }]);
      expect(
        issues.map((i) => [i.code, i.got]),
        path,
      ).toEqual([["export-itch-layout", path]]);
      expect(issues[0]!.message, path).toMatch(/root folder/);
    }
  });

  it("points release.json's own issues at the manifest's root", () => {
    const issues = checkItchLayout(
      BUILD.map((f) =>
        f.path === "release.json" ? { ...f, bytes: ITCH_LIMITS.maxFileBytes + 1 } : f,
      ),
    );
    expect(issues.map((i) => i.path)).toEqual([""]);
  });

  it("is deterministic over input order", () => {
    const bad = [...BUILD, { path: ".env", bytes: 1 }, { path: "../x", bytes: 1 }];
    expect(checkItchLayout([...bad].reverse())).toEqual(checkItchLayout(bad));
  });
});
