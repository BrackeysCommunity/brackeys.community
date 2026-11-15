// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../../collab/index";
import {
  createEditorSession,
  type EditorSession,
  type ToolHost,
  type ToolOverlay,
} from "../../../../editor/index";
import { createRegistry } from "../../../../game/define";
import { memoryRuntimeView } from "../../../../headless/runtime-view";
import type { GameStoreState } from "../../../../index";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../../../scene/index";
import { createToolRouter } from "../../../../tool-router";
import type { EditorNotify, EditorStorage } from "../../../host";
import { KitProvider } from "../../../kit/index";
import { BehaviorMarks } from "../BehaviorMarks";
import {
  createToolHostCell,
  sessionSource,
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
const registry = createRegistry(null);
const LONG = "Welcome to the kitchen, where every behavior the engine has lives";
const VIEW = memoryRuntimeView({
  engine: { locales: { default: "en", available: ["en", "fr"] } },
  docs: {
    strings: {
      signs: {
        kind: "strings",
        v: 1,
        strings: [{ key: "sign.welcome", en: LONG, fr: "Bienvenue" }],
      },
    },
  },
});

const VIEW_PX = { width: 800, height: 600, scale: 100, tx: 0, ty: 0 };

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

/** A stand-in game with a project and a locale the player can change. */
function gameOf() {
  const store = new Store({ camera: { position: { x: 0, y: 0 }, scale: VIEW_PX.scale } });
  let locale = "en";
  const onLocale = new Set<() => void>();
  const game = {
    registry,
    router: createToolRouter(),
    getStore: () => store as unknown as Store<GameStoreState>,
    screenToWorld: (p: { x: number; y: number }) => p,
    panBy: () => {},
    zoomAt: () => {},
    frame: () => {},
    project: () => VIEW,
    locale: { current: () => locale },
    on: (event: string, fn: () => void) => void (event === "locale:change" && onLocale.add(fn)),
    off: (event: string, fn: () => void) => void (event === "locale:change" && onLocale.delete(fn)),
  } as unknown as ToolHostGame;
  const setLocale = (to: string) => {
    locale = to;
    for (const fn of onLocale) fn();
  };
  return { game, setLocale, listeners: () => onLocale.size };
}

async function setup() {
  const def = {
    v: SCENE_FORMAT_VERSION,
    name: "signs",
    bounds: [0, 0, 20, 10],
    entities: [
      {
        id: "sign",
        type: "marker",
        at: [4, 2],
        behaviors: {
          text: { key: "sign.welcome", size: 20, wrap: 120 },
          "path-follow": {
            path: {
              pts: [
                [4, 2],
                [8, 2],
              ],
              mode: "ping_pong",
              speed: 1,
            },
          },
        },
      },
    ],
  } as SceneDefinition;
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("s") }),
    origin: ada,
    name: "signs",
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(session);
  const storage: EditorStorage = { get: () => null, set: () => {} };
  const cell = createToolHostCell();
  const rig = gameOf();
  const { unmount } = render(
    <KitProvider host={{ storage }}>
      <Rig cell={cell} session={session} game={rig.game} />
    </KitProvider>,
  );
  await act(async () => {});
  return { session, host: (): ToolHost => cell.state!, unmount, ...rig };
}

describe("the tool host's text source at its mount", () => {
  it("measures text in the game's project and locale, and follows a locale change", async () => {
    const { session, host, setLocale } = await setup();
    expect(host().source().text?.strings).toEqual({ "sign.welcome": LONG });
    expect(sessionSource(session)).toBe(host().source());

    const changed = vi.fn();
    host().subscribe(changed);
    act(() => setLocale("fr"));
    expect(changed).toHaveBeenCalled();
    expect(sessionSource(session)?.text?.strings).toEqual({ "sign.welcome": "Bienvenue" });
  });

  it("lines a still entity's behavior marks up with the host's handles", async () => {
    const { session, host } = await setup();
    act(() => session.select(["sign"]));
    const pathOf = (overlay: ToolOverlay) => {
      const { container, unmount } = render(
        <svg>
          <BehaviorMarks session={session} view={VIEW_PX} transform="" overlay={overlay} />
        </svg>,
      );
      const d = container.querySelector('[data-behavior-mark="path"] path')?.getAttribute("d");
      unmount();
      return d;
    };
    const still = pathOf({});
    expect(still).toBeTruthy();
    expect(
      host()
        .overlay()
        .handles?.some((h) => h.id === "move"),
    ).toBe(true);
    expect(pathOf(host().overlay())).toBe(still);
  });

  it("lets go of the game and the session when it unmounts", async () => {
    const { session, unmount, listeners } = await setup();
    expect(listeners()).toBe(1);
    unmount();
    expect(listeners()).toBe(0);
    expect(sessionSource(session)).toBeUndefined();
  });
});
