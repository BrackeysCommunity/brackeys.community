// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { toolRegistry as registry } from "../../../../__tests__/fixtures/test-tool";
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import { createEditorSession, type EditorSession, type ToolHost } from "../../../../editor/index";
import type { GameStoreState } from "../../../../index";
import { SCENE_FORMAT_VERSION } from "../../../../scene/index";
import { createToolRouter } from "../../../../tool-router";
import type { EditorNotify, EditorStorage } from "../../../host";
import { KitProvider } from "../../../kit/index";
import {
  createToolHostCell,
  DRAW_TYPE_KEY,
  useToolHostLifecycle,
  type ToolHostCell,
  type ToolHostGame,
} from "../tool-host";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});

const sessions: EditorSession[] = [];
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

function Rig({
  cell,
  session,
  game,
}: {
  cell: ToolHostCell;
  session: EditorSession;
  game: ToolHostGame;
}) {
  useToolHostLifecycle(cell, session, game, notify);
  return null;
}

/** A stand-in game; each call is a new one, as a rebuild makes. */
function gameOf(): ToolHostGame {
  const store = new Store({ camera: { position: { x: 0, y: 0 }, scale: 1 } });
  return {
    registry,
    router: createToolRouter(),
    getStore: () => store as unknown as Store<GameStoreState>,
    screenToWorld: (p: { x: number; y: number }) => p,
    panBy: () => {},
    zoomAt: () => {},
    frame: () => {},
  } as unknown as ToolHostGame;
}

async function setup(saved: Map<string, string> = new Map()) {
  const session = createEditorSession({
    doc: sceneToDoc(
      {
        v: SCENE_FORMAT_VERSION,
        game: registry.game!.id,
        name: "memory-yard",
        bounds: [0, 0, 1000, 1000],
        entities: [],
      },
      { key: sequentialKeys("m") },
    ),
    origin: ada,
    name: "memory-yard",
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(session);
  const storage: EditorStorage = {
    get: (k) => saved.get(k) ?? null,
    set: (k, v) => void saved.set(k, v),
  };
  const cell = createToolHostCell();
  const view = (game: ToolHostGame) => (
    <KitProvider host={{ storage }}>
      <Rig cell={cell} session={session} game={game} />
    </KitProvider>
  );
  const { rerender } = render(view(gameOf()));
  await act(async () => {});
  const host = (): ToolHost => cell.state!;
  const rebuild = async () => {
    rerender(view(gameOf()));
    await act(async () => {});
  };
  return { host, rebuild, saved };
}

describe("the draw tools' type", () => {
  it("survives a rebuild of the tool host, in the tool that picked it and the others", async () => {
    const { host, rebuild, saved } = await setup();
    act(() => void host().command("tool:pen:type:nav"));
    expect(saved.get(DRAW_TYPE_KEY)).toBe("nav");
    act(() => void host().command("tool:box:type:sensor"));
    expect(saved.get(DRAW_TYPE_KEY)).toBe("sensor");
    const before = host();

    await rebuild();
    expect(host()).not.toBe(before);
    expect(host().tool()).toBe("box");
    expect(host().option()?.value).toBe("sensor");
    act(() => void host().setTool("pen"));
    expect(host().option()?.value).toBe("sensor");
  });

  it("starts each tool on the saved type only when it can draw it", async () => {
    const { host } = await setup(new Map([[DRAW_TYPE_KEY, "nav"]]));
    act(() => void host().setTool("pen"));
    expect(host().option()?.value).toBe("nav");
    act(() => void host().setTool("box"));
    expect(host().option()?.value).toBe("solid");
  });

  it("isn't saved by a type the tool refuses", async () => {
    const { host, saved } = await setup();
    act(() => void host().command("tool:box:type:nav"));
    expect(saved.has(DRAW_TYPE_KEY)).toBe(false);
    expect(host().option()?.value).toBe("solid");
  });
});
