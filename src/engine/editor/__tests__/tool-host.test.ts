import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Y from "yjs";

import { toolRegistry } from "../../__tests__/fixtures/test-tool";
import { bindSceneDoc } from "../../collab/bind";
import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import { readLog } from "../../collab/log";
import type { SceneOrigin } from "../../collab/types";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { Registry } from "../../game/types";
import { expandScene } from "../../scene/expand";
import { parseSceneOrThrow } from "../../scene/parse";
import { prefabLibrary } from "../../scene/prefab";
import { drawnEntities } from "../../scene/render-geometry";
import { aabb } from "../../scene/shape-geometry";
import type {
  EntityDef,
  ExpandedScene,
  PrefabLibrary,
  RuntimeEntity,
  SceneDefinition,
  ShapeTuple,
} from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import { createToolRouter, type ToolRouter } from "../../tool-router";
import { dropBatch, dropPreview, type AssetDrop } from "../asset-drop";
import { createEditorSession, type EditorSession } from "../session";
import { createToolHost, type ToolHost, type ToolHostOptions } from "../tool-host";
import { DEFAULT_SNAP, type EditorToolDef } from "../tools";

const registry = toolRegistry;
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const free = { ...DEFAULT_SNAP, enabled: false };

/** The edit world's runtime, recording what reaches it. */
function fakeRuntime() {
  const held = new Map<string, RuntimeEntity>();
  const calls: string[] = [];
  return {
    held,
    calls,
    load(scene: ExpandedScene) {
      calls.push("load");
      held.clear();
      for (const e of scene.entities) held.set(e.id, e);
      return { ok: true };
    },
    add(entities: RuntimeEntity[]) {
      calls.push("add");
      for (const e of entities) held.set(e.id, e);
      return { ok: true };
    },
    update(entities: RuntimeEntity[]) {
      calls.push("update");
      for (const e of entities) held.set(e.id, e);
      return { ok: true };
    },
    remove(ids: string[]) {
      calls.push("remove");
      for (const id of ids) held.delete(id);
    },
  };
}

type Mods = { shift?: boolean; alt?: boolean; mod?: boolean; button?: number };

type Rig = {
  doc: Y.Doc;
  session: EditorSession;
  router: ToolRouter;
  host: ToolHost;
  runtime: ReturnType<typeof fakeRuntime>;
  /** Transactions this client wrote to the doc. */
  writes: () => number;
  def: () => SceneDefinition;
  entity: (id: string) => EntityDef | undefined;
  ptr: (type: "down" | "move" | "up" | "wheel", x: number, y: number, mods?: Mods) => void;
  click: (x: number, y: number, mods?: Mods) => void;
  drag: (from: [number, number], to: [number, number], mods?: Mods) => void;
  /** Moves the clock on, so the next press isn't a double-click. */
  later: () => void;
  key: (key: string) => boolean;
};

const rigs: Rig[] = [];
afterEach(() => {
  for (const r of rigs.splice(0)) {
    r.host.destroy();
    r.session.destroy();
  }
});

function rig(
  opts: Partial<ToolHostOptions> = {},
  gameTools?: readonly EditorToolDef[],
  scene?: { def: SceneDefinition; prefabs: PrefabLibrary; registry?: Registry },
): Rig {
  const registry = scene?.registry ?? toolRegistry;
  const base = scene?.def ?? parseSceneOrThrow(yard, registry);
  const doc = sceneToDoc(base, { key: sequentialKeys("k") });
  const session = createEditorSession({
    doc,
    origin: ada,
    name: "engine-yard",
    registry,
    issuesDebounceMs: 0,
    ...(scene
      ? {
          prefabs: {
            library: () => scene.prefabs,
            subscribe: () => () => {},
            open: async () => null,
          },
        }
      : {}),
  });
  const runtime = fakeRuntime();
  bindSceneDoc(doc, runtime, registry);
  const router = createToolRouter();
  let clock = 0;
  const host = createToolHost({
    session,
    router,
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    runtime,
    snap: free,
    now: () => clock,
    ...(gameTools ? { gameTools } : {}),
    ...opts,
  });
  let writes = 0;
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    if (tr.origin === ada) writes++;
  });
  const ptr: Rig["ptr"] = (type, x, y, mods = {}) => {
    clock += 10;
    router.dispatch({
      kind: "pointer",
      type,
      screen: { x, y },
      button: mods.button ?? 0,
      deltaY: type === "wheel" ? 100 : 0,
      native: {
        shiftKey: mods.shift ?? false,
        altKey: mods.alt ?? false,
        ctrlKey: mods.mod ?? false,
        metaKey: false,
      } as unknown as PointerEvent,
    });
  };
  const r: Rig = {
    doc,
    session,
    router,
    host,
    runtime,
    writes: () => writes,
    def: () => session.getDoc(),
    entity: (id) => session.getDoc().entities?.find((e) => e.id === id),
    ptr,
    click(x, y, mods) {
      ptr("down", x, y, mods);
      ptr("up", x, y, mods);
    },
    drag(from, to, mods) {
      ptr("down", from[0], from[1], mods);
      ptr("move", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, mods);
      ptr("move", to[0], to[1], mods);
      ptr("up", to[0], to[1], mods);
    },
    later: () => void (clock += 10_000),
    key: (key) =>
      host.key({ type: "down", key, repeat: false, shift: false, alt: false, mod: false }),
  };
  rigs.push(r);
  return r;
}

