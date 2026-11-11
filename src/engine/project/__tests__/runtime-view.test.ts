// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { memoryContentStore } from "../content-store";
import { INPUT_MAP_KIND, type InputMapFile } from "../kinds/input-map";
import { SCENE_LIST_KIND, type SceneListFile } from "../kinds/scene-list";
import { heldProject, RUNTIME_VIEW_KINDS, runtimeView, snapshotRuntimeView } from "../runtime-view";
import { snapshotProject } from "../snapshot";
import type { AssetEntry, AssetId } from "../types";
import { projectView } from "../view";

const registry = createRegistry(testGame);

const entry = (id: string, kind: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind,
  path,
  created: { at: 0, by: "test" },
});

const viewOf = (entries: AssetEntry[]) =>
  projectView({
    meta: { projectId: "test", layout: 1, name: "Test" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  });

const MAP: InputMapFile = {
  kind: INPUT_MAP_KIND,
  v: 1,
  players: { max: 2, join: "press" },
  deadzone: 0.2,
  actions: [
    {
      action: "push",
      bindings: [
        { device: "key", code: "Space" },
        { device: "touch", control: "jump" },
      ],
    },
    { action: "left", bindings: [{ device: "key", code: "KeyA", player: 1 }] },
  ],
  touch: [{ id: "jump", kind: "button", action: "push", at: [0.85, 0.8], radius: 0.08 }],
};

describe("ProjectRuntimeView.inputMap", () => {
  it("is null without an input map", () => {
    expect(runtimeView(viewOf([]), new Map(), registry).inputMap).toBeNull();
  });

  it("is the project's input map, copied and frozen", () => {
    const file = structuredClone(MAP);
    const view = viewOf([entry("controls", INPUT_MAP_KIND, "input-map.json")]);
    const { inputMap } = runtimeView(view, new Map([["controls", file]]), registry);
    expect(inputMap).toEqual(MAP);
    expect(Object.isFrozen(inputMap)).toBe(true);
    expect(Object.isFrozen(inputMap!.actions![0]!.bindings[0])).toBe(true);
    file.actions![0]!.bindings = [];
    expect(inputMap!.actions![0]!.bindings).toHaveLength(2);
  });

  it("reads the first input map by path", () => {
    const view = viewOf([
      entry("later", INPUT_MAP_KIND, "z/input-map.json"),
      entry("first", INPUT_MAP_KIND, "a/input-map.json"),
    ]);
    const values = new Map<AssetId, unknown>([
      ["later", { ...MAP, deadzone: 0.5 }],
      ["first", MAP],
    ]);
    expect(runtimeView(view, values, registry).inputMap?.deadzone).toBe(0.2);
  });

  it("leaves out the seats, actions and controls it gets wrong, so those keep the game's", () => {
    const file = {
      ...MAP,
      players: { max: 9, join: "auto" },
      actions: [
        { action: "pussh", bindings: [{ device: "key", code: "KeyP" }] },
        { action: "right", bindings: [{ device: "key", code: "Arrowright" }] },
        ...MAP.actions!,
      ],
      touch: [...MAP.touch!, { id: "fire", kind: "button", action: "fire", at: [0, 0], radius: 1 }],
    };
    const view = viewOf([entry("controls", INPUT_MAP_KIND, "input-map.json")]);
    const { inputMap } = runtimeView(view, new Map([["controls", file]]), registry);
    expect(inputMap?.players).toBeUndefined();
    // With the game's single seat, seat 1's key binding is past the last seat too.
    expect(inputMap?.actions?.map((a) => a.action)).toEqual(["push"]);
    expect(inputMap?.touch?.map((t) => t.id)).toEqual(["jump"]);
    expect(inputMap?.deadzone).toBe(0.2);
  });

  it("is null for a value that isn't an input map's shape", () => {
    const view = viewOf([entry("controls", INPUT_MAP_KIND, "input-map.json")]);
    for (const value of [undefined, "text", { kind: INPUT_MAP_KIND, v: 1, deadzone: 3 }])
      expect(runtimeView(view, new Map([["controls", value]]), registry).inputMap).toBeNull();
  });

  it("is read from a snapshot's pinned input-map doc", async () => {
    expect(RUNTIME_VIEW_KINDS).toContain(INPUT_MAP_KIND);
    const store = memoryContentStore();
    const text = JSON.stringify(MAP);
    await store.put(new TextEncoder().encode(text));
    const view = viewOf([entry("controls", INPUT_MAP_KIND, "input-map.json")]);
    const snapshot = await snapshotProject(view, new Map([["controls", text]]), {});
    expect((await snapshotRuntimeView(snapshot, store, registry)).inputMap).toEqual(MAP);
  });
});

describe("ProjectRuntimeView.flow", () => {
  const LIST: SceneListFile = {
    kind: SCENE_LIST_KIND,
    v: 1,
    start: "menu",
    scenes: [
      { scene: "menu", title: "Title" },
      { scene: "ford", title: "Ford" },
      { scene: "cellar", sublevel: true },
    ],
  };
  const listView = viewOf([entry("flow", SCENE_LIST_KIND, "scene-list.json")]);

  it("is the empty flow without a scene list", () => {
    expect(runtimeView(viewOf([]), new Map(), registry).flow).toEqual({ start: null, scenes: [] });
  });

  it("is the scene list's start and entries in order, copied and frozen", () => {
    const file = structuredClone(LIST);
    const { flow } = runtimeView(listView, new Map([["flow", file]]), registry);
    expect(flow).toEqual({ start: LIST.start, scenes: LIST.scenes });
    expect(Object.isFrozen(flow)).toBe(true);
    expect(Object.isFrozen(flow?.scenes[0])).toBe(true);
    file.scenes.pop();
    expect(flow?.scenes).toHaveLength(3);
  });

  it("leaves out a repeated scene's later entries and entries naming no scene", () => {
    const file = {
      ...LIST,
      scenes: [
        { scene: "menu" },
        { title: "no scene" },
        { scene: "menu", title: "again" },
        { scene: "ford", sublevel: false },
      ],
    };
    const { flow } = runtimeView(listView, new Map([["flow", file]]), registry);
    expect(flow?.scenes).toEqual([{ scene: "menu" }, { scene: "ford" }]);
  });

  it("reads the first scene list by path, and an unreadable one as empty", () => {
    const view = viewOf([
      entry("later", SCENE_LIST_KIND, "z/scene-list.json"),
      entry("flow", SCENE_LIST_KIND, "scene-list.json"),
    ]);
    const later = { ...LIST, start: "ford" };
    expect(
      runtimeView(
        view,
        new Map<AssetId, unknown>([
          ["flow", LIST],
          ["later", later],
        ]),
        registry,
      ).flow?.start,
    ).toBe("menu");
    expect(runtimeView(listView, new Map([["flow", "text"]]), registry).flow).toEqual({
      start: null,
      scenes: [],
    });
  });

  it("is read from a snapshot's pinned scene-list doc and from held files", async () => {
    expect(RUNTIME_VIEW_KINDS).toContain(SCENE_LIST_KIND);
    const store = memoryContentStore();
    const text = JSON.stringify(LIST);
    await store.put(new TextEncoder().encode(text));
    const snapshot = await snapshotProject(listView, new Map([["flow", text]]), {});
    expect((await snapshotRuntimeView(snapshot, store, registry)).flow?.start).toBe("menu");
    const held = heldProject([{ path: "scene-list.json", json: LIST }], registry, {
      projectId: "test",
      name: "Test",
    });
    expect(held.view.byPath.get("scene-list.json")?.kind).toBe(SCENE_LIST_KIND);
    expect(held.runtime.flow?.scenes.map((e) => e.scene)).toEqual(["menu", "ford", "cellar"]);
  });
});

describe("heldProject", () => {
  const meta = { projectId: "test", name: "Test" };
  const png = {
    kind: "asset-sidecar" as const,
    v: 1 as const,
    key: "k-crate",
    id: "crate",
    sha256: "c".repeat(64),
    bytes: 12,
    import: { filter: "nearest" },
    meta: { format: "png", width: 16, height: 8 },
  };

  it("keys docs and binaries by their sidecars, reads binaries from them, and leaves out the rest", () => {
    const { view, kinds, runtime } = heldProject(
      [
        {
          path: "input-map.json",
          json: MAP,
          sidecar: { kind: "asset-sidecar", v: 1, key: "k-map", id: "controls" },
        },
        { path: "art/crate.png", sidecar: png },
        {
          path: "art/unhashed.png",
          sidecar: { kind: "asset-sidecar", v: 1, key: "u", id: "unhashed" },
        },
        { path: "art/bare.png" },
        { path: "notes.txt", json: "hi" },
        { path: "game-settings.json" },
      ],
      registry,
      meta,
    );
    expect([...view.byId.keys()].sort()).toEqual(["controls", "crate"]);
    expect(view.byKey.get("k-crate")).toMatchObject({
      kind: "texture",
      path: "art/crate.png",
      sha256: png.sha256,
      bytes: 12,
      import: { filter: "nearest" },
      meta: png.meta,
    });
    expect(view.state.meta).toEqual({ projectId: "test", layout: 1, name: "Test" });
    expect(kinds.get("texture")).toBeDefined();
    expect(runtime.inputMap).toEqual(MAP);
    expect(runtime.asset("crate")).toMatchObject({ size: [16, 8], filter: "nearest" });
  });

  it("reads files in path order whatever order they come in, a doc without a sidecar by its own id", () => {
    const later = { ...structuredClone(MAP), deadzone: 0.5 };
    const { view, runtime } = heldProject(
      [
        { path: "z/input-map.json", json: later },
        { path: "a/input-map.json", json: MAP },
      ],
      registry,
      meta,
    );
    expect(runtime.inputMap?.deadzone).toBe(0.2);
    expect(view.byPath.get("a/input-map.json")?.id).toBe("input-map");
    expect(view.byPath.get("z/input-map.json")?.key).not.toBe(
      view.byPath.get("a/input-map.json")?.key,
    );
  });

  it("reads an id two sidecars give from the file the view resolves it to", () => {
    const car = (key: string) => ({
      kind: "asset-sidecar" as const,
      v: 1 as const,
      key,
      id: "pad",
    });
    const { view, runtime } = heldProject(
      [
        { path: "z/input-map.json", json: { ...MAP, deadzone: 0.5 }, sidecar: car("kz") },
        { path: "a/input-map.json", json: MAP, sidecar: car("ka") },
      ],
      registry,
      meta,
    );
    expect(view.byId.get("pad")?.path).toBe("a/input-map.json");
    expect(runtime.inputMap?.deadzone).toBe(0.2);
  });
});
