// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { toolRegistry } from "../../../../__tests__/fixtures/test-tool";
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import {
  createEditorSession,
  createToolHost,
  DEFAULT_SNAP,
  geometryOfRef,
  readAngle,
  readDelta,
  readShapeSize,
  type EditorSession,
  type SnapSettings,
  type ToolHost,
} from "../../../../editor/index";
import { SCENE_FORMAT_VERSION, type SceneDefinition, type ShapeObj } from "../../../../scene/index";
import { createToolRouter } from "../../../../tool-router";
import { useHostOverlay } from "../tool-host";
import { ToolOverlayLabels, ToolOverlayMarks } from "../ToolOverlayLayer";
import { shapePath, worldTransform, type View } from "../view";

const registry = toolRegistry;
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const free: SnapSettings = { ...DEFAULT_SNAP, enabled: false };

function yard(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: registry.game!.id,
    name: "transform-yard",
    bounds: [0, 0, 2000, 1200],
    entities: [
      { id: "slab", type: "solid", shape: ["box", 300, 100, 40, 20, 30] },
      { id: "zone", type: "sensor", shape: ["circle", 500, 100, 20] },
      { id: "lamp", type: "decor", at: [900, 100], behaviors: { sprite: { size: [40, 20] } } },
      { id: "panel", type: "solid", shape: ["box", 1500, 300, 50, 50] },
      { id: "wedge", type: "solid", shape: ["poly", 1000, 500, 1100, 500, 1050, 400] },
    ],
  };
}

const VIEW: View = { width: 2000, height: 1200, scale: 1, tx: 0, ty: 0 };

function Overlay({ host }: { host: ToolHost }) {
  const overlay = useHostOverlay(host);
  return (
    <div>
      <svg data-canvas-layer="">
        <ToolOverlayMarks overlay={overlay} view={VIEW} transform={worldTransform(VIEW)} />
      </svg>
      <ToolOverlayLabels overlay={overlay} view={VIEW} />
    </div>
  );
}

const rigs: { session: EditorSession; host: ToolHost }[] = [];

afterEach(() => {
  cleanup();
  for (const r of rigs.splice(0)) {
    r.host.destroy();
    r.session.destroy();
  }
});

function setup(snap: SnapSettings = free) {
  const session = createEditorSession({
    doc: sceneToDoc(yard(), { key: sequentialKeys("t") }),
    origin: ada,
    name: "transform-yard",
    registry,
    issuesDebounceMs: 0,
  });
  const router = createToolRouter();
  let clock = 0;
  const host = createToolHost({
    session,
    router,
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    snap,
    now: () => (clock += 1000),
  });
  rigs.push({ session, host });
  render(<Overlay host={host} />);
  const ptr = (type: "down" | "move" | "up", x: number, y: number) =>
    act(() => {
      router.dispatch({
        kind: "pointer",
        type,
        screen: { x, y },
        button: 0,
        deltaY: 0,
        native: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as PointerEvent,
      });
    });
  const select = (...refs: string[]) => act(() => session.select(refs));
  const shape = (ref: string): ShapeObj => {
    const s = geometryOfRef(session.getResolved(), registry, ref)?.shape;
    if (!s) throw new Error(`${ref} has no shape`);
    return s;
  };
  return { session, host, ptr, select, shape };
}

const svg = () => document.querySelector("[data-canvas-layer]")!;
const dOf = (m: Element) => m.querySelector(".je-ov-stroke")!.getAttribute("d");
/** The previewed outlines of `ref`: the selection tone, marked as a preview. */
const previews = (ref: string) =>
  [...svg().querySelectorAll(`[data-outline="selected"][data-preview][data-ref="${ref}"]`)].map(
    dOf,
  );
const ghosts = (ref: string) =>
  [...svg().querySelectorAll(`[data-outline="ghost"][data-ref="${ref}"]`)].map(dOf);
const readout = () => document.querySelector('[data-readout][data-tone="readout"]');

