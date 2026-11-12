import { describe, expect, it } from "vite-plus/test";

import { ISSUE_CODES, jsonPointer, lineAt, makeIssue, pointerSegments } from "../issues";
import { ENGINE_ISSUE_CODE_LIST } from "../types";
import { fake } from "./fixtures/fake-game";

describe("ISSUE_CODES", () => {
  it("registers exactly the engine's codes, each with a summary and hint", () => {
    expect(Object.keys(ISSUE_CODES).sort()).toEqual([...ENGINE_ISSUE_CODE_LIST].sort());
    for (const code of ENGINE_ISSUE_CODE_LIST) {
      expect(ISSUE_CODES[code].hint.length, code).toBeGreaterThan(0);
      expect(ISSUE_CODES[code].summary.length, code).toBeGreaterThan(0);
    }
    expect(Object.keys(ISSUE_CODES).some((c) => c.includes("/"))).toBe(false);
  });

  it("makeIssue fills severity, hint and entityIds", () => {
    expect(makeIssue("hidden-layer", { message: "m" })).toEqual({
      severity: "info",
      code: "hidden-layer",
      message: "m",
      entityIds: [],
      hint: ISSUE_CODES["hidden-layer"].hint,
    });
    expect(makeIssue("dup-id", { message: "m", hint: "h", entityIds: ["a"] })).toMatchObject({
      severity: "error",
      hint: "h",
      entityIds: ["a"],
    });
  });

  it("makeIssue looks a game's codes up in the registry's", () => {
    expect(makeIssue("fake/no-flag", { message: "m" }, fake.issueCodes)).toMatchObject({
      severity: "warn",
      hint: "Add a flag.",
    });
    expect(() => makeIssue("fake/no-flag", { message: "m" })).toThrow(/unknown issue code/);
  });
});

describe("pointers", () => {
  it("escapes and splits segments", () => {
    expect(jsonPointer(["solid:ice", 3])).toBe("/solid:ice/3");
    expect(jsonPointer(["a/b", "c~d"])).toBe("/a~1b/c~0d");
    expect(pointerSegments("/a~1b/c~0d")).toEqual(["a/b", "c~d"]);
    expect(jsonPointer([])).toBe("");
  });

  it("falls back to the nearest ancestor's line", () => {
    const lines = new Map([
      ["", 1],
      ["/entities/2", 9],
    ]);
    expect(lineAt(lines, "/entities/2/path/pts/1")).toBe(9);
    expect(lineAt(lines, "/solid/0")).toBe(1);
    expect(lineAt(new Map(), "/x")).toBeUndefined();
  });
});
