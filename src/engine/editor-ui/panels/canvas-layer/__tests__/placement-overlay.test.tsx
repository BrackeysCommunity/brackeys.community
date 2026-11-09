// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { testCrateTool, toolRegistry } from "../../../../__tests__/fixtures/test-tool";
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import {
  createEditorSession,
  createToolHost,
  DEFAULT_SNAP,
  readShapeSize,
  type EditorSession,
  type Pt,
  type SnapSettings,
  type ToolHost,
} from "../../../../editor/index";
import { defineGame } from "../../../../game/index";
import { createGame, type GameInstance, type RapierModule } from "../../../../index";
import type { AssetEntry, AssetInfo, ProjectTreeNode } from "../../../../project/index";
import { SCENE_FORMAT_VERSION, type SceneDefinition, type ShapeObj } from "../../../../scene/index";
import { createToolRouter } from "../../../../tool-router";
import { EditorFrame, editorChrome } from "../../../frame/EditorFrame";
import {
  editorIdentity,
  openLiveEditor,
  type LiveEditor,
} from "../../../session/live-scene-editor";
import { ProjectTree } from "../../project-tree/project-tree";
import { useHostOverlay } from "../tool-host";
import { ToolOverlayLabels, ToolOverlayMarks } from "../ToolOverlayLayer";
import { polylinePath, shapePath, toScreen, viewOf, worldTransform, type View } from "../view";

vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

const registry = toolRegistry;
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const VIEW: View = { width: 2000, height: 1200, scale: 1, tx: 0, ty: 0 };
const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

function yard(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: registry.game!.id,
    name: "placement-yard",
    bounds: [0, 0, 2000, 1200],
    entities: [{ id: "slab", type: "solid", shape: ["box", 1500, 900, 100, 20] }],
  };
}

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
let game: GameInstance | null = null;
let live: LiveEditor | null = null;

