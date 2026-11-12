import { describe, expect, it } from "vite-plus/test";

import { stepNotice } from "../session/use-scene-editor";

describe("stepNotice", () => {
  const step = { how: "undo" as const, label: "Move pad", scene: "Cellar" };

  it("says the scene is opening, then what was taken, or that it couldn't be", () => {
    expect(stepNotice(step, "opening")).toBe("Opening Cellar to undo Move pad…");
    expect(stepNotice(step, "taken")).toBe("Undid Move pad in Cellar");
    expect(stepNotice(step, "failed")).toBe("Couldn't undo Move pad in Cellar");
    expect(stepNotice({ ...step, how: "redo" }, "taken")).toBe("Redid Move pad in Cellar");
    expect(stepNotice({ ...step, how: "redo" }, "failed")).toBe("Couldn't redo Move pad in Cellar");
  });
});
