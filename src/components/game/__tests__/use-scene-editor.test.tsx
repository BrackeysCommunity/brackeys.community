// @vitest-environment jsdom
import type { GameInstance, RunRecording } from "@jams/engine";
import { Store } from "@tanstack/store";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { LoadedRun } from "@/components/game/editor/loaded-run";

import type { LiveEditor, OpenPrefab } from "../live-scene-editor";
import { useSceneEditor } from "../use-scene-editor";

const fakes = vi.hoisted(() => ({
  ready: { doc: {}, awareness: null },
  replaying: false,
  editorChrome: vi.fn((props: { runStore: unknown }) => ({ props })),
  destroy: vi.fn(),
}));

vi.mock("@/lib/active-user-store", () => ({ activeUserStore: { state: { profile: null } } }));
vi.mock("../use-scene-doc", () => ({
  useSceneDoc: () => ({ status: "live", ready: fakes.ready }),
}));
vi.mock("../scene-provider", () => ({ connectSceneDoc: () => null }));
vi.mock("@/components/game/editor/EditorShell", () => ({ editorChrome: fakes.editorChrome }));
vi.mock("../live-scene-editor", async () => {
  const { Store } = await import("@tanstack/store");
  return {
    editorIdentity: () => ({ origin: { kind: "user", userId: "u", name: "U" } }),
    openLiveEditor: (): Partial<LiveEditor> => ({
      host: new Store({}) as unknown as LiveEditor["host"],
      prefab: new Store<OpenPrefab | null>(null),
      editing: () => ({}) as ReturnType<LiveEditor["editing"]>,
      play: () => true,
      replay: () => true,
      replaying: () => fakes.replaying,
      stop: () => {},
      restart: () => {},
      destroy: fakes.destroy,
    }),
  };
});

type Listener = (recording: RunRecording) => void;

function fakeGame() {
  const listeners = new Map<string, Set<Listener>>();
  const game = {
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
  const hook = renderHook(() => useSceneEditor({ game: fake.game, name: "yard", enabled: true }));
  await waitFor(() => expect(hook.result.current.chrome).not.toBeNull());
  const runStore = fakes.editorChrome.mock.lastCall![0].runStore as Store<LoadedRun | null>;
  return { ...fake, hook, runStore };
}

afterEach(() => {
  cleanup();
  fakes.replaying = false;
  fakes.editorChrome.mockClear();
  fakes.destroy.mockClear();
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
    emit(recording);
    expect(runStore.state).toBeNull();
  });
});
