// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { GameInstance, RunRecording } from "../../index";
import type { Registry } from "../../scene/index";
import type { ProjectConnection } from "../host";
import type { LiveEditor, OpenPrefab } from "../session/live-scene-editor";
import type { LoadedRun } from "../session/loaded-run";
import { useSceneEditor } from "../session/use-scene-editor";

const fakes = vi.hoisted(() => ({
  views: [{ v: 1 }, { v: 2 }],
  kinds: { kinds: true },
  edits: 0,
  ready: {
    session: {} as Record<string, unknown>,
    name: "scene:p.yard",
    id: "yard",
    doc: { doc: {}, awareness: null },
  },
  projectDestroy: vi.fn(),
  replaying: false,
  destroy: vi.fn(),
  overlay: null as unknown,
  overlayListeners: new Set<() => void>(),
  editorStores: [] as { setState: (fn: (s: { mode: string }) => { mode: string }) => void }[],
  sessions: [] as { select: ReturnType<typeof vi.fn>; setTool: ReturnType<typeof vi.fn> }[],
  prefabs: [] as { setState: (fn: () => OpenPrefab | null) => void }[],
  closePrefab: vi.fn(),
  connection: { destroy: () => {} } as Record<string, unknown>,
  follows: [] as { changes: unknown; game: unknown; off: ReturnType<typeof vi.fn> }[],
}));

fakes.ready.session = {
  view: () => fakes.views[Math.min(fakes.edits, 1)],
  kinds: fakes.kinds,
};

vi.mock("../connect/scene-doc", () => ({
  useSceneDoc: () => ({ status: "live", ready: fakes.ready, error: null, fellBack: null }),
}));
vi.mock("../session/live-scene-editor", async () => {
  const { Store } = await import("@tanstack/store");
  return {
    editorIdentity: () => ({ origin: { kind: "user", userId: "u", name: "U" } }),
    prefabsReady: async () => {},
    projectRegistry: () => ({
      current: () => fakes.overlay,
      ready: async () => {},
      subscribe: (l: () => void) => {
        fakes.overlayListeners.add(l);
        return () => fakes.overlayListeners.delete(l);
      },
      followAssets: (changes: unknown, game: unknown) => {
        const off = vi.fn();
        fakes.follows.push({ changes, game, off });
        return off;
      },
      destroy: () => {},
    }),
    openLiveEditor: vi.fn((): Partial<LiveEditor> => {
      const store = new Store({ mode: "edit" });
      fakes.editorStores.push(store);
      const prefab = new Store<OpenPrefab | null>(null);
      fakes.prefabs.push(prefab);
      const closePrefab = () => {
        fakes.closePrefab();
        prefab.setState(() => null);
      };
      return {
        session: (() => {
          const session = { store, select: vi.fn(), setTool: vi.fn() };
          fakes.sessions.push(session);
          return session;
        })() as unknown as LiveEditor["session"],
        host: new Store({}) as unknown as LiveEditor["host"],
        prefab,
        closePrefab,
        editing: (open) =>
          (open
            ? { prefab: { id: "post", scene: "yard", onBack: closePrefab } }
            : {}) as ReturnType<LiveEditor["editing"]>,
        play: () => true,
        replay: () => true,
        replaying: () => fakes.replaying,
        stop: () => {},
        restart: () => {},
        destroy: fakes.destroy,
      };
    }),
  };
});

type Listener = (recording: RunRecording) => void;

const host = {
  connect: () => {
    fakes.connection = {
      destroy: fakes.projectDestroy,
      subscribe: () => () => {},
      getState: () => ({ unsynced: 0 }),
    };
    return fakes.connection as unknown as ProjectConnection;
  },
};

const REGISTRY = {} as Registry;

function fakeGame(registry: Registry = REGISTRY) {
  const listeners = new Map<string, Set<Listener>>();
  const game = {
    registry,
    on: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    off: (type: string, fn: Listener) => void listeners.get(type)?.delete(fn),
  };
  const emit = (recording: RunRecording) => {
    for (const fn of listeners.get("play:recorded") ?? []) fn(recording);
  };
  const count = () => listeners.get("play:recorded")?.size ?? 0;
  return { game: game as unknown as GameInstance, emit, count };
}

