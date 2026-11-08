// @vitest-environment jsdom
import type { GameInstance, RunRecording } from "@jams/engine";
import type { Registry } from "@jams/engine/scene";
import { Store } from "@tanstack/store";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { LoadedRun } from "@/components/game/editor/loaded-run";

import type { LiveEditor, OpenPrefab } from "../live-scene-editor";
import { useSceneEditor } from "../use-scene-editor";

const fakes = vi.hoisted(() => ({
  ready: { session: {}, name: "scene:p.yard", id: "yard", doc: { doc: {}, awareness: null } },
  projectDestroy: vi.fn(),
  replaying: false,
  editorChrome: vi.fn((props: { runStore: unknown }) => ({ props })),
  destroy: vi.fn(),
  overlay: null as unknown,
  overlayListeners: new Set<() => void>(),
  editorStores: [] as { setState: (fn: (s: { mode: string }) => { mode: string }) => void }[],
}));

vi.mock("@/lib/active-user-store", () => ({ activeUserStore: { state: { profile: null } } }));
vi.mock("../use-scene-doc", () => ({
  useSceneDoc: () => ({ status: "live", ready: fakes.ready, error: null }),
}));
vi.mock("../scene-provider", () => ({
  connectEditorProject: () => ({ destroy: fakes.projectDestroy }),
}));
vi.mock("@/components/game/editor/EditorShell", () => ({ editorChrome: fakes.editorChrome }));
vi.mock("../live-scene-editor", async () => {
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
      destroy: () => {},
    }),
    openLiveEditor: vi.fn((): Partial<LiveEditor> => {
      const store = new Store({ mode: "edit" });
      fakes.editorStores.push(store);
      return {
        session: { store } as unknown as LiveEditor["session"],
        host: new Store({}) as unknown as LiveEditor["host"],
        prefab: new Store<OpenPrefab | null>(null),
        editing: () => ({}) as ReturnType<LiveEditor["editing"]>,
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
      game: fake.game,
      project: "p",
      registry: REGISTRY,
      scene: "yard",
      enabled: true,
    }),
  );
  await waitFor(() => expect(hook.result.current.chrome).not.toBeNull());
  const runStore = fakes.editorChrome.mock.lastCall![0].runStore as Store<LoadedRun | null>;
  return { ...fake, hook, runStore };
}

afterEach(() => {
  cleanup();
  fakes.replaying = false;
  fakes.editorChrome.mockClear();
  fakes.destroy.mockClear();
  fakes.projectDestroy.mockClear();
  fakes.overlay = REGISTRY;
  fakes.overlayListeners.clear();
  fakes.editorStores.length = 0;
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
    const { openLiveEditor } = await import("../live-scene-editor");
    const { hook } = await mount();
    expect(vi.mocked(openLiveEditor).mock.lastCall![0]).toMatchObject({
      doc: fakes.ready.doc.doc,
      name: "yard",
      project: { session: fakes.ready.session, doc: "scene:p.yard" },
    });
    expect(hook.result.current).toMatchObject({ status: "live", scene: "yard", error: null });
  });
});

describe("useSceneEditor's project registry", () => {
  const OVERLAY = { materials: new Map([["bouncy", {}]]) } as unknown as Registry;
  const NEWER = { materials: new Map() } as unknown as Registry;

  function mountOn(first: ReturnType<typeof fakeGame>) {
    return renderHook(
      ({ game }: { game: GameInstance }) =>
        useSceneEditor({ game, project: "p", registry: REGISTRY, scene: "yard", enabled: true }),
      { initialProps: { game: first.game } },
    );
  }

  it("hands the host the overlay and opens the editor once the game is built with it", async () => {
    const { openLiveEditor } = await import("../live-scene-editor");
    vi.mocked(openLiveEditor).mockClear();
    fakes.overlay = OVERLAY;
    const hook = mountOn(fakeGame());
    await waitFor(() => expect(hook.result.current.registry).toBe(OVERLAY));
    expect(hook.result.current.chrome).toBeNull();
    expect(openLiveEditor).not.toHaveBeenCalled();

    const rebuilt = fakeGame(OVERLAY);
    hook.rerender({ game: rebuilt.game });
    await waitFor(() => expect(hook.result.current.chrome).not.toBeNull());
    expect(vi.mocked(openLiveEditor).mock.lastCall![0].game).toBe(rebuilt.game);
  });

  it("holds a material change while the editor plays, and hands it over on Stop", async () => {
    fakes.overlay = OVERLAY;
    const hook = mountOn(fakeGame(OVERLAY));
    await waitFor(() => expect(hook.result.current.chrome).not.toBeNull());
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
    expect(hook.result.current.chrome).toBeNull();
  });
});
