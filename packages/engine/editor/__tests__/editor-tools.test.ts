import { describe, expect, it } from "vite-plus/test";

import {
  fakeToolContext,
  pointer,
  testCrateTool,
  testStrokeTool,
  toolRegistry,
} from "../../__tests__/fixtures/test-tool";
import type { SceneDefinition } from "../../scene/types";
import { DEFAULT_SNAP } from "../tools";

const doc = (): SceneDefinition => ({
  v: 1,
  game: "test-game",
  name: "tools",
  bounds: [0, 0, 1000, 1000],
  entities: [],
});

describe("a game's editor tools", () => {
  it("load lazily from the game definition", async () => {
    const tools = await toolRegistry.game!.editor!.tools!();
    expect(tools.map((t) => t.id)).toEqual(["test-stroke", "test-crate"]);
  });

  it("commit exactly one batch per stroke, previewing on the way", () => {
    const ctx = fakeToolContext(toolRegistry, doc());
    const tool = testStrokeTool.create(ctx);
    expect(tool.pointer!(pointer("down", [0.62, 0.7]))).toBe(true);
    expect(tool.gesture!()).toBe(true);
    tool.pointer!(pointer("move", [1.3, 0.64]));
    tool.pointer!(pointer("move", [2, 1.3]));
    tool.pointer!(pointer("up", [2, 1.3]));

    expect(ctx.commits).toHaveLength(1);
    // On the default 0.5 m grid.
    expect(ctx.commits[0]!.ops).toEqual([
      { op: "add", entity: { type: "solid", shape: ["chain", 0.5, 0.5, 1.5, 0.5, 2, 1.5] } },
    ]);
    expect(ctx.previews.length).toBeGreaterThan(1);
    expect(ctx.previews.at(-1)).toBeNull();
    expect(ctx.doc.entities).toHaveLength(1);
    expect(tool.gesture!()).toBe(false);
  });

  it("cancel with Escape mid-stroke and leave no batch", () => {
    const ctx = fakeToolContext(toolRegistry, doc());
    const tool = testStrokeTool.create(ctx);
    tool.pointer!(pointer("down", [0, 0]));
    tool.pointer!(pointer("move", [256, 0]));
    expect(tool.cancel!()).toBe(true);
    tool.pointer!(pointer("up", [256, 0]));
    expect(ctx.commits).toEqual([]);
    expect(ctx.previews.at(-1)).toBeNull();
    expect(tool.cancel!()).toBe(false);
  });
});

describe("placementEditorTool", () => {
  const free = { ...DEFAULT_SNAP, enabled: false };

  it("commits one add batch per placement and selects what it placed", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const tool = testCrateTool.create(ctx);
    expect(tool.command!("barrel")).toBe(false);
    expect(tool.command!("crate")).toBe(true);
    tool.pointer!(pointer("move", [100.004, 200.006]));
    tool.pointer!(pointer("down", [100.004, 200.006]));
    tool.pointer!(pointer("up", [100.004, 200.006]));
    tool.pointer!(pointer("down", [300, 200]));

    expect(ctx.commits.map((b) => b.ops)).toEqual([
      [
        {
          op: "add",
          entity: {
            id: "crate",
            type: "prop",
            shape: ["box", 100, 200.01, 0.2, 0.2, 0],
            density: 1,
            restitution: 0,
          },
        },
      ],
      [expect.objectContaining({ op: "add", entity: expect.objectContaining({ id: "crate-2" }) })],
    ]);
    expect(ctx.selected).toEqual([["crate"], ["crate-2"]]);
  });

  it("snaps to the grid, turns by the snap angle and draws the ghost", () => {
    const ctx = fakeToolContext(toolRegistry, doc());
    const tool = testCrateTool.create(ctx);
    tool.command!("crate");
    tool.pointer!(pointer("move", [100.2, 230.3]));
    tool.command!("rotate-cw");
    tool.pointer!(pointer("wheel", [100.2, 230.3], { deltaY: 1 }));
    tool.pointer!(pointer("wheel", [100.2, 230.3], { deltaY: -1, shift: true }));
    // On the default 0.5 m grid.
    expect(tool.overlay!().ghosts).toEqual([
      { shape: { type: "box", cx: 100, cy: 230.5, hw: 0.2, hh: 0.2, rotDeg: 29 }, valid: true },
    ]);
    expect(tool.cursor!()).toBe("crosshair");
  });

  it("only warns when the ghost leaves the bounds", () => {
    const ctx = fakeToolContext(toolRegistry, doc(), free);
    const tool = testCrateTool.create(ctx);
    tool.command!("crate");
    tool.pointer!(pointer("move", [0.1, 500]));
    expect(tool.overlay!().ghosts?.[0]).toMatchObject({ valid: false, reason: "Out of bounds" });
    tool.pointer!(pointer("down", [0.1, 500]));
    expect(ctx.commits).toHaveLength(1);
  });

  it("drops the template on Escape or right click with no batch", () => {
    const ctx = fakeToolContext(toolRegistry, doc());
    const tool = testCrateTool.create(ctx);
    expect(tool.cancel!()).toBe(false);
    tool.command!("crate");
    tool.pointer!(pointer("move", [100, 100]));
    expect(tool.cancel!()).toBe(true);
    expect(tool.overlay!()).toEqual({});
    expect(tool.pointer!(pointer("down", [100, 100]))).toBe(false);

    tool.command!("crate");
    tool.pointer!(pointer("down", [100, 100], { button: 2 }));
    tool.pointer!(pointer("down", [100, 100]));
    expect(ctx.commits).toEqual([]);
  });
});
