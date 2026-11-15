// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  sceneToDoc,
  sequentialKeys,
  type ProjectSession,
  type ProjectSessionEvent,
  type SceneOrigin,
} from "../../../../collab/index";
import { createEditorSession, type EditorSession, type ToolHost } from "../../../../editor/index";
import { createRegistry } from "../../../../game/define";
import { memoryRuntimeView } from "../../../../headless/runtime-view";
import type { GameStoreState } from "../../../../index";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../../../scene/index";
import { createToolRouter } from "../../../../tool-router";
import type { EditorNotify } from "../../../host";
import { KitProvider } from "../../../kit/index";
import {
  createToolHostCell,
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

/** The project with the sign's string as `text`. */
const projectSaying = (text: string) =>
  memoryRuntimeView({
    engine: { locales: { default: "en", available: ["en"] } },
    docs: { strings: { signs: { kind: "strings", v: 1, strings: [{ key: "sign", en: text }] } } },
  });

const sessions: EditorSession[] = [];
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

/**
 * A project session whose docs are plain Y.Docs: "strings" open from the
 * start, others opened later through `open`. Each doc's first listener is the
 * project registry's, which hands the game its rebuilt project in place.
 */
function projectOf(game: { said: string }) {
  const docs = new Map<string, Y.Doc>();
  const listeners = new Set<(e: ProjectSessionEvent) => void>();
  const open = (name: string, text: string) => {
    const doc = new Y.Doc();
    doc.on("update", () => {
      game.said = text;
    });
    docs.set(name, doc);
    for (const l of listeners) l({ type: "open", doc: name });
    return doc;
  };
  const session = {
    projectDoc: new Y.Doc(),
    view: () => ({ byId: new Map() }),
    openDocs: () => [...docs.keys()],
    get: (name: string) => {
      const doc = docs.get(name);
      return doc ? { doc } : undefined;
    },
    subscribe(l: (e: ProjectSessionEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as ProjectSession;
  return { session, open, listeners: () => listeners.size };
}

function Rig(props: {
  cell: ToolHostCell;
  session: EditorSession;
  game: ToolHostGame;
  project: ProjectSession;
}) {
  useToolHostLifecycle(props.cell, props.session, props.game, notify, props.project);
  return null;
}

async function setup() {
  const def = {
    v: SCENE_FORMAT_VERSION,
    name: "signs",
    bounds: [0, 0, 20, 10],
    entities: [{ id: "sign", type: "marker", at: [4, 2], behaviors: { text: { key: "sign" } } }],
  } as SceneDefinition;
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("s") }),
    origin: ada,
    name: "signs",
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(session);
  const state = { said: "Hello" };
  const views = new Map<string, ReturnType<typeof projectSaying>>();
  const viewOf = (text: string) =>
    views.get(text) ?? views.set(text, projectSaying(text)).get(text)!;
  const store = new Store({ camera: { position: { x: 0, y: 0 }, scale: 100 } });
  const game = {
    registry,
    router: createToolRouter(),
    getStore: () => store as unknown as Store<GameStoreState>,
    screenToWorld: (p: { x: number; y: number }) => p,
    panBy: () => {},
    zoomAt: () => {},
    frame: () => {},
    project: () => viewOf(state.said),
  } as unknown as ToolHostGame;
  const project = projectOf(state);
  const strings = project.open("strings", "Bonjour");
  const cell = createToolHostCell();
  const { unmount } = render(
    <KitProvider host={{ storage: { get: () => null, set: () => {} } }}>
      <Rig cell={cell} session={session} game={game} project={project.session} />
    </KitProvider>,
  );
  await act(async () => {});
  return { host: (): ToolHost => cell.state!, strings, unmount, ...project };
}

const write = (doc: Y.Doc) => doc.getMap("m").set("k", Math.random());

describe("the tool host after a project doc's edit", () => {
  it("re-measures text once a strings edit moves the game's project in place", async () => {
    const { host, strings } = await setup();
    expect(host().source().text?.strings).toEqual({ sign: "Hello" });
    const changed = vi.fn();
    host().subscribe(changed);

    await act(async () => write(strings));
    expect(host().source().text?.strings).toEqual({ sign: "Bonjour" });
    expect(changed).toHaveBeenCalled();

    // An edit that leaves the project where it was doesn't re-index.
    changed.mockClear();
    await act(async () => write(strings));
    expect(changed).not.toHaveBeenCalled();
  });

  it("follows a doc opened after it started, and lets go of the session when it unmounts", async () => {
    const { host, open, unmount, listeners } = await setup();
    const later = open("signs-2", "Hola");
    const changed = vi.fn();
    host().subscribe(changed);
    await act(async () => write(later));
    expect(changed).toHaveBeenCalled();
    expect(host().source().text?.strings).toEqual({ sign: "Hola" });
    expect(listeners()).toBe(1);
    unmount();
    expect(listeners()).toBe(0);
  });
});
