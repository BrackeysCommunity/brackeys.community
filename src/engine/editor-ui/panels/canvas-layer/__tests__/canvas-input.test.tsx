// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { toolRegistry } from "../../../../__tests__/fixtures/test-tool";
import {
  sceneToDoc,
  sequentialKeys,
  staticPrefabSource,
  type ProjectSession,
  type SceneOrigin,
} from "../../../../collab/index";
import { createEditorSession, DEFAULT_SNAP, type EditorSession } from "../../../../editor/index";
import type { GameStoreState } from "../../../../index";
import type { AssetEntry, ProjectView } from "../../../../project/index";
import {
  prefabLibrary,
  SCENE_FORMAT_VERSION,
  type Prefab,
  type SceneDefinition,
} from "../../../../scene/index";
import { createToolRouter } from "../../../../tool-router";
import type { EditorNotify } from "../../../host";
import { KitProvider } from "../../../kit/index";
import type { LoadedRun } from "../../../session/loaded-run";
import { EditorOutliner } from "../../EditorOutliner";
import { writeAssetDrag } from "../../project-tree/tree-rows";
import { CanvasLayer } from "../CanvasLayer";
import {
  createToolHostCell,
  SNAP_KEY,
  useToolHost,
  useToolHostLifecycle,
  type ToolHostCell,
  type ToolHostGame,
} from "../tool-host";
import { shapePath } from "../view";

const registry = toolRegistry;
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});

/** A prefab of nothing but a picture: its ghost has only the picture's box to show. */
const LAMP: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "lamp",
  entities: [{ id: "bulb", type: "decor", at: [0, 0], behaviors: { sprite: { asset: "glow" } } }],
};

const entry = (id: string, kind: string, over: Partial<AssetEntry> = {}): AssetEntry => ({
  key: `k-${id}`,
  id,
  kind,
  path: `art/${id}`,
  created: { at: 1, by: "ada" },
  ...over,
});
const glow = entry("glow", "texture", { meta: { format: "png", width: 40, height: 24 } });
const lamp = entry("lamp", "prefab");

/** Just what the tool host reads of a project: its live view and its doc's updates. */
function fakeProject(): ProjectSession {
  const view = { byId: new Map([[glow.id, glow]]) } as unknown as ProjectView;
  return { view: () => view, projectDoc: new Y.Doc() } as unknown as ProjectSession;
}

function yard(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: registry.game!.id,
    name: "input-yard",
    bounds: [0, 0, 2000, 1200],
    entities: [{ id: "zone", type: "sensor", shape: ["circle", 500, 100, 20] }],
  };
}

const rigs: EditorSession[] = [];
afterEach(() => {
  cleanup();
  for (const s of rigs.splice(0)) s.destroy();
  document.body.innerHTML = "";
});

function Rig(props: {
  cell: ToolHostCell;
  session: EditorSession;
  game: ToolHostGame;
  store: Store<GameStoreState>;
  canvas: HTMLElement;
  project: ProjectSession | null;
}) {
  useToolHostLifecycle(props.cell, props.session, props.game, notify, props.project);
  const host = useToolHost(props.cell);
  return (
    <CanvasLayer
      session={props.session}
      host={host}
      store={props.store}
      runStore={new Store<LoadedRun | null>(null)}
      canvas={() => props.canvas}
      notify={notify}
    />
  );
}

async function setup(project: ProjectSession | null = null) {
  const session = createEditorSession({
    doc: sceneToDoc(yard(), { key: sequentialKeys("c") }),
    origin: ada,
    name: "input-yard",
    registry,
    issuesDebounceMs: 0,
    prefabs: staticPrefabSource(prefabLibrary([LAMP])),
  });
  rigs.push(session);
  // The camera centred on the window at scale 1, so screen px are world px.
  const store = new Store({
    camera: { position: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, scale: 1 },
  } as unknown as GameStoreState);
  const router = createToolRouter();
  const game = {
    registry,
    router,
    getStore: () => store,
    screenToWorld: (p: { x: number; y: number }) => p,
    panBy: () => {},
    zoomAt: () => {},
    frame: () => {},
  } as unknown as ToolHostGame;
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const cell = createToolHostCell();
  const storage = new Map([[SNAP_KEY, JSON.stringify(DEFAULT_SNAP)]]);
  render(
    <KitProvider host={{ storage: { get: (k) => storage.get(k) ?? null, set: () => {} } }}>
      <Rig {...{ cell, session, game, store, canvas, project }} />
      <EditorOutliner session={session} />
    </KitProvider>,
  );
  await act(async () => {});
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
  return { session, canvas, ptr };
}

const layer = () => document.querySelector("[data-canvas-layer]")!;
const row = (name: string) =>
  within(screen.getByRole("navigation", { name: "Outliner" })).getByRole("button", {
    name: new RegExp(`^${name}`),
  });

describe("the canvas's pointer", () => {
  it("clears the shared hover when it leaves the canvas", async () => {
    const { session, canvas, ptr } = await setup();
    ptr("move", 500, 100);
    expect(session.store.state.hover).toBe("zone");
    expect(layer().querySelector('[data-tone="hover"]')).toBeTruthy();
    expect(row("zone").hasAttribute("data-hover")).toBe(true);

    act(() => void canvas.dispatchEvent(new PointerEvent("pointerleave")));
    expect(session.store.state.hover).toBeNull();
    expect(layer().querySelector('[data-tone="hover"]')).toBeNull();
    expect(row("zone").hasAttribute("data-hover")).toBe(false);
  });

  it("keeps the hover through a leave mid-drag", async () => {
    const { session, canvas, ptr } = await setup();
    session.select(["zone"]);
    ptr("move", 500, 100);
    ptr("down", 500, 100);
    ptr("move", 540, 100);
    act(() => session.store.setState((s) => ({ ...s, hover: "zone" })));
    act(() => void canvas.dispatchEvent(new PointerEvent("pointerleave")));
    expect(session.store.state.hover).toBe("zone");
    ptr("up", 540, 100);
  });
});

function dragOver(canvas: HTMLElement, x: number, y: number) {
  const data = new Map<string, string>();
  const transfer = {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    dropEffect: "none",
  } as unknown as DataTransfer;
  writeAssetDrag(transfer, { entry: lamp, info: { id: lamp.id, kind: lamp.kind } });
  const event = new MouseEvent("dragover", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  act(() => void canvas.dispatchEvent(event));
}

describe("a prefab dragged over the canvas", () => {
  it("previews its children's sprite boxes from the project's assets", async () => {
    const { canvas } = await setup(fakeProject());
    dragOver(canvas, 1000, 300);
    const ghost = layer().querySelector('[data-placement="ghost"]');
    // The instance lands snapped to the grid at 1024, 320; its bulb is the 40x24 picture there.
    expect(ghost?.querySelector(".je-ov-stroke")?.getAttribute("d")).toBe(
      shapePath({ type: "box", cx: 1024, cy: 320, hw: 20, hh: 12, rotDeg: 0 }),
    );
    expect(layer().querySelector('[data-point="ghost"]')).toBeNull();
  });

  it("falls back to a stand-in box without a project to size the picture", async () => {
    const { canvas } = await setup();
    dragOver(canvas, 1000, 300);
    const ghost = layer().querySelector('[data-placement="ghost"]');
    expect(ghost?.querySelector(".je-ov-stroke")?.getAttribute("d")).toBe(
      shapePath({ type: "box", cx: 1024, cy: 320, hw: 16, hh: 16, rotDeg: 0 }),
    );
  });
});
