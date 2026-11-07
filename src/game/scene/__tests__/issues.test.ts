import { describe, expect, it } from "vite-plus/test";

import { ISSUE_CODES, jsonPointer, lineAt, makeIssue, pointerSegments } from "../issues";
import { ISSUE_CODE_LIST } from "../types";

describe("ISSUE_CODES", () => {
  it("registers exactly the contract's codes, each with a summary and hint", () => {
    expect(Object.keys(ISSUE_CODES).sort()).toEqual([...ISSUE_CODE_LIST].sort());
    for (const code of ISSUE_CODE_LIST) {
      expect(ISSUE_CODES[code].hint.length, code).toBeGreaterThan(0);
      expect(ISSUE_CODES[code].summary.length, code).toBeGreaterThan(0);
    }
  });

  it("makeIssue fills severity, hint and entityIds", () => {
    expect(makeIssue("no-kill-plane", { message: "m" })).toEqual({
      severity: "info",
      code: "no-kill-plane",
      message: "m",
      entityIds: [],
      hint: ISSUE_CODES["no-kill-plane"].hint,
    });
    expect(makeIssue("dup-id", { message: "m", hint: "h", entityIds: ["a"] })).toMatchObject({
      severity: "error",
      hint: "h",
      entityIds: ["a"],
    });
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
    expect(lineAt(lines, "/spawn/0")).toBe(1);
    expect(lineAt(new Map(), "/x")).toBeUndefined();
  });
});