const expanded = (def: SceneDefinition) =>
  new Map(expandScene(def, registry).entities.map((e) => [e.id, e]));

describe("a drag with the select tool", () => {
  it("previews through the runtime and commits exactly one transaction on release", () => {
    const r = rig();
    const logBefore = readLog(r.doc).length;
    r.ptr("down", 1200, 940);
    r.ptr("move", 1230, 940);
    r.ptr("move", 1264, 950);
    expect(r.session.store.state.selection).toEqual(["crate"]);
    expect(r.host.keyContext()).toMatchObject({ gesture: true, tool: "select" });
    // The runtime shows the drag; the doc doesn't have it yet.
    expect(r.runtime.held.get("crate")).toMatchObject({ shape: { cx: 1264, cy: 950 } });
    expect(r.entity("crate")?.shape).toEqual(["circle", 1200, 940, 20]);
    expect(r.writes()).toBe(0);
    expect(r.runtime.calls.filter((c) => c !== "update")).toEqual(["load"]);
    expect(r.host.overlay().readout?.text).toBe("Δ 64, 10");

    r.ptr("up", 1264, 950);
    expect(r.writes()).toBe(1);
    expect(readLog(r.doc)).toHaveLength(logBefore + 1);
    expect(r.entity("crate")?.shape).toEqual(["circle", 1264, 950, 20]);
    expect(r.runtime.held).toEqual(expanded(r.def()));
    expect(r.host.keyContext().gesture).toBe(false);
  });

  it("snaps the dragged box's edge to the grid", () => {
    const r = rig({ snap: { ...DEFAULT_SNAP, geometry: false } });
    r.drag([1200, 940], [1250, 940]);
    // The crate's edges nearest the grab (left 1180, top 920) land on the nearest 64px lines.
    expect(r.entity("crate")?.shape).toEqual(["circle", 1236, 916, 20]);
    expect(r.writes()).toBe(1);
  });

  it("commits nothing and restores the preview on Escape mid-drag", () => {
    const r = rig();
    const before = r.runtime.held.get("crate");
    r.ptr("down", 1200, 940);
    r.ptr("move", 1300, 900);
    expect(r.runtime.held.get("crate")).not.toEqual(before);
    expect(r.host.cancel()).toBe(true);
    expect(r.runtime.held.get("crate")).toEqual(before);
    r.ptr("up", 1300, 900);
    expect(r.writes()).toBe(0);
    expect(r.session.store.state.selection).toEqual(["crate"]);
    // The cascade goes on: the next Escape clears the selection.
    expect(r.host.cancel()).toBe(true);
    expect(r.session.store.state.selection).toEqual([]);
    expect(r.host.cancel()).toBe(false);
  });

  it("moves a multi-selection in one batch", () => {
    const r = rig();
    r.click(1200, 940);
    r.later();
    r.click(300, 940, { shift: true });
    r.later();
    expect(r.session.store.state.selection).toEqual(["crate", "avatar"]);
    r.drag([300, 940], [300, 900]);
    expect(r.writes()).toBe(1);
    expect(r.entity("crate")?.shape).toEqual(["circle", 1200, 900, 20]);
    expect(r.entity("avatar")?.shape).toEqual(["box", 300, 900, 20, 20]);
  });
});

