// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { memoryContentStore } from "../content-store";
import { INPUT_MAP_KIND, type InputMapFile } from "../kinds/input-map";
import { RUNTIME_VIEW_KINDS, runtimeView, snapshotRuntimeView } from "../runtime-view";
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
