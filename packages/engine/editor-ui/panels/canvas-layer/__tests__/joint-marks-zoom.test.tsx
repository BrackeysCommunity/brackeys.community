// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, render } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import {
  createEditorSession,
  type EditorSession,
  type SceneDefinition,
  type ToolHost,
  type ToolOverlay,
} from "../../../../editor/index";
import { createRegistry } from "../../../../game/define";
import type { GameStoreState } from "../../../../index";
import type { EntityDef } from "../../../../scene/types";
import { createToolRouter } from "../../../../tool-router";
import type { EditorNotify, EditorStorage } from "../../../host";
import { KitProvider } from "../../../kit/index";
import { useStoreValue } from "../../../session/use-store-value";
import { BehaviorMarks } from "../BehaviorMarks";
import {
  createToolHostCell,
  useHostChanges,
  useToolHost,
  useToolHostLifecycle,
  type ToolHostCell,
  type ToolHostGame,
} from "../tool-host";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});
const storage: EditorStorage = { get: () => null, set: () => {} };

const sessions: EditorSession[] = [];
const versions: number[] = [];
afterEach(() => {
  cleanup();
  versions.length = 0;
  for (const s of sessions.splice(0)) s.destroy();
});

const anchor: EntityDef = {
  id: "chain-anchor",
  type: "marker",
  at: [10, 1.5],
  behaviors: { collider: { shape: ["box", 0, 0, 0.1, 0.1] } },
};
const link: EntityDef = {
  id: "link-1",
  type: "marker",
  at: [10.4, 1.5],
  behaviors: {
    body: {},
    collider: { shape: ["box", 0, 0, 0.4, 0.05] },
    joint: { kind: "revolute", to: "chain-anchor", anchorA: [-0.4, 0], anchorB: [0, 0] },
  },
};

const overlayAt = (host: ToolHost | null, _version: number): ToolOverlay => host?.overlay() ?? {};

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
  const host = useToolHost(cell);
  const version = useHostChanges(host);
  versions.push(version);
  // Read once per announced change, as the compiler memoizes the canvas layer's read.
  const overlay = useMemo(() => overlayAt(host, version), [host, version]);
  const scale = useStoreValue(game.getStore(), (s) => s.camera.scale);
  const view = { width: 800, height: 600, scale, tx: 0, ty: 0 };
  return (
    <svg>
      <BehaviorMarks session={session} view={view} transform="" overlay={overlay} />
    </svg>
  );
}

type Camera = { position: { x: number; y: number }; scale: number };

function mount() {
  const def: SceneDefinition = {
    v: 1,
    name: "chain",
    bounds: [0, 0, 20, 20],
    settings: { physics: "rapier" },
    entities: [anchor, link],
  };
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("z") }),
    origin: ada,
    name: "chain",
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(session);
  const store = new Store<{ camera: Camera }>({ camera: { position: { x: 0, y: 0 }, scale: 32 } });
  const game = {
    registry,
    router: createToolRouter(),
    getStore: () => store as unknown as Store<GameStoreState>,
    screenToWorld: (p: { x: number; y: number }) => p,
    panBy: () => {},
    zoomAt: () => {},
    frame: () => {},
  } as unknown as ToolHostGame;
  const cell = createToolHostCell();
  const { container } = render(
    <KitProvider host={{ storage }}>
      <Rig cell={cell} session={session} game={game} />
    </KitProvider>,
  );
  const camera = (patch: Partial<Camera>) =>
    act(() => store.setState((s) => ({ camera: { ...s.camera, ...patch } })));
  const lines = () =>
    [...container.querySelectorAll("[data-joint-line]")].map((l) =>
      l.getAttribute("data-joint-line"),
    );
  return { session, cell, camera, lines };
}

describe("a joint's marks after a zoom", () => {
  it("draw no line between anchors that meet, at any scale since selecting", async () => {
    const { session, camera, lines } = mount();
    await act(async () => {});
    act(() => session.select(["link-1"]));
    expect(lines()).toEqual(["link"]);
    camera({ scale: 100 });
    expect(lines()).toEqual(["link"]);
    camera({ scale: 12 });
    expect(lines()).toEqual(["link"]);
  });

  it("re-read the host on a zoom but not on a pan", async () => {
    const { cell, camera } = mount();
    await act(async () => {});
    expect(cell.state).not.toBeNull();
    const start = versions.at(-1)!;
    camera({ position: { x: 3, y: 0 } });
    expect(versions.at(-1)).toBe(start);
    camera({ scale: 64 });
    expect(versions.at(-1)).toBe(start + 1);
  });
});
