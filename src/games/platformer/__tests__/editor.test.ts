import {
  createKeymap,
  DEFAULT_SNAP,
  type EditorToolContext,
  type ToolPointerEvent,
} from "@jams/engine/editor";
import {
  applyOps,
  createRegistry,
  type OpBatch,
  type Pt,
  type SceneDefinition,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";
import { PLATFORMER_EDIT_KEYS } from "../edit-keys";
import { PLATFORMER_EDITOR_TOOLS } from "../editor";

const registry = createRegistry(platformerGame);

function context(doc: SceneDefinition) {
  const commits: OpBatch[] = [];
  const ctx = {
    registry,
    getDoc: () => doc,
    selection: () => [],
    select() {},
    commit(batch: OpBatch) {
      const r = applyOps(doc, batch, registry);
      if (!r.ok) throw new Error(r.issue.message);
      doc = r.def;
      commits.push(batch);
      return true;
    },
    preview() {},
    scale: () => 1,
    snap: () => ({ ...DEFAULT_SNAP, enabled: false }),
    index: () => ({ query: () => [], get: () => undefined, entries: () => [], size: 0 }),
    layers: () => ({ hidden: new Set(), locked: new Set() }),
    invalidate() {},
    setTool() {},
    setSubObject() {},
    shareGhost() {},
  } as unknown as EditorToolContext;
  return { ctx, commits, doc: () => doc };
}

const pointer = (type: ToolPointerEvent["type"], world: Pt, deltaY = 0): ToolPointerEvent => ({
  type,
  world,
  button: 0,
  deltaY,
  clicks: 1,
  shift: false,
  alt: false,
  mod: false,
});

const scene = (): SceneDefinition => ({
  v: 1,
  game: "platformer",
  name: "e",
  bounds: [0, 0, 2000, 1000],
  spawn: [[1000, 500]],
});

describe("the platformer's editor", () => {
  it("binds 1-6 in edit mode without shadowing", async () => {
    const keymap = createKeymap(platformerGame.editorKeys);
    expect(keymap.shadowed).toEqual([]);
    expect(PLATFORMER_EDIT_KEYS.map((k) => [k.key, k.command])).toEqual([
      ["1", "tool:constructs:bridge"],
      ["2", "tool:constructs:bounce_pad"],
      ["3", "tool:constructs:wind_zone"],
      ["4", "tool:constructs:grapple_anchor"],
      ["5", "tool:constructs:light_orb"],
      ["6", "tool:constructs:shield_barrier"],
    ]);
    expect(PLATFORMER_EDITOR_TOOLS.map((t) => t.id)).toEqual(["constructs"]);
    expect((await platformerGame.editor!.tools!()).map((t) => t.id)).toEqual(["constructs"]);
  });

  it("places a construct as a scene entity in one batch", () => {
    const { ctx, commits, doc } = context(scene());
    const tool = PLATFORMER_EDITOR_TOOLS[0]!.create(ctx);
    expect(tool.command!("bridge")).toBe(true);
    tool.pointer!(pointer("move", [300.2, 400]));
    tool.pointer!(pointer("wheel", [300.2, 400], 1));
    tool.pointer!(pointer("down", [300.2, 400]));
    tool.command!("bounce_pad");
    tool.pointer!(pointer("wheel", [500, 400], 1));
    tool.pointer!(pointer("down", [500, 400]));

    expect(commits.map((b) => b.ops)).toEqual([
      [
        {
          op: "add",
          entity: { id: "bridge", type: "construct", construct: "bridge", at: [300, 400], rot: 15 },
        },
      ],
      [
        {
          op: "add",
          entity: { id: "bounce-pad", type: "construct", construct: "bounce_pad", at: [500, 400] },
        },
      ],
    ]);
    expect(doc().entities).toHaveLength(2);
  });

  it("warns, without refusing, over a spawn", () => {
    const { ctx, commits } = context(scene());
    const tool = PLATFORMER_EDITOR_TOOLS[0]!.create(ctx);
    tool.command!("light_orb");
    tool.pointer!(pointer("move", [1000, 480]));
    expect(tool.overlay!().ghosts?.[0]).toMatchObject({ valid: false, reason: "Overlaps a spawn" });
    tool.pointer!(pointer("move", [1200, 480]));
    expect(tool.overlay!().ghosts?.[0]).toMatchObject({ valid: true });
    tool.pointer!(pointer("move", [1000, 480]));
    tool.pointer!(pointer("down", [1000, 480]));
    expect(commits).toHaveLength(1);
    expect(tool.cancel!()).toBe(true);
    expect(commits).toHaveLength(1);
  });
});