describe("selection", () => {
  it("marquees what it contains, or with Alt what it touches", () => {
    const r = rig();
    r.drag([1100, 700], [1600, 970]);
    expect([...r.session.store.state.selection].sort()).toEqual(["crate", "ledge"]);
    r.later();
    r.drag([1150, 790], [1300, 950]);
    expect(r.session.store.state.selection).toEqual([]);
    r.later();
    r.drag([1150, 790], [1300, 950], { alt: true });
    expect([...r.session.store.state.selection].sort()).toEqual(["crate", "ledge"]);
    expect(r.writes()).toBe(0);
  });

  it("cycles overlapping hits with Alt-click", () => {
    const r = rig();
    const sel = () => r.session.store.state.selection;
    r.click(900, 958, { alt: true });
    expect(sel()).toEqual(["zone"]);
    r.later();
    r.click(900, 958, { alt: true });
    expect(sel()).toEqual(["~solid:0"]);
    r.later();
    r.click(900, 958, { alt: true });
    expect(sel()).toEqual(["zone"]);
    r.later();
    r.click(900, 958);
    expect(sel()).toEqual(["zone"]);
  });

  it("tells the keymap whether anything is selected", () => {
    const r = rig();
    expect(r.host.keyContext().hasSelection).toBe(false);
    r.session.select(["crate"]);
    expect(r.host.keyContext()).toMatchObject({ hasSelection: true, tool: "select" });
    expect(r.host.cancel()).toBe(true);
    expect(r.host.keyContext().hasSelection).toBe(false);
  });
});

describe("point editing", () => {
  function withRock(r: Rig, pts: number[]) {
    r.session.dispatch({
      ops: [{ op: "add", entity: { id: "rock", type: "solid", shape: ["poly", ...pts] } }],
    });
    return r.writes();
  }

  it("enters on a double-click and drags a vertex as one batch", () => {
    const r = rig();
    const start = withRock(r, [600, 600, 700, 600, 650, 500]);
    r.click(650, 570);
    r.click(650, 570);
    expect(r.host.keyContext().subObject).toBe(true);
    expect(r.host.overlay().handles?.map((h) => h.id)).toContain("vertex:0");
    r.drag([600, 600], [580, 620]);
    expect(r.writes()).toBe(start + 1);
    expect(r.entity("rock")?.shape).toEqual(["poly", 580, 620, 700, 600, 650, 500]);
    // A triangle keeps its three points.
    expect(r.host.command("delete-points")).toBe(true);
    expect(r.writes()).toBe(start + 1);
    expect(r.host.cancel()).toBe(true);
    expect(r.host.keyContext().subObject).toBe(false);
  });

  it("offers Convert to chain after a commit leaves a poly concave", () => {
    const r = rig();
    const start = withRock(r, [600, 600, 700, 600, 700, 500, 600, 500]);
    r.click(650, 550);
    r.later();
    expect(r.key("Enter")).toBe(true);
    r.drag([600, 600], [680, 520]);
    expect(r.writes()).toBe(start + 1);
    const offer = r.host.overlay().offer;
    expect(offer?.label).toBe("Convert to chain");
    expect(r.host.acceptOffer()).toBe(true);
    expect(r.writes()).toBe(start + 2);
    expect((r.entity("rock")!.shape as ShapeTuple)[0]).toBe("chain");
    expect(r.host.overlay().offer).toBeUndefined();
  });

  function dragVertexConcave(r: Rig) {
    r.later();
    expect(r.key("Enter")).toBe(true);
    r.ptr("down", 600, 600);
    r.ptr("move", 640, 560);
    r.ptr("move", 680, 520);
    return r.host.overlay().outlines ?? [];
  }

  it("previews a solid poly turning concave in the invalid tone", () => {
    const r = rig();
    withRock(r, [600, 600, 700, 600, 700, 500, 600, 500]);
    r.click(650, 550);
    const outlines = dragVertexConcave(r);
    expect(outlines.map((o) => o.tone)).toContain("invalid");
  });

  it("previews a nav walk area turning concave as a plain selection", () => {
    const r = rig();
    r.session.dispatch({
      ops: [
        {
          op: "add",
          entity: {
            id: "walk",
            type: "nav",
            shape: ["poly", 600, 600, 700, 600, 700, 500, 600, 500],
          },
        },
      ],
    });
    r.click(650, 550);
    expect(r.session.store.state.selection).toEqual(["walk"]);
    const outlines = dragVertexConcave(r);
    expect(outlines.some((o) => o.tone === "invalid")).toBe(false);
    r.ptr("up", 680, 520);
    expect(r.entity("walk")?.shape).toEqual(["poly", 680, 520, 700, 600, 700, 500, 600, 500]);
  });
});

