import { describe, expect, it } from "vite-plus/test";

import { checkPath, folderTree, pathKey, pathKind, pathTitle, repairPath } from "../paths";

describe("checkPath", () => {
  it.each([
    ["Plan.canvas", "canvas"],
    ["Jam 42/Plan.canvas", "canvas"],
    ["Jam 42/Level ideas.md", "note"],
    ["Jam 42/attachments/boss.webp", "image"],
    ["Ünïcödé/計画.canvas", "canvas"],
  ])("accepts %s as %s", (path, kind) => {
    expect(checkPath(path)).toEqual({ ok: true, path, kind });
  });

  it.each([
    ["", "empty"],
    ["/Plan.canvas", "empty-segment"],
    ["Jam//Plan.canvas", "empty-segment"],
    ["Plan?.canvas", "forbidden-character"],
    ["a\\b.canvas", "forbidden-character"],
    ["tab\there.canvas", "forbidden-character"],
    [" Plan.canvas", "edge-space-or-dot"],
    ["Plan.canvas.", "edge-space-or-dot"],
    [".obsidian/x.canvas", "edge-space-or-dot"],
    ["../x.canvas", "edge-space-or-dot"],
    ["CON.canvas", "reserved-name"],
    ["lpt3/x.md", "reserved-name"],
    ["Plan.pdf", "wrong-kind"],
    ["Plan", "wrong-kind"],
    [`${"a".repeat(256)}.md`, "segment-too-long"],
    [`${Array.from({ length: 11 }, () => "b".repeat(100)).join("/")}.md`, "too-long"],
  ])("refuses %j (%s)", (path, problem) => {
    expect(checkPath(path)).toEqual({ ok: false, problem });
  });

  it("refuses the right path of the wrong kind", () => {
    expect(checkPath("Plan.md", "canvas")).toEqual({ ok: false, problem: "wrong-kind" });
  });

  it("normalises macOS's NFD to NFC", () => {
    const nfd = "Café.md";
    const result = checkPath(nfd);
    expect(result.ok && result.path).toBe("Café.md");
  });

  it("counts bytes, not characters, for segment length", () => {
    expect(checkPath(`${"計".repeat(84)}.md`).ok).toBe(true);
    expect(checkPath(`${"計".repeat(85)}.md`)).toEqual({ ok: false, problem: "segment-too-long" });
  });
});

describe("pathKey", () => {
  it("folds case and Unicode form together", () => {
    expect(pathKey("Jam/CAFÉ.md")).toBe(pathKey("jam/café.md"));
  });
});

describe("repairPath", () => {
  it("replaces, trims, forces the extension and dedupes", () => {
    const taken = new Set([pathKey("Ideas/What-.canvas")]);
    expect(repairPath(" Ideas /What?", "canvas", (k) => taken.has(k))).toBe("Ideas/What- 2.canvas");
    expect(repairPath("CON.md", "note")).toBe("CON_.md");
    expect(repairPath("///", "note")).toBe("Untitled.md");
    expect(repairPath("Plan.canvas", "canvas")).toBe("Plan.canvas");
    expect(repairPath("attachments/Boss Art.WEBP", "image")).toBe("attachments/Boss Art.webp");
    expect(repairPath("attachments/boss", "image")).toBe("attachments/boss.png");
  });

  it("always produces a path checkPath accepts", () => {
    for (const input of ["..", "a:b/c*d", " . ", "nul", "x".repeat(400), "é/\u0000"]) {
      expect(checkPath(repairPath(input, "note")).ok).toBe(true);
    }
  });
});

describe("helpers", () => {
  it("reads kind and title from the path", () => {
    expect(pathKind("a/B.PNG")).toBe("image");
    expect(pathTitle("Jam 42/Level ideas.md")).toBe("Level ideas");
  });

  it("builds the folder tree paths imply", () => {
    const tree = folderTree([
      { path: "b.canvas" },
      { path: "Jam 42/Plan.canvas" },
      { path: "Jam 42/art/moodboard.canvas" },
      { path: "A.canvas" },
    ]);
    expect(tree.files.map((f) => f.path)).toEqual(["A.canvas", "b.canvas"]);
    expect(tree.folders.map((f) => f.path)).toEqual(["Jam 42"]);
    expect(tree.folders[0]!.files.map((f) => f.path)).toEqual(["Jam 42/Plan.canvas"]);
    expect(tree.folders[0]!.folders[0]!.path).toBe("Jam 42/art");
  });
});
