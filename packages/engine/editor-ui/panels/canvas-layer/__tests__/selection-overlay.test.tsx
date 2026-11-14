// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { toolRegistry } from "../../../../__tests__/fixtures/test-tool";
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import {
  createEditorSession,
  createToolHost,
  DEFAULT_SNAP,
  geometryOfRef,
  type EditorSession,
  type ToolHost,
} from "../../../../editor/index";
import {
  aabb,
  bulkId,
  prefabLibrary,
  SCENE_FORMAT_VERSION,
  type Prefab,
  type SceneDefinition,
  type ShapeObj,
} from "../../../../scene/index";
import { createToolRouter, type ToolRouter } from "../../../../tool-router";
import { KitProvider } from "../../../kit/index";
import { EditorOutliner } from "../../EditorOutliner";
import { useHostOverlay } from "../tool-host";
import { ToolOverlayMarks } from "../ToolOverlayLayer";
import { shapePath, worldTransform, type View } from "../view";

const registry = toolRegistry;
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const prefab = (p: Omit<Prefab, "kind" | "v">): Prefab => ({
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  ...p,
});

const prefabs = prefabLibrary([
  prefab({ id: "post", entities: [{ id: "bar", type: "solid", shape: ["box", 40, 0, 30, 5] }] }),
  prefab({ id: "frame", entities: [], instances: [{ id: "p", prefab: "post", at: [0, 100] }] }),
]);

function yard(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: registry.game!.id,
    name: "selection-yard",
    bounds: [0, 0, 2000, 1200],
    settings: { grid: { kind: "square", cell: [16, 16] } },
    solid: [["box", 100, 100, 50, 10]],
    instances: [
      { id: "post-t", prefab: "post", at: [600, 600], rot: 90, flip: true },
      { id: "frame-1", prefab: "frame", at: [1200, 600] },
    ],
    entities: [
      { id: "slab", type: "solid", shape: ["box", 300, 100, 40, 20, 30] },
      { id: "zone", type: "sensor", shape: ["circle", 500, 100, 20] },
      { id: "start", type: "marker", at: [700, 100] },
      {
        id: "lamp",
        type: "decor",
        at: [900, 100],
        behaviors: { sprite: { size: [40, 20] } },
      },
      { id: "floor", type: "paint", at: [100, 400], cells: { "0,0": ["1*3", "0,1"] } },
    ],
  };
}

const VIEW: View = { width: 2000, height: 1200, scale: 1, tx: 0, ty: 0 };

function Overlay({ host }: { host: ToolHost }) {
  const overlay = useHostOverlay(host);
  return (
    <svg data-canvas-layer="">
      <ToolOverlayMarks overlay={overlay} view={VIEW} transform={worldTransform(VIEW)} />
    </svg>
  );
}

type Rig = { session: EditorSession; host: ToolHost; router: ToolRouter };
const rigs: Rig[] = [];

afterEach(() => {
  cleanup();
  for (const r of rigs.splice(0)) {
    r.host.destroy();
    r.session.destroy();
  }
});

function setup() {
  const session = createEditorSession({
    doc: sceneToDoc(yard(), { key: sequentialKeys("s") }),
    origin: ada,
    name: "selection-yard",
    registry,
    issuesDebounceMs: 0,
    prefabs: { library: () => prefabs, subscribe: () => () => {}, open: async () => null },
  });
  const router = createToolRouter();
  let clock = 0;
  const host = createToolHost({
    session,
    router,
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    snap: { ...DEFAULT_SNAP, enabled: false },
    now: () => (clock += 1000),
  });
  rigs.push({ session, host, router });
  render(
    <KitProvider host={{}}>
      <Overlay host={host} />
      <EditorOutliner session={session} />
    </KitProvider>,
  );
  const ptr = (type: "down" | "move" | "up", x: number, y: number, alt = false) =>
    act(() => {
      router.dispatch({
        kind: "pointer",
        type,
        screen: { x, y },
        button: 0,
        deltaY: 0,
        native: { shiftKey: false, altKey: alt, ctrlKey: false, metaKey: false } as PointerEvent,
      });
    });
  const select = (...refs: string[]) => act(() => session.select(refs));
  return { session, host, ptr, select };
}