describe("drawing tools", () => {
  it("draws a box as one bulk add, selected", () => {
    const r = rig();
    expect(r.host.command("tool:box")).toBe(true);
    expect(r.session.store.state.tool).toBe("box");
    r.drag([400, 400], [464, 432]);
    expect(r.writes()).toBe(1);
    expect((r.def().solid as ShapeTuple[]).at(-1)).toEqual(["box", 432, 416, 32, 16]);
    expect(r.session.store.state.selection).toEqual(["~solid:3"]);
  });

  it("draws a circle of another type when the host swaps the tool", async () => {
    const { createDrawTool } = await import("../builtin/draw");
    const r = rig({
      engineTools: [
        createDrawTool({
          id: "circle",
          label: "Prop",
          description: "",
          shape: "circle",
          type: "sensor",
        }),
      ],
    });
    r.host.setTool("circle");
    r.drag([500, 500], [530, 540]);
    expect(r.entity("sensor")?.shape).toEqual(["circle", 500, 500, 50]);
  });

  it("makes a pen stroke one batch, and Escape drops one with none", () => {
    const r = rig();
    r.host.command("tool:pen");
    r.click(100, 300);
    r.later();
    r.click(200, 300);
    r.later();
    r.click(260, 250, { shift: true });
    r.later();
    expect(r.host.keyContext().gesture).toBe(true);
    expect(r.writes()).toBe(0);
    expect(r.key("Enter")).toBe(true);
    expect(r.writes()).toBe(1);
    // Shift held the third point on the 45° line from the second.
    expect((r.def().solid as ShapeTuple[]).at(-1)).toEqual(["chain", 100, 300, 200, 300, 255, 245]);

    r.click(100, 100);
    r.later();
    r.click(200, 100);
    r.later();
    expect(r.key("Backspace")).toBe(true);
    expect(r.host.cancel()).toBe(true);
    expect(r.writes()).toBe(1);
    expect(r.host.tool()).toBe("pen");
    expect(r.host.cancel()).toBe(true);
    expect(r.host.tool()).toBe("select");
  });

  it("closes a pen stroke on its first point into a convex poly", () => {
    const r = rig();
    r.host.setTool("pen");
    for (const [x, y] of [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
      [102, 102],
    ] as const) {
      r.click(x, y);
      r.later();
    }
    expect(r.writes()).toBe(1);
    expect((r.def().solid as ShapeTuple[]).at(-1)).toEqual([
      "poly",
      100,
      100,
      200,
      100,
      200,
      200,
      100,
      200,
    ]);
  });

  it("lays out the selected path's waypoints in one batch", () => {
    const r = rig();
    r.host.setTool("waypoints");
    r.click(1700, 900);
    expect(r.session.store.state.selection).toEqual(["lift"]);
    r.later();
    r.click(1600, 900);
    r.later();
    r.click(1600, 500);
    r.later();
    r.key("Enter");
    expect(r.writes()).toBe(1);
    expect((r.entity("lift")!.path as { pts: unknown }).pts).toEqual([
      [1600, 900],
      [1600, 500],
    ]);
  });

  it("rotates the selection about its centre, snapped to 15°", () => {
    const r = rig();
    r.click(1400, 800);
    r.later();
    r.host.setTool("rotate");
    r.drag([1500, 800], [1404, 700]);
    expect(r.writes()).toBe(1);
    expect(r.entity("ledge")?.shape).toEqual(["box", 1400, 800, 120, 10, 270]);
  });
});

