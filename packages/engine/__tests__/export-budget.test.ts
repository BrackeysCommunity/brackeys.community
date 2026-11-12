import { describe, expect, test } from "vite-plus/test";

import {
  DEFAULT_EXPORT_BUDGET,
  budgetIssues,
  formatBytes,
  measureBudget,
  resolveExportBudget,
  type BudgetContent,
} from "../export/budget";
import type { ReleaseAsset, ReleaseFile, ReleaseScene } from "../project/release";

const MiB = 1024 * 1024;

function file(path: string, bytes: number, role: ReleaseFile["role"]): ReleaseFile {
  return { path, bytes, role, sha256: "0".repeat(64) };
}

function blob(file: string, bytes: number): ReleaseAsset {
  return {
    key: file,
    kind: "audio",
    path: `${file}.src`,
    sha256: "1".repeat(64),
    bytes,
    storage: "blob",
    file,
  };
}

function scene(id: string, physics: ReleaseScene["physics"], entries: string[] = []): ReleaseScene {
  return { id, physics, prefabs: [], bundle: { entries, bytes: 0 } };
}

const files: ReleaseFile[] = [
  file("index.html", 400, "shell"),
  file("code/main-aa.js", 600_000, "code"),
  file("code/main-bb.css", 4_000, "style"),
  file("code/rapier-cc.wasm", 1_400_000, "wasm"),
  file("data/s1.json", 3_000, "data"),
  file("data/s2.json", 2_000, "data"),
  file("assets/tile.png", 20_000, "asset"),
  file("assets/hero.png", 30_000, "asset"),
  file("assets/music.ogg", 5_000_000, "asset"),
  file("icons/icon-192.png", 1_000, "icon"),
];

const assets: Record<string, ReleaseAsset> = {
  tile: blob("assets/tile.png", 20_000),
  hero: blob("assets/hero.png", 30_000),
  "music-loop": blob("assets/music.ogg", 5_000_000),
};

function content(startPhysics: ReleaseScene["physics"] = "none"): BudgetContent {
  return {
    start: "level-1",
    scenes: [
      scene("level-1", startPhysics, ["hero", "tile"]),
      scene("level-2", "rapier", ["music-loop"]),
    ],
    projectBundle: { entries: ["tile"], bytes: 20_000 },
    assets,
  };
}