describe("the transform overlay", () => {
  it("draws the moved shape as a preview over a ghost of where it started, then clears on release", () => {
    const { ptr, select, shape } = setup();
    select("slab");
    const start = shape("slab");
    ptr("down", 300, 100);
    ptr("move", 320, 110);
    ptr("move", 340, 130);
    const moved = { ...start, cx: 340, cy: 130 } as ShapeObj;
    expect(previews("slab")).toEqual([shapePath(moved)]);
    expect(ghosts("slab")).toEqual([shapePath(start)]);
    const preview = svg().querySelector('[data-preview][data-ref="slab"]')!;
    expect(preview.getAttribute("data-tone")).toBe("selected");
    expect(preview.querySelector(".je-ov-halo")).toBeTruthy();
    expect(svg().querySelector('[data-ref="slab"][data-tone="ghost"]')).toBeTruthy();
    expect(readout()?.textContent).toBe(readDelta([40, 30]));
    // The bounds box and handles track the preview: the move handle sits on the moved centre.
    const handle = svg().querySelector('[data-handle-id="move"]')!;
    expect(Number(handle.getAttribute("x")) + 4).toBeCloseTo(340);
    expect(Number(handle.getAttribute("y")) + 4).toBeCloseTo(130);

    ptr("up", 340, 130);
    expect(shape("slab")).toMatchObject({ cx: 340, cy: 130 });
    expect(svg().querySelector("[data-preview]")).toBeNull();
    expect(svg().querySelector('[data-tone="ghost"]')).toBeNull();
    expect(readout()).toBeNull();
  });

  it("draws a guide in its tone when the move snaps to another entity's edge", () => {
    const { ptr, select, shape } = setup({ ...DEFAULT_SNAP, step: 0, geometry: true });
    select("zone");
    // The zone's left edge (480) lands within 8 px of the lamp sprite's left edge (880).
    ptr("down", 500, 100);
    ptr("move", 898, 100);
    const guide = svg().querySelector('[data-guide="guide"]');
    expect(guide?.getAttribute("data-tone")).toBe("guide");
    expect(guide?.querySelector(".je-ov-halo")).toBeTruthy();
    const line = guide!.querySelector(".je-ov-stroke")!;
    expect(line.getAttribute("x1")).toBe("880");
    expect(line.getAttribute("x2")).toBe("880");
    expect(readout()?.textContent).toBe(readDelta([400, 0]));
    ptr("up", 898, 100);
    expect(shape("zone")).toMatchObject({ cx: 900, cy: 100 });
    expect(svg().querySelector("[data-guide]")).toBeNull();
  });

  it("reads out a scale as the snapped size the release commits", () => {
    const { ptr, select, shape, host } = setup({ ...DEFAULT_SNAP, geometry: false });
    select("panel");
    const se = host.overlay().handles!.find((h) => h.id === "resize:se")!;
    ptr("down", se.at[0], se.at[1]);
    ptr("move", 1600, 410);
    const text = readout()?.textContent;
    expect(text).toMatch(/^W \d+ H \d+$/);
    expect(previews("panel")).toHaveLength(1);
    expect(ghosts("panel")).toEqual([shapePath(shape("panel"))]);
    const active = svg().querySelector('[data-handle-id="resize:se"]')!;
    expect(active.getAttribute("fill")).toBe("var(--je-primary)");
    ptr("up", 1600, 410);
    const done = shape("panel");
    expect(readShapeSize(done)).toBe(text);
    expect(done).toMatchObject({ cx: 1525, cy: 317, hw: 75, hh: 67 });
  });

  it("reads out a rotate as the snapped angle the release commits", () => {
    const { ptr, select, shape, host } = setup({ ...DEFAULT_SNAP, geometry: false });
    select("panel");
    const rot = host.overlay().handles!.find((h) => h.id === "rotate")!;
    ptr("down", rot.at[0], rot.at[1]);
    ptr("move", 1600, 290);
    const text = readout()?.textContent;
    expect(ghosts("panel")).toEqual([shapePath(shape("panel"))]);
    ptr("up", 1600, 290);
    const deg = (shape("panel") as Extract<ShapeObj, { type: "box" }>).rotDeg;
    expect(deg % 15).toBe(0);
    expect(deg).not.toBe(0);
    expect(text).toBe(readAngle(deg));
  });

  it("moves a sprite's box with the preview", () => {
    const { ptr, select } = setup();
    select("lamp");
    ptr("down", 900, 100);
    ptr("move", 950, 140);
    expect(previews("lamp")).toContain(
      shapePath({ type: "box", cx: 950, cy: 140, hw: 20, hh: 10, rotDeg: 0 }),
    );
    expect(ghosts("lamp")).toContain(
      shapePath({ type: "box", cx: 900, cy: 100, hw: 20, hh: 10, rotDeg: 0 }),
    );
    expect(
      svg().querySelector('[data-point="selected"][data-preview][data-ref="lamp"]'),
    ).toBeTruthy();
    ptr("up", 950, 140);
  });

  it("previews a vertex drag, its handle following the pointer", () => {
    const { ptr, select, host, shape } = setup();
    select("wedge");
    act(() => {
      host.command("enter-sub-object");
    });
    const start = shape("wedge");
    ptr("down", 1000, 500);
    ptr("move", 980, 520);
    expect(ghosts("wedge")).toEqual([shapePath(start)]);
    expect(previews("wedge")).toEqual([
      shapePath({
        type: "poly",
        pts: [
          [980, 520],
          [1100, 500],
          [1050, 400],
        ],
      }),
    ]);
    const vertex = svg().querySelector('[data-handle-id="vertex:0"]')!;
    expect(Number(vertex.getAttribute("x")) + 4).toBe(980);
    expect(Number(vertex.getAttribute("y")) + 4).toBe(520);
    expect(readout()?.textContent).toBe(readDelta([-20, 20]));
    ptr("up", 980, 520);
  });
});