describe("host commands", () => {
  it("nudges, rotates, duplicates, deletes and pastes in one batch each", () => {
    const r = rig({ snap: DEFAULT_SNAP });
    r.click(1200, 940);
    r.later();
    expect(r.host.command("nudge-left")).toBe(true);
    expect(r.entity("crate")?.shape).toEqual(["circle", 1136, 940, 20]);
    expect(r.host.command("nudge-up-fine")).toBe(true);
    expect(r.host.duplicate()).toBe(true);
    expect(r.session.store.state.selection).toEqual(["crate-2"]);
    expect(r.host.command("delete")).toBe(true);
    expect(r.entity("crate-2")).toBeUndefined();
    r.click(1400, 800);
    r.later();
    expect(r.host.command("rotate-cw")).toBe(true);
    expect(r.entity("ledge")?.shape).toEqual(["box", 1400, 800, 120, 10, 15]);
    const text = r.host.copy();
    expect(r.host.paste(text, [640, 320])).toBe(true);
    // Centred on the cursor by whole grid steps, so it stays on the grid it was on.
    expect(r.entity("ledge-2")?.shape).toEqual(["box", 632, 352, 120, 10, 15]);
    expect(r.writes()).toBe(6);
    expect(r.host.command("toggle-snap")).toBe(true);
    expect(r.host.snap().enabled).toBe(false);
  });

  it("brings forward and sends backward as one setZ, leaving bulk entries out", () => {
    const r = rig();
    const dispatch = vi.spyOn(r.session, "dispatch");
    r.session.select(["crate", "~solid:0", "ledge"]);
    r.host.command("bring-forward");
    r.host.command("send-backward");
    expect(dispatch.mock.calls.map(([batch]) => batch)).toEqual([
      { label: "Bring 2 entities forward", ops: [{ op: "setZ", refs: ["crate", "ledge"], by: 1 }] },
      {
        label: "Send 2 entities backward",
        ops: [{ op: "setZ", refs: ["crate", "ledge"], by: -1 }],
      },
    ]);
    r.session.select(["~solid:0"]);
    expect(r.host.command("bring-forward")).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("turns and flips selected instances and whole groups by quarter turns", async () => {
    const yardDef = parseSceneOrThrow(yard, registry);
    const def: SceneDefinition = {
      ...yardDef,
      groups: { pair: { at: [0, 0] } },
      instances: [{ id: "post-1", prefab: "post", at: [600, 600] }],
      entities: [...yardDef.entities!, { id: "pin", type: "marker", at: [40, 40], group: "pair" }],
    };
    const prefabs = prefabLibrary([
      {
        kind: "prefab",
        v: def.v,
        id: "post",
        entities: [{ id: "top", type: "marker", at: [10, 0] }],
      },
    ]);
    const tools = await registry.game!.editor!.tools!();
    const r = rig({}, tools, { def, prefabs });
    const dispatch = vi.spyOn(r.session, "dispatch");

    r.session.select(["post-1/top"]);
    expect(r.host.keyContext().quarterTurns).toBe(true);
    expect(r.host.command("turn-cw")).toBe(true);
    expect(r.def().instances![0]).toMatchObject({ id: "post-1", rot: 1 });
    expect(r.host.command("turn-ccw")).toBe(true);
    expect(r.def().instances![0]!.rot).toBeUndefined();
    expect(r.host.command("flip-x")).toBe(true);
    expect(r.def().instances![0]!.flip).toBe(true);

    r.session.select(["pin"]);
    expect(r.host.keyContext().quarterTurns).toBe(true);
    expect(r.host.command("flip-y")).toBe(true);
    expect(dispatch.mock.calls.at(-1)![0].ops).toEqual([
      { op: "transform", groups: ["pair"], flip: "y" },
    ]);

    r.session.select(["post-1", "crate"]);
    expect(r.host.keyContext().quarterTurns).toBe(false);
    r.session.select(["crate"]);
    expect(r.host.keyContext().quarterTurns).toBe(false);
    expect(r.host.command("turn-cw")).toBe(false);
    expect(r.host.command("flip-x")).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(4);

    // A game's tool keeps e for its own ghost.
    r.session.select(["post-1"]);
    r.host.command("tool:test-crate:crate");
    expect(r.host.keyContext().quarterTurns).toBe(false);
  });

  it("copies, pastes and duplicates prefab instances as instances", () => {
    const def: SceneDefinition = {
      ...parseSceneOrThrow(yard, registry),
      instances: [{ id: "post-1", prefab: "post", at: [600, 600] }],
    };
    const prefabs = prefabLibrary([
      {
        kind: "prefab",
        v: def.v,
        id: "post",
        entities: [{ id: "top", type: "marker", at: [10, 0] }],
      },
    ]);
    const r = rig({}, undefined, { def, prefabs });
    r.session.select(["post-1"]);
    expect(r.host.duplicate()).toBe(true);
    expect(r.def().instances?.map((i) => [i.id, i.prefab])).toEqual([
      ["post-1", "post"],
      ["post-2", "post"],
    ]);
    r.session.select(["post-1"]);
    const text = r.host.copy();
    expect(JSON.parse(text).instances).toEqual([
      expect.objectContaining({ id: "post-1", prefab: "post" }),
    ]);
    expect(r.host.paste(text, [200, 200])).toBe(true);
    expect(r.def().instances?.map((i) => i.id)).toEqual(["post-1", "post-2", "post-3"]);
  });

  it("holds the pan tool while Space is down and pans through the host", () => {
    const pans: [number, number][] = [];
    const r = rig({ pan: (d) => void pans.push(d) });
    expect(r.host.command("pan-hold")).toBe(true);
    expect(r.host.tool()).toBe("pan");
    r.drag([100, 100], [140, 90]);
    expect(pans).toEqual([
      [20, -5],
      [20, -5],
    ]);
    r.host.key({ type: "up", key: " ", repeat: false, shift: false, alt: false, mod: false });
    expect(r.host.tool()).toBe("select");
    expect(r.writes()).toBe(0);
  });

  it("zooms on a wheel no tool takes, and frames the selection", () => {
    const zooms: number[] = [];
    const frames: unknown[] = [];
    const r = rig({
      zoomAt: (_at, f) => void zooms.push(f),
      frame: (rect) => void frames.push(rect),
    });
    r.ptr("wheel", 500, 500);
    expect(zooms[0]).toBeCloseTo(1 / 1.15);
    r.click(300, 940);
    expect(r.host.command("frame")).toBe(true);
    expect(frames).toEqual([{ minX: 280, minY: 920, maxX: 320, maxY: 960 }]);
  });

  it("ignores pointers outside edit mode", () => {
    const r = rig();
    r.session.setMode("play");
    r.drag([1200, 940], [1300, 940]);
    expect(r.session.store.state.selection).toEqual([]);
    expect(r.writes()).toBe(0);
  });
});

describe("game tools", () => {
  it("picks a game tool with tool:<id>:<arg> and commits one batch per placement", async () => {
    const tools = await registry.game!.editor!.tools!();
    const r = rig({}, tools);
    expect(r.host.tools().map((t) => t.id)).toEqual([
      "select",
      "pan",
      "box",
      "circle",
      "pen",
      "waypoints",
      "rotate",
      "test-stroke",
      "test-crate",
    ]);
    expect(r.host.command("tool:test-crate:crate")).toBe(true);
    expect(r.host.tool()).toBe("test-crate");
    expect(r.session.store.state.tool).toBe("test-crate");
    r.ptr("move", 800, 400);
    expect(r.host.overlay().ghosts).toHaveLength(1);
    r.click(800, 400);
    expect(r.writes()).toBe(1);
    expect(r.entity("crate-2")).toMatchObject({
      type: "prop",
      shape: ["box", 800, 400, 20, 20, 0],
    });
    // Escape drops the template first, then the tool.
    expect(r.host.cancel()).toBe(true);
    expect(r.host.tool()).toBe("test-crate");
    expect(r.host.cancel()).toBe(true);
    expect(r.host.tool()).toBe("select");
  });

  it("rejects a game tool that reuses an engine id or repeats", async () => {
    const tools = await registry.game!.editor!.tools!();
    expect(() => rig({}, [{ ...tools[0]!, id: "select" }])).toThrow(/engine tool id/);
    expect(() => rig({}, [tools[0]!, tools[0]!])).toThrow(/listed twice/);
  });
});

describe("sprite boxes", () => {
  it("sizes them from the asset lookup and re-indexes on demand", () => {
    const def = parseSceneOrThrow(yard, registry);
    def.entities!.push({
      id: "sign",
      type: "marker",
      at: [600, 960],
      behaviors: { sprite: { asset: "sign", anchor: [0.5, 1] } },
    });
    let size: [number, number] = [40, 20];
    const r = rig(
      { asset: (id) => (id === "sign" ? { id, kind: "texture", size } : undefined) },
      undefined,
      { def, prefabs: prefabLibrary([]) },
    );
    expect(r.host.index().get("sign")?.aabb).toEqual({
      minX: 580,
      minY: 940,
      maxX: 620,
      maxY: 960,
    });
    size = [80, 40];
    r.host.reindex();
    expect(r.host.index().get("sign")?.aabb).toEqual({
      minX: 560,
      minY: 920,
      maxX: 640,
      maxY: 960,
    });
  });
});

describe("outlines", () => {
  const tree: AssetDrop = {
    entry: {
      key: "k-tree",
      id: "tree",
      kind: "texture",
      path: "art/tree.png",
      created: { at: 0, by: "t" },
    },
    info: { id: "tree", kind: "texture", size: [48, 24], pivot: [0.5, 1] },
  };
  const asset = (id: string) => (id === "tree" ? tree.info : undefined);
  const selected = (r: Rig, ref: string) => {
    const o = r.host.overlay();
    return {
      shapes: (o.outlines ?? [])
        .filter((x) => x.tone === "selected" && x.ref === ref)
        .map((x) => x.shape),
      points: (o.points ?? [])
        .filter((x) => x.tone === "selected" && x.ref === ref)
        .map((x) => x.at),
    };
  };

  it("draws a drop preview with the selection's outlines for the same ref", () => {
    const r = rig({ asset });
    const opts = { def: r.def(), registry, snap: free };
    const preview = dropPreview(tree, [700, 500], { ...opts, asset });
    const placed = dropBatch(tree, [700, 500], opts);
    if (!placed.ok) throw new Error("the drop was refused");
    expect(r.session.dispatch(placed.batch, { selectionAfter: placed.select }).ok).toBe(true);
    const ref = placed.select[0]!;
    const { shapes, points } = selected(r, ref);
    expect(shapes).toEqual([{ type: "box", cx: 700, cy: 488, hw: 24, hh: 12, rotDeg: 0 }]);
    expect(preview.ghosts.map((g) => g.shape)).toEqual(shapes);
    // The selection marks the point under the sprite too; a drop's ghost shows the picture only.
    expect(points).toEqual([[700, 500]]);
    expect(preview.points).toBeUndefined();
  });

  it("boxes a grid entity as the renderers bound it", () => {
    const def = parseSceneOrThrow(yard, registry);
    def.settings = { ...def.settings, grid: { kind: "square", cell: [16, 16] } };
    // Its only filled cell sits off its origin, which the box still covers.
    def.entities!.push({
      id: "floor",
      type: "paint",
      at: [100, 400],
      cells: { "0,0": ["", "0,1"] },
    });
    const r = rig({}, undefined, { def, prefabs: prefabLibrary([]) });
    r.session.select(["floor"]);
    const drawn = drawnEntities(expandScene(r.def(), registry), registry).find(
      (d) => d.id === "floor",
    );
    const { shapes } = selected(r, "floor");
    expect(shapes).toHaveLength(1);
    expect(aabb(shapes[0]!)).toEqual(drawn?.box);
    expect(drawn?.box).toEqual({ minX: 100, minY: 400, maxX: 132, maxY: 432 });
  });

  it("moves a bulk row's sprite box with a drag's preview", () => {
    const lamps = createRegistry(
      defineGame({
        id: "lamps",
        types: [
          defineEntityType({
            type: "lamp",
            description: "A lit post.",
            system: () => ({ spawn: () => {}, despawn: () => {}, clear: () => {}, size: () => 0 }),
            fields: { at: pointField("Where the lamp stands.") },
            bulk: { form: "point", description: "Lamps." },
            behaviors: { required: { sprite: { size: [40, 20] } } },
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const def = {
      v: 3,
      game: "lamps",
      name: "lamps",
      bounds: [0, 0, 2000, 2000],
      lamp: [[400, 400]],
    } as unknown as SceneDefinition;
    const r = rig({}, undefined, { def, prefabs: prefabLibrary([]), registry: lamps });
    const ref = "~lamp:0";
    expect(r.host.index().get(ref)?.sprite).toBeDefined();
    r.session.select([ref]);
    r.ptr("down", 410, 400);
    r.ptr("move", 460, 430);
    const o = r.host.overlay();
    const mine = (o.outlines ?? []).filter((x) => x.ref === ref);
    expect(mine.filter((x) => x.preview).map((x) => x.shape)).toEqual([
      { type: "box", cx: 450, cy: 430, hw: 20, hh: 10, rotDeg: 0 },
    ]);
    expect(mine.filter((x) => x.tone === "ghost").map((x) => x.shape)).toEqual([
      { type: "box", cx: 400, cy: 400, hw: 20, hh: 10, rotDeg: 0 },
    ]);
    r.ptr("up", 460, 430);
  });
});
