// @vitest-environment jsdom
import { createGame, type GameInstance, type RapierModule } from "@jams/engine";
import { sceneToDoc, sequentialKeys } from "@jams/engine/collab";
import type { Pt, SceneDefinition } from "@jams/engine/editor";
import { defineGame } from "@jams/engine/game";
import type { AssetEntry, AssetInfo, ProjectTreeNode } from "@jams/engine/project";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CanvasShell } from "@/components/canvas/shell/CanvasShell";
import { toScreen, viewOf } from "@/components/game/editor/canvas-layer/view";
import { editorChrome } from "@/components/game/editor/EditorShell";
import { ProjectTree } from "@/components/game/editor/project-tree/project-tree";
import {
  editorIdentity,
  openLiveEditor,
  type LiveEditor,
} from "@/components/game/live-scene-editor";

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

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);
vi.mock("@/lib/toast", () => ({ toast }));

const dropGame = defineGame({
  id: "asset-drop",
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
const infoOf = (entry: AssetEntry): AssetInfo => ({ id: entry.id, kind: entry.kind });

/** A drag event at a screen point; jsdom has no DragEvent, so a mouse event carries the transfer. */
function dragEvent(
  type: string,
  transfer: ReturnType<typeof dataTransfer>,
  [clientX, clientY]: Pt,
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return event;
}

/** jsdom has no DataTransfer: a store with its `types`, as a browser's drag carries. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "all",
    dropEffect: "none",
  };
}

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

let game: GameInstance | null = null;
let live: LiveEditor | null = null;

beforeEach(() => {
  toast.mockReset();
  toast.error.mockReset();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  live?.destroy();
  game?.destroy();
  live = game = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function setup() {
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
  const yard: SceneDefinition = { v: 1, name: "drop-yard", bounds: [0, 0, 2000, 1200] };
  live = openLiveEditor({
    game,
    doc: sceneToDoc(yard, { key: sequentialKeys("t") }),
    name: "drop-yard",
    identity: editorIdentity("Ada"),
    issuesDebounceMs: 0,
  });
  const { session } = live;
  render(
    <>
      <ProjectTree projectId="yard" projectName="Yard" nodes={nodes} assetInfo={infoOf} />
      <CanvasShell
        topLeft={null}
        {...editorChrome({
          session,
          host: live.host,
          game,
          onPlay: live.play,
          onReplay: live.replay,
          onStop: live.stop,
          onRestart: live.restart,
          canvas: () => canvas,
        })}
      >
        <div />
      </CanvasShell>
    </>,
  );
  await act(async () => {});
  const g = game;
  const screenOf = (at: Pt) =>
    toScreen(viewOf(g.getStore().state.camera, window.innerWidth, window.innerHeight), at);
  /** Drags the named tree row and drops it on the canvas over world point `at`. */
  const dragOnto = (name: string, at: Pt) => {
    const transfer = dataTransfer();
    const point = screenOf(at);
    act(() => {
      fireEvent.dragStart(screen.getByText(name), { dataTransfer: transfer });
      const over = dragEvent("dragover", transfer, point);
      canvas.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);
      canvas.dispatchEvent(dragEvent("drop", transfer, point));
    });
  };
  return { session, dragOnto };
}

describe("dropping an asset on the canvas", () => {
  it("places a texture as one decor, one history row, and Mod+Z removes it", async () => {
    const { session, dragOnto } = await setup();
    const logged = session.store.state.history.length;
    dragOnto("tree.png", [800, 500]);
    const decor = session.getDoc().entities ?? [];
    expect(decor).toHaveLength(1);
    expect(decor[0]).toMatchObject({
      id: "decor",
      type: "decor",
      behaviors: { sprite: { asset: "tree" } },
    });
    const [x, y] = decor[0]!.at as Pt;
    // Snapped to the default grid, within half a step of the drop point.
    expect(Math.abs(x - 800)).toBeLessThanOrEqual(32);
    expect(Math.abs(y - 500)).toBeLessThanOrEqual(32);
    expect(session.store.state.history).toHaveLength(logged + 1);
    expect(session.store.state.history.at(-1)?.label).toBe("Place tree");
    expect(session.store.state.selection).toEqual(["decor"]);

    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    expect(session.getDoc().entities ?? []).toEqual([]);
  });

  it("toasts for a kind that can't be placed and changes nothing", async () => {
    const { session, dragOnto } = await setup();
    const logged = session.store.state.history.length;
    dragOnto("jump.ogg", [800, 500]);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("can't be placed"));
    expect(session.getDoc().entities ?? []).toEqual([]);
    expect(session.store.state.history).toHaveLength(logged);
  });
});