describe("measureBudget", () => {
  test("sums by role", () => {
    const report = measureBudget(files, content(), DEFAULT_EXPORT_BUDGET);
    expect(report.limits).toEqual(DEFAULT_EXPORT_BUDGET);
    expect(report.measured).toEqual({
      codeBytes: 604_000,
      wasmBytes: 1_400_000,
      firstLoadBytes: 604_000 + 5_000 + 20_000 + 30_000,
      assetBytes: 5_050_000,
      dataBytes: 5_000,
      totalBytes: 7_060_400,
      largestFile: { path: "assets/music.ogg", bytes: 5_000_000 },
    });
    expect(report.over).toEqual([]);
  });

  test("first load counts wasm only when the start scene needs Rapier", () => {
    const none = measureBudget(files, content("none"), DEFAULT_EXPORT_BUDGET);
    const rapier = measureBudget(files, content("rapier"), DEFAULT_EXPORT_BUDGET);
    expect(rapier.measured.firstLoadBytes - none.measured.firstLoadBytes).toBe(1_400_000);
    expect(rapier.measured.wasmBytes).toBe(none.measured.wasmBytes);
  });

  test("a physics-free build measures no wasm; -compat's inlined wasm counts as code", () => {
    const standard = measureBudget(files, content("rapier"), DEFAULT_EXPORT_BUDGET);
    const free = measureBudget(
      files.filter((f) => f.role !== "wasm"),
      { ...content(), scenes: content().scenes.map((s) => ({ ...s, physics: "none" as const })) },
      DEFAULT_EXPORT_BUDGET,
    );
    expect(free.measured.wasmBytes).toBe(0);
    expect(standard.measured.firstLoadBytes - free.measured.firstLoadBytes).toBe(1_400_000);

    const compat = measureBudget(
      files
        .filter((f) => f.role !== "wasm")
        .map((f) => (f.path === "code/main-aa.js" ? { ...f, bytes: f.bytes + 1_900_000 } : f)),
      content("rapier"),
      DEFAULT_EXPORT_BUDGET,
    );
    expect(compat.measured.wasmBytes).toBe(0);
    expect(compat.measured.codeBytes - standard.measured.codeBytes).toBe(1_900_000);
    expect(compat.measured.firstLoadBytes - standard.measured.firstLoadBytes).toBe(500_000);
  });

  test("a blob in both bundles counts once; one missing from files counts at its asset size", () => {
    const shared = measureBudget(files, content(), DEFAULT_EXPORT_BUDGET);
    expect(shared.measured.firstLoadBytes).toBe(659_000);
    const missing = measureBudget(
      files.filter((f) => f.path !== "assets/hero.png"),
      content(),
      DEFAULT_EXPORT_BUDGET,
    );
    expect(missing.measured.firstLoadBytes).toBe(659_000);
    expect(missing.measured.totalBytes).toBe(7_030_400);
  });

  test("an empty build measures zero and is within every budget", () => {
    const report = measureBudget(
      [],
      { start: "x", scenes: [], projectBundle: { entries: [], bytes: 0 }, assets: {} },
      DEFAULT_EXPORT_BUDGET,
    );
    expect(report.measured.largestFile).toEqual({ path: "", bytes: 0 });
    expect(report.measured.totalBytes).toBe(0);
    expect(report.over).toEqual([]);
  });

  test.each([
    ["codeBytes", { codeBytes: 603_999 }],
    ["firstLoadBytes", { firstLoadBytes: 658_999 }],
    ["totalBytes", { totalBytes: 7_060_399 }],
    ["fileBytes", { fileBytes: 4_999_999 }],
  ] as const)("%s alone is over when its limit is one byte short", (key, override) => {
    const report = measureBudget(files, content(), resolveExportBudget(override));
    expect(report.over).toEqual([key]);
  });

  test("a size equal to its limit is within it", () => {
    const limits = resolveExportBudget({
      codeBytes: 604_000,
      firstLoadBytes: 659_000,
      totalBytes: 7_060_400,
      fileBytes: 5_000_000,
    });
    expect(measureBudget(files, content(), limits).over).toEqual([]);
  });

  test("over lists every budget exceeded in the type's order", () => {
    const report = measureBudget(
      files,
      content(),
      resolveExportBudget({ fileBytes: 1, totalBytes: 1, firstLoadBytes: 1, codeBytes: 1 }),
    );
    expect(report.over).toEqual(["codeBytes", "firstLoadBytes", "totalBytes", "fileBytes"]);
  });
});

describe("resolveExportBudget", () => {
  test("defaults to 4 MiB of code, 16 MiB to the first frame, 100 MiB in all and 32 MiB per file", () => {
    expect(DEFAULT_EXPORT_BUDGET).toEqual({
      codeBytes: 4 * MiB,
      firstLoadBytes: 16 * MiB,
      totalBytes: 100 * MiB,
      fileBytes: 32 * MiB,
    });
    expect(resolveExportBudget()).toEqual(DEFAULT_EXPORT_BUDGET);
  });

  test("each override replaces only the fields it sets, the last winning", () => {
    expect(
      resolveExportBudget({ totalBytes: 50 * MiB }, undefined, {
        fileBytes: 1,
        totalBytes: undefined,
      }),
    ).toEqual({ ...DEFAULT_EXPORT_BUDGET, totalBytes: 50 * MiB, fileBytes: 1 });
    expect(resolveExportBudget({ codeBytes: 1 }, { codeBytes: 2 }).codeBytes).toBe(2);
  });

  test("the defaults are never mutated", () => {
    resolveExportBudget({ codeBytes: 1 });
    expect(DEFAULT_EXPORT_BUDGET.codeBytes).toBe(4 * MiB);
  });
});