const recording = { markers: [], outcome: { result: "won" } } as unknown as RunRecording;

async function mount() {
  const fake = fakeGame();
  const hook = renderHook(() =>
    useSceneEditor({
      host,
      game: fake.game,
      project: "p",
      registry: REGISTRY,
      scene: "yard",
      enabled: true,
    }),
  );
  await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
  const runStore = hook.result.current.editor!.runStore as Store<LoadedRun | null>;
  return { ...fake, hook, runStore };
}

afterEach(() => {
  cleanup();
  fakes.replaying = false;
  fakes.destroy.mockClear();
  fakes.projectDestroy.mockClear();
  fakes.overlay = REGISTRY;
  fakes.overlayListeners.clear();
  fakes.editorStores.length = 0;
  fakes.sessions.length = 0;
  fakes.prefabs.length = 0;
  fakes.closePrefab.mockClear();
  fakes.follows.length = 0;
});

describe("useSceneEditor's Play-to-loaded-run", () => {
  it("loads a Play's recording as the last run", async () => {
    const { emit, count, runStore } = await mount();
    expect(count()).toBe(1);
    expect(runStore.state).toBeNull();
    emit(recording);
    expect(runStore.state).toEqual({ name: "Last run", recording });
  });

  it("leaves the loaded run alone while a replay records", async () => {
    const { emit, runStore } = await mount();
    const loaded = { name: "run.json", recording };
    runStore.setState(() => loaded);
    fakes.replaying = true;
    emit({ ...recording } as RunRecording);
    expect(runStore.state).toBe(loaded);
  });

  it("stops listening on unmount", async () => {
    const { emit, count, hook, runStore } = await mount();
    expect(fakes.destroy).not.toHaveBeenCalled();
    hook.unmount();
    expect(count()).toBe(0);
    expect(fakes.destroy).toHaveBeenCalled();
    expect(fakes.projectDestroy).toHaveBeenCalled();
    emit(recording);
    expect(runStore.state).toBeNull();
  });
});

describe("useSceneEditor's project session", () => {
  it("opens the editor on the project's scene doc, inside its session", async () => {
    const { openLiveEditor } = await import("../session/live-scene-editor");
    const { hook } = await mount();
    expect(vi.mocked(openLiveEditor).mock.lastCall![0]).toMatchObject({
      doc: fakes.ready.doc.doc,
      name: "yard",
      project: { session: fakes.ready.session, doc: "scene:p.yard" },
    });
    expect(hook.result.current).toMatchObject({ status: "live", scene: "yard", error: null });
  });

  it("hands the host the open project's assets, its view read live", async () => {
    const { hook } = await mount();
    const assets = hook.result.current.assets!;
    expect(assets).toMatchObject({ project: "p", kinds: fakes.kinds });
    expect(assets.view()).toBe(fakes.views[0]);
    fakes.edits = 1;
    hook.rerender();
    expect(hook.result.current.assets).toBe(assets);
    expect(assets.view()).toBe(fakes.views[1]);
    fakes.edits = 0;
  });

  it("follows the link's asset:changed messages into the game it hands the editor", async () => {
    const { hook, game } = await mount();
    await waitFor(() => expect(fakes.follows).toHaveLength(1));
    expect(fakes.follows[0]).toMatchObject({ changes: fakes.connection, game });
    hook.unmount();
    expect(fakes.follows[0]!.off).toHaveBeenCalled();
  });

  it("hands no assets while the editor is off", () => {
    const hook = renderHook(() =>
      useSceneEditor({ host, game: null, project: "p", registry: REGISTRY, enabled: false }),
    );
    expect(hook.result.current.assets).toBeNull();
  });
});

