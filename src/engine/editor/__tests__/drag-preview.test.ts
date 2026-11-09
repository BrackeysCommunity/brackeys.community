import { afterEach, describe, expect, it } from "vite-plus/test";
import type * as Y from "yjs";

import { toolRegistry } from "../../__tests__/fixtures/test-tool";
import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import { readLog } from "../../collab/log";
import { PRESENCE_FIELD, type AwarenessLike, type SceneOrigin } from "../../collab/types";
import { parseSceneOrThrow } from "../../scene/parse";
import { parseShape } from "../../scene/shapes";
import type { ShapeObj } from "../../scene/types";
import yard from "../../scenes/engine-yard.json";
import { createToolRouter } from "../../tool-router";
import { readAngle, readDelta, readShapeSize } from "../gizmos/readout";
import { createEditorSession } from "../session";
import { createToolHost, type ToolHost } from "../tool-host";
import { DEFAULT_SNAP, type SnapSettings, type ToolOverlay } from "../tools";

type Box = Extract<ShapeObj, { type: "box" }>;

const registry = toolRegistry;
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const free: SnapSettings = { ...DEFAULT_SNAP, enabled: false };
const grid: SnapSettings = { ...DEFAULT_SNAP, geometry: false };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** This client's presence, as peers would read it. */
function fakeAwareness() {
  let local: Record<string, unknown> = {};
  const awareness: AwarenessLike = {
    clientID: 1,
    getLocalState: () => local,
    setLocalStateField(field, value) {
      local = { ...local, [field]: value };
    },
    getStates: () => new Map([[1, local]]),
    on() {},
    off() {},
  };
  const ghost = () => (local[PRESENCE_FIELD] as { ghost?: unknown } | undefined)?.ghost;
  return { awareness, ghost };
}

/** A tool host with no runtime, as the editor runs it: previews live in the overlay only. */
function rig(snap: SnapSettings = free) {
  const doc = sceneToDoc(parseSceneOrThrow(yard, registry), { key: sequentialKeys("k") });
  const presence = fakeAwareness();
  const session = createEditorSession({
    doc,
    origin: ada,
    name: "engine-yard",
    registry,
    issuesDebounceMs: 0,
    awareness: presence.awareness,
  });
  const router = createToolRouter();
  let clock = 0;
  const host: ToolHost = createToolHost({
    session,
    router,
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    snap,
    now: () => (clock += 1000),
  });
  cleanups.push(() => {
    host.destroy();
    session.destroy();
  });
  let writes = 0;
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    if (tr.origin === ada) writes++;
  });
  /** Overlays the host announced, read at each change. */
  const seen: ToolOverlay[] = [];
  host.subscribe(() => seen.push(host.overlay()));
  const ptr = (type: "down" | "move" | "up", x: number, y: number) =>
    router.dispatch({
      kind: "pointer",
      type,
      screen: { x, y },
      button: 0,
      deltaY: 0,
      native: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as PointerEvent,
    });
  const shapeOf = (id: string): ShapeObj => {
    const parsed = parseShape(session.getDoc().entities!.find((e) => e.id === id)!.shape);
    if (!parsed.ok) throw new Error(`${id} has no shape`);
    return parsed.shape;
  };
  return {
    doc,
    session,
    host,
    ptr,
    seen,
    shapeOf,
    ghost: presence.ghost,
    writes: () => writes,
    log: () => readLog(doc).length,
  };
}

const previewOf = (o: ToolOverlay, ref: string) =>
  o.outlines?.find((m) => m.ref === ref && m.preview && m.tone === "selected")?.shape;
const ghostOf = (o: ToolOverlay, ref: string) =>
  o.outlines?.find((m) => m.ref === ref && m.tone === "ghost")?.shape;