const svg = () => document.querySelector("[data-canvas-layer]")!;
const marks = (tone: string, ref: string) =>
  [...svg().querySelectorAll(`[data-tone="${tone}"]`)].filter(
    (m) => m.getAttribute("data-ref") === ref,
  );
/** The `d` of each outline (not point) of `ref` in `tone`. */
const paths = (tone: string, ref: string) =>
  [...svg().querySelectorAll(`[data-outline="${tone}"]`)]
    .filter((m) => m.getAttribute("data-ref") === ref)
    .map((m) => m.querySelector(".je-ov-stroke")!.getAttribute("d"));
const sorted = (xs: readonly (string | null)[]) =>
  [...xs].sort((a, b) => String(a).localeCompare(String(b)));
const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
const row = (name: string) => outliner().getByRole("button", { name: new RegExp(`^${name}`) });

/** The world shape `ref` resolves to, as the scene draws it. */
function resolvedShape(session: EditorSession, ref: string): ShapeObj {
  const shape = geometryOfRef(session.getResolved(), registry, ref)?.shape;
  if (!shape) throw new Error(`${ref} has no shape`);
  return shape;
}

describe("the selection overlay", () => {
  it("outlines a selected solid, sensor and bulk row on their resolved shapes, each on a halo", () => {
    const { session, select } = setup();
    for (const ref of ["slab", "zone", bulkId("solid", 0)]) {
      select(ref);
      expect(paths("selected", ref)).toEqual([shapePath(resolvedShape(session, ref))]);
      const [mark] = marks("selected", ref);
      const halo = mark!.querySelector(".je-ov-halo")!;
      expect(halo.getAttribute("d")).toBe(shapePath(resolvedShape(session, ref)));
      for (const part of [halo, mark!.querySelector(".je-ov-stroke")!])
        expect(part.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }
    // The turned slab's outline is its turned box, not its unturned one.
    select("slab");
    expect(paths("selected", "slab")[0]).toBe(
      shapePath({ type: "box", cx: 300, cy: 100, hw: 40, hh: 20, rotDeg: 30 }),
    );
  });

  it("marks a marker's point, a decor sprite's box and a grid entity's filled cells", () => {
    const { select } = setup();
    select("start");
    expect(svg().querySelector('[data-point="selected"][data-ref="start"] circle')).toBeTruthy();

    select("lamp");
    expect(paths("selected", "lamp")).toContain(
      shapePath({ type: "box", cx: 900, cy: 100, hw: 20, hh: 10, rotDeg: 0 }),
    );
    expect(svg().querySelector('[data-point="selected"][data-ref="lamp"]')).toBeTruthy();

    select("floor");
    // Row 0 holds three cells, row 1 one at column 1: the box over them at 16 px a cell, and its origin.
    expect(svg().querySelector('[data-point="selected"][data-ref="floor"]')).toBeTruthy();
    expect(paths("selected", "floor")).toEqual([
      shapePath({ type: "box", cx: 124, cy: 416, hw: 24, hh: 16, rotDeg: 0 }),
    ]);
  });

  it("outlines a child of a turned and flipped instance in its world pose", () => {
    const { session, select } = setup();
    select("post-t/bar");
    const shape = resolvedShape(session, "post-t/bar");
    expect(paths("selected", "post-t/bar")).toEqual([shapePath(shape)]);
    // Flipped then turned a quarter: the 60 × 10 bar at +40 x stands 10 × 60 above the origin.
    const box = aabb(shape);
    expect(box.minX).toBeCloseTo(595);
    expect(box.maxX).toBeCloseTo(605);
    expect(box.minY).toBeCloseTo(530);
    expect(box.maxY).toBeCloseTo(590);
  });

  it("outlines an instance and a nested instance by their children, with one bounds box", () => {
    const { session, select } = setup();
    select("frame-1");
    expect(paths("selected", "frame-1")).toEqual([
      shapePath(resolvedShape(session, "frame-1/p/bar")),
    ]);
    expect(svg().querySelector("[data-bounds]")).toBeTruthy();

    select("frame-1/p");
    expect(paths("selected", "frame-1/p")).toEqual([
      shapePath(resolvedShape(session, "frame-1/p/bar")),
    ]);
  });

  it("shows each item of a multi-selection and one bounds box around them all", () => {
    const { select } = setup();
    select("slab", "zone");
    expect(marks("selected", "slab")).toHaveLength(1);
    expect(marks("selected", "zone")).toHaveLength(1);
    const bounds = svg().querySelectorAll("[data-bounds] .je-ov-stroke");
    expect(bounds).toHaveLength(1);
    expect(Number(bounds[0]!.getAttribute("x"))).toBeLessThan(270);
    expect(Number(bounds[0]!.getAttribute("x")) + Number(bounds[0]!.getAttribute("width"))).toBe(
      520,
    );

    select("slab");
    expect(svg().querySelector("[data-bounds]")).toBeNull();
  });
});

describe("hover", () => {
  it("highlights the entity under the pointer in a lighter tone, and marks its outliner row", () => {
    const { session, ptr, select } = setup();
    ptr("move", 500, 100);
    expect(session.store.state.hover).toBe("zone");
    expect(paths("hover", "zone")).toEqual([shapePath(resolvedShape(session, "zone"))]);
    expect(marks("selected", "zone")).toHaveLength(0);
    expect(row("zone").hasAttribute("data-hover")).toBe(true);

    ptr("move", 1900, 1100);
    expect(session.store.state.hover).toBeNull();
    expect(marks("hover", "zone")).toHaveLength(0);
    expect(row("zone").hasAttribute("data-hover")).toBe(false);

    // A selected entity shows its selection, not a hover on top of it.
    select("zone");
    ptr("move", 500, 100);
    expect(marks("hover", "zone")).toHaveLength(0);
    expect(marks("selected", "zone")).toHaveLength(1);
  });

  it("outlines the view's entity when its outliner row is hovered, and clears on leave", () => {
    const { session } = setup();
    fireEvent.pointerEnter(row("start"));
    expect(session.store.state.hover).toBe("start");
    expect(svg().querySelector('[data-point="hover"][data-ref="start"]')).toBeTruthy();
    fireEvent.pointerLeave(row("start"));
    expect(svg().querySelector('[data-tone="hover"]')).toBeNull();

    fireEvent.pointerEnter(row("slab"));
    expect(paths("hover", "slab")).toEqual([shapePath(resolvedShape(session, "slab"))]);
  });

  it("outlines an instance's children when its outliner row is hovered", () => {
    const { session } = setup();
    fireEvent.pointerEnter(row("post-t"));
    expect(paths("hover", "post-t")).toEqual([shapePath(resolvedShape(session, "post-t/bar"))]);
  });
});

describe("the marquee", () => {
  it("highlights what it would select during the drag, before anything is selected", () => {
    const { session, ptr } = setup();
    ptr("down", 450, 40);
    ptr("move", 760, 160);
    const rect = svg().querySelector("[data-marquee]")!;
    expect(rect.getAttribute("data-marquee")).toBe("contain");
    expect(session.store.state.selection).toEqual([]);
    const would = [...svg().querySelectorAll("[data-candidate]")].map((m) =>
      m.getAttribute("data-ref"),
    );
    expect(sorted(would)).toEqual(["start", "zone"]);

    ptr("up", 760, 160);
    expect(sorted(session.store.state.selection)).toEqual(["start", "zone"]);
    expect(svg().querySelector("[data-candidate]")).toBeNull();
    expect(svg().querySelector("[data-marquee]")).toBeNull();
  });

  it("looks different in touch mode and takes what it only crosses", () => {
    const { ptr } = setup();
    ptr("down", 450, 40, true);
    ptr("move", 495, 160, true);
    expect(svg().querySelector("[data-marquee]")!.getAttribute("data-marquee")).toBe("touch");
    expect(
      [...svg().querySelectorAll("[data-candidate]")].map((m) => m.getAttribute("data-ref")),
    ).toEqual(["zone"]);
  });
});