afterEach(() => {
  cleanup();
  for (const r of rigs.splice(0)) {
    r.host.destroy();
    r.session.destroy();
  }
  live?.destroy();
  game?.destroy();
  live = game = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function setup(snap: SnapSettings = DEFAULT_SNAP) {
  const session = createEditorSession({
    doc: sceneToDoc(yard(), { key: sequentialKeys("t") }),
    origin: ada,
    name: "placement-yard",
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
    gameTools: [testCrateTool],
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
  const click = (x: number, y: number) => {
    ptr("down", x, y);
    ptr("up", x, y);
  };
  const command = (c: string) => act(() => void host.command(c));
  return { session, host, ptr, click, command };
}

const svg = () => document.querySelector("[data-canvas-layer]")!;
const dOf = (m: Element | null) => m?.querySelector(".je-ov-stroke")?.getAttribute("d");
const readout = () => document.querySelector('[data-readout][data-tone="readout"]');

describe("placement previews", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("shows a placement tool's ghost at the snapped point before the click", () => {
    const { session, ptr, command } = setup();
    command("tool:test-crate:crate");
    ptr("move", 100, 230);
    const ghost = svg().querySelector('[data-placement="ghost"]');
    expect(ghost?.getAttribute("data-tone")).toBe("ghost");
    expect(ghost?.querySelector(".je-ov-halo")).toBeTruthy();
    expect(dOf(ghost)).toBe(shapePath(box(128, 256, 20, 20)));
    expect(document.querySelector("[data-ghost-reason]")).toBeNull();
    // Nothing is written until the click.
    expect(session.getDoc().entities).toHaveLength(1);
  });

  it("tints a spot that would be refused invalid, with its reason beside it", () => {
    const { ptr, command } = setup();
    command("tool:test-crate:crate");
    ptr("move", 5, 500);
    const ghost = svg().querySelector("[data-placement]");
    expect(ghost?.getAttribute("data-tone")).toBe("invalid");
    expect(dOf(ghost)).toBe(shapePath(box(0, 512, 20, 20)));
    expect(document.querySelector("[data-ghost-reason]")?.textContent).toBe("Out of bounds");
    ptr("move", 300, 300);
    expect(svg().querySelector("[data-placement]")?.getAttribute("data-tone")).toBe("ghost");
    expect(document.querySelector("[data-ghost-reason]")).toBeNull();
  });

  it("draws the box being drawn with its dimensions, and the snapped start before the press", () => {
    const { session, ptr, command } = setup();
    command("tool:box");
    ptr("move", 70, 60);
    const start = svg().querySelector('[data-point="ghost"] .je-ov-stroke');
    expect([start?.getAttribute("cx"), start?.getAttribute("cy")]).toEqual(["64", "64"]);
    // A crosshair in the selection's tone marks it, so it reads over a dark scene.
    const cross = [
      ...svg().querySelectorAll('[data-polyline][data-tone="selected"] .je-ov-stroke'),
    ];
    expect(cross.map((l) => l.getAttribute("d"))).toEqual([
      polylinePath(
        [
          [52, 64],
          [76, 64],
        ],
        false,
      ),
      polylinePath(
        [
          [64, 52],
          [64, 76],
        ],
        false,
      ),
    ]);
    ptr("down", 70, 60);
    ptr("move", 200, 180);
    const drawn = box(128, 128, 64, 64);
    const ghost = svg().querySelector('[data-placement="ghost"]');
    expect(dOf(ghost)).toBe(shapePath(drawn));
    expect(readout()?.textContent).toBe(readShapeSize(drawn));
    expect(readout()?.textContent).toBe("W 128 H 128");
    ptr("up", 200, 180);
    expect(svg().querySelector("[data-placement]")).toBeNull();
    expect(session.store.state.selection).toHaveLength(1);
  });

  it("marks a shape drawn past the scene's edge invalid", () => {
    const { ptr, command } = setup();
    command("tool:circle");
    ptr("down", 64, 64);
    ptr("move", 64, 256);
    const ghost = svg().querySelector("[data-placement]");
    expect(ghost?.getAttribute("data-tone")).toBe("invalid");
    expect(readout()?.textContent).toBe("R 192");
    expect(document.querySelector("[data-ghost-reason]")?.textContent).toBe("Out of bounds");
  });

  it("runs the pen's next segment to the pointer, and back to the first point when a click closes", () => {
    const { ptr, click, command } = setup();
    command("tool:pen");
    click(64, 64);
    ptr("move", 200, 70);
    const next = () => svg().querySelector("[data-polyline][data-dashed] .je-ov-stroke");
    expect(next()?.getAttribute("d")).toBe(
      polylinePath([
        [64, 64],
        [192, 64],
      ] as Pt[]),
    );
    expect(readout()?.textContent).toBe("192, 64  L 128");
    click(200, 70);
    click(200, 200);
    ptr("move", 70, 60);
    expect(next()?.getAttribute("d")).toBe(
      polylinePath([
        [192, 192],
        [64, 64],
      ] as Pt[]),
    );
    // The first point lights up as the close target.
    const first = svg().querySelector('[data-point="selected"] .je-ov-stroke');
    expect([first?.getAttribute("cx"), first?.getAttribute("cy")]).toEqual(["64", "64"]);
    const stroke = svg().querySelector("[data-polyline]:not([data-dashed]) .je-ov-stroke");
    expect(stroke?.getAttribute("d")).toBe(
      polylinePath([
        [64, 64],
        [192, 64],
        [192, 192],
      ] as Pt[]),
    );
  });
});

// ─── Drag and drop ───────────────────────────────────────

const dropGame = defineGame({
  id: "placement-drop",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

const asset = (id: string, kind: string, path: string): AssetEntry => ({
  key: `k-${id}`,
  id,
  kind,
  path,
  created: { at: 1, by: "ada" },
});
const tree = asset("tree", "texture", "art/tree.png");
const jump = asset("jump", "audio", "sfx/jump.ogg");
const nodes: ProjectTreeNode[] = [
  { type: "folder", path: "art", children: [{ type: "asset", entry: tree }] },
  { type: "folder", path: "sfx", children: [{ type: "asset", entry: jump }] },
];
const infoOf = (entry: AssetEntry): AssetInfo =>
  entry.id === "tree"
    ? { id: entry.id, kind: entry.kind, size: [64, 48] }
    : { id: entry.id, kind: entry.kind };

/**
 * A drag's data as a browser guards it: readable while the drag starts and
 * at the drop, hidden (only its `types`) while it passes over a target.
 */
function guardedTransfer() {
  const data = new Map<string, string>();
  let open = true;
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => (open ? (data.get(type) ?? "") : ""),
    guard: (on: boolean) => void (open = !on),
    effectAllowed: "all",
    dropEffect: "none",
  };
}

function dragEvent(type: string, transfer: object, [clientX, clientY]: Pt) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return event;
}

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

async function liveSetup() {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const toast = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, window.innerWidth, window.innerHeight),
  );
  game = await createGame(canvas, {
    game: dropGame,
    rapier: async () => rapier,
    keyTarget: window,
    displayWidth: window.innerWidth,
    displayHeight: window.innerHeight,
    dev: true,
  });
  game.start();
  const def: SceneDefinition = { v: 1, name: "drop-yard", bounds: [0, 0, 2000, 1200] };
  live = openLiveEditor({
    game,
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    name: "drop-yard",
    identity: editorIdentity("Ada"),
    notify: toast,
    issuesDebounceMs: 0,
  });
  const { session } = live;
  render(
    <>
      <ProjectTree projectId="yard" projectName="Yard" nodes={nodes} assetInfo={infoOf} />
      <EditorFrame
        topLeft={null}
        {...editorChrome({
          session,
          host: live.host,
          game,
          onPlay: live.play,
          onReplay: live.replay,
          onStop: live.stop,
          onRestart: live.restart,
          notify: toast,
          canvas: () => canvas,
        })}
      >
        <div />
      </EditorFrame>
    </>,
  );
  await act(async () => {});
  const g = game;
  const screenOf = (at: Pt) =>
    toScreen(viewOf(g.getStore().state.camera, window.innerWidth, window.innerHeight), at);
  /** Starts dragging the named tree row; its data is hidden from then on, as over a canvas. */
  const startDrag = (name: string) => {
    const transfer = guardedTransfer();
    act(() => void fireEvent.dragStart(screen.getByText(name), { dataTransfer: transfer }));
    transfer.guard(true);
    return transfer;
  };
  const over = (transfer: object, at: Pt) =>
    act(() => void canvas.dispatchEvent(dragEvent("dragover", transfer, screenOf(at))));
  const layer = () => document.querySelector("[data-canvas-layer]")!;
  return { session, canvas, startDrag, over, layer, screenOf };
}

describe("drop previews", () => {
  it("shows a dragged texture's sprite box, snapped, where the drop puts it", async () => {
    const { session, canvas, startDrag, over, layer, screenOf } = await liveSetup();
    const transfer = startDrag("tree.png");
    over(transfer, [1000, 300]);
    const ghost = layer().querySelector('[data-placement="ghost"]');
    expect(ghost).toBeTruthy();
    const d = dOf(ghost);
    expect(session.getDoc().entities ?? []).toHaveLength(0);

    transfer.guard(false);
    act(() => void canvas.dispatchEvent(dragEvent("drop", transfer, screenOf([1000, 300]))));
    expect(layer().querySelector("[data-placement]")).toBeNull();
    const placed = session.getDoc().entities?.[0];
    expect(placed?.at).toEqual([1024, 320]);
    // The ghost was the dragged picture's size, centred where it landed.
    expect(d).toBe(shapePath(box(1024, 320, 32, 24)));
  });

  it("tints a drop that would be refused invalid and says why, then clears when the drag leaves", async () => {
    const { canvas, startDrag, over, layer } = await liveSetup();
    const sound = startDrag("jump.ogg");
    over(sound, [600, 600]);
    const ghost = layer().querySelector("[data-placement]");
    expect(ghost?.getAttribute("data-tone")).toBe("invalid");
    expect(document.querySelector("[data-ghost-reason]")?.textContent).toMatch(
      /can't be placed in a scene/,
    );
    act(() => void canvas.dispatchEvent(dragEvent("dragleave", sound, [0, 0])));
    expect(layer().querySelector("[data-placement]")).toBeNull();
    act(() => void document.dispatchEvent(new Event("dragend")));

    const picture = startDrag("tree.png");
    over(picture, [-400, 300]);
    expect(layer().querySelector("[data-placement]")?.getAttribute("data-tone")).toBe("invalid");
    expect(document.querySelector("[data-ghost-reason]")?.textContent).toBe("Out of bounds");
  });
});