describe("export-over-budget", () => {
  test("names the budget, the measured size, the limit and the largest contributors", () => {
    const big: ReleaseFile[] = [
      file("code/main-aa.js", 2 * MiB, "code"),
      file("assets/music.ogg", 88 * MiB, "asset"),
      file("assets/hero.png", 30 * MiB, "asset"),
      file("assets/tile.png", 11 * MiB, "asset"),
    ];
    const plan: BudgetContent = {
      ...content(),
      scenes: [scene("level-1", "none")],
      projectBundle: { entries: [], bytes: 0 },
    };
    const report = measureBudget(big, plan, DEFAULT_EXPORT_BUDGET);
    expect(report.over).toEqual(["totalBytes", "fileBytes"]);
    const issues = budgetIssues(report, big, plan);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ["export-over-budget", "error"],
      ["export-over-budget", "error"],
    ]);
    expect(issues[0]?.message).toBe(
      "totalBytes 131 MB over 100 MB: assets/music.ogg 88 MB (music-loop), assets/hero.png 30 MB (hero), assets/tile.png 11 MB (tile). Lower the asset's size or raise export.budget.totalBytes.",
    );
    expect(issues[1]?.message).toBe(
      "fileBytes 88 MB over 32 MB: assets/music.ogg 88 MB (music-loop). Lower the asset's size or raise export.budget.fileBytes.",
    );
    expect(issues[1]?.detail).toEqual({
      budget: "fileBytes",
      measured: 88 * MiB,
      limit: 32 * MiB,
      contributors: [{ path: "assets/music.ogg", bytes: 88 * MiB, asset: "music-loop" }],
    });
  });

  test("code and first-load messages name their own contributors", () => {
    const report = measureBudget(
      files,
      content("rapier"),
      resolveExportBudget({ codeBytes: 100_000, firstLoadBytes: 1 * MiB }),
    );
    const [code, firstLoad] = budgetIssues(report, files, content("rapier"));
    expect(code?.message).toBe(
      "codeBytes 590 KB over 98 KB: code/main-aa.js 586 KB, code/main-bb.css 4 KB. Lower the code's size or raise export.budget.codeBytes.",
    );
    expect(firstLoad?.message).toBe(
      "firstLoadBytes 2 MB over 1 MB: code/rapier-cc.wasm 1.3 MB, code/main-aa.js 586 KB, assets/hero.png 29 KB (hero). Lower the wasm's size or raise export.budget.firstLoadBytes.",
    );
  });

  test("the project's override is the limit the message names", () => {
    const limits = resolveExportBudget({ totalBytes: 50 * MiB });
    const big = [
      file("assets/music.ogg", 30 * MiB, "asset"),
      file("assets/hero.png", 30 * MiB, "asset"),
    ];
    const plan: BudgetContent = {
      ...content(),
      scenes: [scene("level-1", "none")],
      projectBundle: { entries: [], bytes: 0 },
    };
    const report = measureBudget(big, plan, limits);
    expect(report.limits.totalBytes).toBe(50 * MiB);
    expect(report.over).toEqual(["totalBytes"]);
    expect(budgetIssues(report, big, plan)[0]?.message).toBe(
      "totalBytes 60 MB over 50 MB: assets/hero.png 30 MB (hero), assets/music.ogg 30 MB (music-loop). Lower the asset's size or raise export.budget.totalBytes.",
    );
  });

  test("a build within budget raises nothing", () => {
    const report = measureBudget(files, content(), DEFAULT_EXPORT_BUDGET);
    expect(budgetIssues(report, files, content())).toEqual([]);
  });
});

test("formatBytes", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1023)).toBe("1023 B");
  expect(formatBytes(14 * 1024)).toBe("14 KB");
  expect(formatBytes(1.4 * MiB)).toBe("1.4 MB");
  expect(formatBytes(100 * MiB)).toBe("100 MB");
});
