// @vitest-environment jsdom
import type { GameInstance } from "@jams/engine";
import type { ProjectRuntimeView } from "@jams/engine/project";
import type { Registry } from "@jams/engine/scene";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { LiveEditor, OpenPrefab } from "../live-scene-editor";
import { useSceneEditor } from "../use-scene-editor";

const fakes = vi.hoisted(() => ({
  ready: { session: {}, name: "scene:p.yard", id: "yard", doc: { doc: {}, awareness: null } },
  data: null as unknown,
  listeners: new Set<() => void>(),
  editorStores: [] as { setState: (fn: (s: { mode: string }) => { mode: string }) => void }[],
}));

const REGISTRY = {} as Registry;

vi.mock("@/lib/active-user-store", () => ({ activeUserStore: { state: { profile: null } } }));
vi.mock("../use-scene-doc", () => ({
  useSceneDoc: () => ({ status: "live", ready: fakes.ready, error: null }),
}));
vi.mock("../scene-provider", () => ({ connectEditorProject: () => ({ destroy: () => {} }) }));
vi.mock("@/components/game/editor/EditorShell", () => ({ editorChrome: () => ({}) }));
vi.mock("../live-scene-editor", async () => {
  const { Store } = await import("@tanstack/store");
  return {
    editorIdentity: () => ({ origin: { kind: "user", userId: "u", name: "U" } }),
    prefabsReady: async () => {},
    projectRegistry: () => ({
      current: () => REGISTRY,
      project: () => fakes.data,
      ready: async () => {},
      subscribe: (l: () => void) => {
        fakes.listeners.add(l);
        return () => fakes.listeners.delete(l);
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
        replaying: () => false,
        destroy: () => {},
      };
    }),
  };
});

const view = (avatarSpeed: number) =>
  ({ settings: { avatarSpeed }, table: () => [] }) as unknown as ProjectRuntimeView;

function mount(builtWith: ProjectRuntimeView | null) {
  const game = { registry: REGISTRY, on: () => {}, off: () => {} } as unknown as GameInstance;
  return renderHook(
    ({ built }: { built: ProjectRuntimeView | null }) =>
      useSceneEditor({
        game,
        builtWith: built,
        project: "p",
        registry: REGISTRY,
        scene: "yard",
        enabled: true,
      }),
    { initialProps: { built: builtWith } },
  );
}

afterEach(() => {
  cleanup();
  fakes.listeners.clear();
  fakes.editorStores.length = 0;
});

describe("useSceneEditor's project data", () => {
  it("hands the host the project's data, and opens the editor once the game is built with it", async () => {
    const data = view(450);
    fakes.data = data;
    const hook = mount(null);
    await waitFor(() => expect(hook.result.current.projectData).toBe(data));
    expect(hook.result.current.chrome).toBeNull();
    hook.rerender({ built: data });
    await waitFor(() => expect(hook.result.current.chrome).not.toBeNull());
  });

  it("holds a data change while the editor plays, and hands it over on Stop", async () => {
    const first = view(450);
    fakes.data = first;
    const hook = mount(first);
    await waitFor(() => expect(hook.result.current.chrome).not.toBeNull());
    const editor = fakes.editorStores.at(-1)!;

    act(() => editor.setState(() => ({ mode: "play" })));
    const next = view(600);
    fakes.data = next;
    act(() => {
      for (const l of fakes.listeners) l();
    });
    expect(hook.result.current.projectData).toBe(first);

    act(() => editor.setState(() => ({ mode: "edit" })));
    expect(hook.result.current.projectData).toBe(next);
    expect(hook.result.current.registry).toBe(REGISTRY);
  });
});