describe("a drag previews in the overlay and writes once on release", () => {
  it("moves: a preview per pointer move over the starting ghost, nothing written until release", () => {
    const r = rig();
    const start = r.shapeOf("avatar") as Box;
    const log = r.log();
    r.ptr("down", 300, 940);
    const steps: [number, number][] = [
      [310, 940],
      [330, 950],
      [360, 970],
    ];
    for (const [x, y] of steps) {
      const before = r.seen.length;
      r.ptr("move", x, y);
      expect(r.seen.length).toBeGreaterThan(before);
      const o = r.seen.at(-1)!;
      expect(previewOf(o, "avatar")).toMatchObject({ cx: x, cy: y });
      expect(ghostOf(o, "avatar")).toMatchObject({ cx: start.cx, cy: start.cy });
      expect(o.readout?.text).toBe(readDelta([x - 300, y - 940]));
      expect(r.writes()).toBe(0);
      expect(r.shapeOf("avatar")).toEqual(start);
    }
    r.ptr("up", 360, 970);
    expect(r.writes()).toBe(1);
    expect(r.log()).toBe(log + 1);
    expect(r.shapeOf("avatar")).toMatchObject({ cx: 360, cy: 970 });
    const after = r.host.overlay();
    expect(after.outlines?.some((m) => m.preview || m.tone === "ghost")).toBe(false);
    expect(after.readout).toBeUndefined();
    // One history entry: one undo puts it back.
    expect(r.session.undo()).toBe(true);
    expect(r.shapeOf("avatar")).toEqual(start);
  });

  it("scales: the handles track the preview and the readout is the snapped size", () => {
    const r = rig(grid);
    r.session.select(["avatar"]);
    const se = r.host.overlay().handles!.find((h) => h.id === "resize:se")!;
    expect(se.at).toEqual([320, 960]);
    r.ptr("down", 320, 960);
    for (const [x, y] of [
      [370, 1010],
      [420, 1060],
    ] as const) {
      const before = r.seen.length;
      r.ptr("move", x, y);
      expect(r.seen.length).toBeGreaterThan(before);
      const o = r.seen.at(-1)!;
      const shape = previewOf(o, "avatar")!;
      expect(shape.type).toBe("box");
      const box = shape as Box;
      const handle = o.handles?.find((h) => h.id === "resize:se");
      expect(handle?.active).toBe(true);
      expect(handle?.at).toEqual([box.cx + box.hw, box.cy + box.hh]);
      expect(o.readout?.text).toBe(readShapeSize(shape));
      expect(r.writes()).toBe(0);
    }
    const shown = r.host.overlay().readout?.text;
    r.ptr("up", 420, 1060);
    expect(r.writes()).toBe(1);
    const done = r.shapeOf("avatar");
    expect(readShapeSize(done)).toBe(shown);
    // The far corner lands on the 64px grid.
    const box = done as Box;
    expect((box.cx + box.hw) % 64).toBe(0);
    expect((box.cy + box.hh) % 64).toBe(0);
  });

  it("rotates with the rotate tool: preview per move, readout the snapped angle", () => {
    const r = rig(grid);
    r.session.select(["avatar"]);
    expect(r.host.setTool("rotate")).toBe(true);
    r.ptr("down", 400, 940);
    for (const [x, y] of [
      [395, 970],
      [380, 1000],
      [350, 1030],
    ] as const) {
      const before = r.seen.length;
      r.ptr("move", x, y);
      expect(r.seen.length).toBeGreaterThan(before);
      const o = r.seen.at(-1)!;
      expect(previewOf(o, "avatar")).toBeDefined();
      expect(ghostOf(o, "avatar")).toMatchObject({ rotDeg: 0 });
      expect(r.writes()).toBe(0);
    }
    const o = r.host.overlay();
    const deg = (previewOf(o, "avatar") as Box).rotDeg;
    expect(deg % 15).toBe(0);
    expect(deg).not.toBe(0);
    expect(o.readout?.text).toBe(readAngle(deg));
    r.ptr("up", 350, 1030);
    expect(r.writes()).toBe(1);
    expect(r.shapeOf("avatar")).toMatchObject({ rotDeg: deg });
  });

  it("rotates a multi-selection from its rotate handle, the bounds box tracking the preview", () => {
    const r = rig(grid);
    r.session.select(["avatar", "start"]);
    const startBounds = r.host.overlay().bounds!;
    const rot = r.host.overlay().handles!.find((h) => h.id === "rotate")!;
    r.ptr("down", rot.at[0], rot.at[1]);
    r.ptr("move", rot.at[0] + 120, rot.at[1] + 80);
    const o = r.host.overlay();
    expect(o.bounds).toBeDefined();
    expect(o.bounds).not.toEqual(startBounds);
    expect(o.points?.some((p) => p.ref === "start" && p.preview)).toBe(true);
    expect(o.points?.some((p) => p.ref === "start" && p.tone === "ghost")).toBe(true);
    expect(o.readout?.text).toMatch(/°$/);
    expect(r.writes()).toBe(0);
    r.ptr("up", rot.at[0] + 120, rot.at[1] + 80);
    expect(r.writes()).toBe(1);
  });

  it("Escape cancels back to the start with nothing written and no history entry", () => {
    const r = rig();
    const start = r.shapeOf("avatar") as Box;
    const log = r.log();
    r.ptr("down", 300, 940);
    r.ptr("move", 380, 900);
    expect(previewOf(r.host.overlay(), "avatar")).toMatchObject({ cx: 380, cy: 900 });
    expect(r.host.cancel()).toBe(true);
    const o = r.host.overlay();
    expect(o.outlines?.some((m) => m.preview || m.tone === "ghost")).toBe(false);
    expect(o.outlines?.find((m) => m.ref === "avatar")?.shape).toMatchObject({
      cx: start.cx,
      cy: start.cy,
    });
    r.ptr("up", 380, 900);
    expect(r.writes()).toBe(0);
    expect(r.log()).toBe(log);
    expect(r.shapeOf("avatar")).toEqual(start);
    expect(r.session.store.state.canUndo).toBe(false);
  });

  it("shares a move with peers through awareness while previewing", () => {
    const r = rig();
    r.ptr("down", 300, 940);
    r.ptr("move", 340, 940);
    expect(r.ghost()).toMatchObject({ by: [40, 0] });
    expect(r.writes()).toBe(0);
    r.ptr("up", 340, 940);
    expect(r.ghost()).toBeUndefined();
  });
});
