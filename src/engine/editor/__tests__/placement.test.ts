import { describe, expect, it } from "vite-plus/test";

import { createPlacementTool, type PlacementGhost } from "../../placement";
import { placedShape } from "../placement";

type Template = "plank" | "orb";

function setup(valid = true) {
  const calls: string[] = [];
  const commits: PlacementGhost<Template>[] = [];
  const tool = createPlacementTool<Template>({
    rotatable: (t) => t === "plank",
    draw: {
      show: (g) => calls.push(`show ${g.template} ${g.at.x},${g.at.y} ${g.rotation}`),
      pose: (g) => calls.push(`pose ${g.at.x},${g.at.y} ${g.rotation}`),
      hide: () => calls.push("hide"),
    },
    validate: () => (valid ? { valid: true } : { valid: false, reason: "nope" }),
    commit: (g) => void commits.push(g),
  });
  return { tool, calls, commits };
}

describe("createPlacementTool", () => {
  it("shows the ghost on select, poses it as the pointer moves and hides it on clear", () => {
    const { tool, calls } = setup();
    tool.move({ x: 5, y: 6 });
    expect(calls).toEqual([]);
    tool.select("plank");
    tool.move({ x: 10, y: 20 });
    tool.move({ x: 11, y: 20 }, false);
    tool.move({ x: 12, y: 20 });
    tool.clear();
    tool.clear();
    expect(calls).toEqual([
      "show plank 5,6 0",
      "pose 10,20 0",
      "hide",
      "show plank 12,20 0",
      "hide",
    ]);
    expect(tool.selected()).toBeNull();
  });

  it("turns rotatable templates by 0.15 rad a step and resets rotation on select", () => {
    const { tool } = setup();
    tool.select("plank");
    tool.rotate(1);
    tool.rotate(1);
    tool.rotate(-1);
    expect(tool.ghost()!.rotation).toBe(0 + 1 * 0.15 + 1 * 0.15 + -1 * 0.15);
    tool.select("orb");
    tool.rotate(1);
    expect(tool.ghost()!.rotation).toBe(0);
  });

  it("commits a valid placement and refuses an invalid one", () => {
    const ok = setup();
    expect(ok.tool.place()).toEqual({ valid: false, reason: "Nothing selected" });
    ok.tool.select("plank");
    ok.tool.move({ x: 3, y: 4 });
    expect(ok.tool.place()).toEqual({ valid: true });
    expect(ok.commits).toEqual([{ template: "plank", at: { x: 3, y: 4 }, rotation: 0 }]);
    expect(ok.tool.selected()).toBe("plank");

    const bad = setup(false);
    bad.tool.select("orb");
    expect(bad.tool.place()).toEqual({ valid: false, reason: "nope" });
    expect(bad.commits).toEqual([]);
  });

  it("hides without dropping the template", () => {
    const { tool, calls } = setup();
    tool.select("plank");
    tool.hide();
    expect(tool.selected()).toBe("plank");
    tool.move({ x: 1, y: 1 });
    expect(calls).toEqual(["show plank 0,0 0", "hide", "show plank 1,1 0"]);
  });
});

describe("placedShape", () => {
  it("turns a box by its rotation and a poly about its origin", () => {
    expect(
      placedShape({ type: "box", cx: 0, cy: 0, hw: 4, hh: 2, rotDeg: 0 }, [10, 20], 90),
    ).toEqual({ type: "box", cx: 10, cy: 20, hw: 4, hh: 2, rotDeg: 90 });
    const poly = placedShape(
      {
        type: "poly",
        pts: [
          [0, 0],
          [4, 0],
          [0, 2],
        ],
      },
      [10, 0],
      90,
    );
    expect(
      poly.type === "poly" && poly.pts.map(([x, y]) => [Math.round(x), Math.round(y)]),
    ).toEqual([
      [10, 0],
      [10, 4],
      [8, 0],
    ]);
  });
});