describe("useSceneEditor's project registry", () => {
  const OVERLAY = { materials: new Map([["bouncy", {}]]) } as unknown as Registry;
  const NEWER = { materials: new Map() } as unknown as Registry;

  function mountOn(first: ReturnType<typeof fakeGame>) {
    return renderHook(
      ({ game }: { game: GameInstance }) =>
        useSceneEditor({
          host,
          game,
          project: "p",
          registry: REGISTRY,
          scene: "yard",
          enabled: true,
        }),
      { initialProps: { game: first.game } },
    );
  }

  it("hands the host the overlay and opens the editor once the game is built with it", async () => {
    const { openLiveEditor } = await import("../session/live-scene-editor");
    vi.mocked(openLiveEditor).mockClear();
    fakes.overlay = OVERLAY;
    const hook = mountOn(fakeGame());
    await waitFor(() => expect(hook.result.current.registry).toBe(OVERLAY));
    expect(hook.result.current.editor).toBeNull();
    expect(openLiveEditor).not.toHaveBeenCalled();

    const rebuilt = fakeGame(OVERLAY);
    hook.rerender({ game: rebuilt.game });
    await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
    expect(vi.mocked(openLiveEditor).mock.lastCall![0].game).toBe(rebuilt.game);
  });

  it("holds a material change while the editor plays, and hands it over on Stop", async () => {
    fakes.overlay = OVERLAY;
    const hook = mountOn(fakeGame(OVERLAY));
    await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
    const editor = fakes.editorStores.at(-1)!;

    act(() => editor.setState(() => ({ mode: "play" })));
    fakes.overlay = NEWER;
    act(() => {
      for (const l of fakes.overlayListeners) l();
    });
    expect(hook.result.current.registry).toBe(OVERLAY);
    expect(fakes.destroy).not.toHaveBeenCalled();

    act(() => editor.setState(() => ({ mode: "edit" })));
    expect(hook.result.current.registry).toBe(NEWER);
    await waitFor(() => expect(fakes.destroy).toHaveBeenCalled());
    expect(hook.result.current.editor).toBeNull();
  });
});

describe("useSceneEditor's rebuild", () => {
  const OVERLAY = { materials: new Map([["bouncy", {}]]) } as unknown as Registry;
  const NEWER = { materials: new Map() } as unknown as Registry;

  it("says it is rebuilding, then hands the next editor the selection and the tool", async () => {
    fakes.overlay = OVERLAY;
    const hook = renderHook(
      ({ game }: { game: GameInstance }) =>
        useSceneEditor({
          host,
          game,
          project: "p",
          registry: REGISTRY,
          scene: "yard",
          enabled: true,
        }),
      { initialProps: { game: fakeGame(OVERLAY).game } },
    );
    await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
    expect(hook.result.current.rebuilding).toBe(false);
    const store = fakes.editorStores.at(-1)! as unknown as {
      setState: (fn: () => unknown) => void;
    };
    act(() => store.setState(() => ({ mode: "edit", selection: ["crate"], tool: "rect" })));

    fakes.overlay = NEWER;
    act(() => {
      for (const l of fakes.overlayListeners) l();
    });
    await waitFor(() => expect(hook.result.current.editor).toBeNull());
    expect(hook.result.current.rebuilding).toBe(true);

    hook.rerender({ game: fakeGame(NEWER).game });
    await waitFor(() => expect(hook.result.current.editor).not.toBeNull());
    expect(hook.result.current.rebuilding).toBe(false);
    const next = fakes.sessions.at(-1)!;
    expect(next.select).toHaveBeenCalledWith(["crate"]);
    expect(next.setTool).toHaveBeenCalledWith("rect");
  });
});

describe("useSceneEditor's open prefab", () => {
  it("hands the shell the live editor's closePrefab as the prefab's way back, which Escape runs", async () => {
    const { hook } = await mount();
    const lastChrome = () => hook.result.current.editor!;
    expect(lastChrome().prefab).toBeUndefined();

    act(() => fakes.prefabs.at(-1)!.setState(() => ({}) as OpenPrefab));
    expect(lastChrome().prefab?.id).toBe("post");

    act(() => lastChrome().prefab!.onBack());
    expect(fakes.closePrefab).toHaveBeenCalledTimes(1);
    expect(lastChrome().prefab).toBeUndefined();
  });
});
