import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import type { SceneOrigin } from "../../collab/types";
import { fake, yardPrefabs } from "../../scene/__tests__/fixtures/random-ops";
import { prefabLibrary } from "../../scene/prefab";
import { resolveScene } from "../../scene/resolve";
import type { Prefab, PrefabLibrary, SceneDefinition } from "../../scene/types";
import { validateScene } from "../../scene/validate";
import { createToolRouter } from "../../tool-router";
import { createEditorSession } from "../session";
import { createToolHost, type ToolHost } from "../tool-host";
import { DEFAULT_SNAP } from "../tools";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const prefabs = yardPrefabs("fake");
const yard: SceneDefinition = {
  v: 4,
  game: "fake",
  name: "yard",
  bounds: [0, 0, 2000, 2000],
  instances: [{ id: "gate-2", prefab: "gate", at: [300, 400] }],
  entities: [{ id: "pull", type: "lever", at: [10, 20] }],
};

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

const fixturePrefab = (name: string): Prefab =>
  JSON.parse(
    readFileSync(
      new URL(`../../scene/__tests__/fixtures/prefabs/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as Prefab;
/** room holds a door instance, and the door holds a gate: three levels. */
const nestedPrefabs = prefabLibrary(["gate", "door", "room"].map(fixturePrefab));
const hall: SceneDefinition = {
  v: 4,
  game: "fake",
  name: "hall",
  bounds: [0, 0, 2000, 2000],
  instances: [{ id: "room-1", prefab: "room", at: [600, 600] }],
};

function rig(scene: SceneDefinition = yard, library: PrefabLibrary = prefabs) {
  const doc = sceneToDoc(scene, { key: sequentialKeys("k") });
  const session = createEditorSession({
    doc,
    origin: ada,
    name: scene.name,
    registry: fake,
    issuesDebounceMs: 0,
    prefabs: { library: () => library, subscribe: () => () => {}, open: async () => null },
  });
  const host: ToolHost = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x, y],
    scale: () => 1,
    runtime: { update: () => ({ ok: true }) },
    snap: { ...DEFAULT_SNAP, enabled: false },
    now: () => 0,
  });
  cleanup.push(() => {
    host.destroy();
    session.destroy();
  });
  return { session, host };
}

describe("cutting through the tool host", () => {
  it("cuts an instance's child as one undo step", () => {
    const { session, host } = rig();
    session.select(["gate-2/door", "pull"]);
    const text = host.cut();
    expect(JSON.parse(text).entities.map((e: { id: string }) => e.id)).toEqual(["pull", "door"]);
    const def = session.getDoc();
    expect(def.entities ?? []).toEqual([]);
    expect(def.instances![0]!.overrides).toEqual({ "door.off": true });
    const door = resolveScene(def, fake, prefabs).entities!.find((e) => e.id === "gate-2/door");
    expect(door?.off).toBe(true);
    session.undo();
    expect(session.getDoc().instances![0]!.overrides).toBeUndefined();
    expect(session.getDoc().entities!.map((e) => e.id)).toEqual(["pull"]);
  });

  it("cuts an instance's bulk child into an off override that validates clean", () => {
    const { session, host } = rig();
    session.select(["gate-2/~solid:0"]);
    host.cut();
    const def = session.getDoc();
    expect(def.instances![0]!.overrides).toEqual({ "~solid:0.off": true });
    const solid = resolveScene(def, fake, prefabs).entities!.find(
      (e) => e.id === "gate-2/~solid:0",
    );
    expect(solid?.off).toBe(true);
    expect(validateScene(def, fake, { prefabs })).toEqual([]);
  });

  it("cuts a nested instance's child and a nested instance into off overrides", () => {
    const { session, host } = rig(hall, nestedPrefabs);
    const entityOf = (def: SceneDefinition, id: string) =>
      resolveScene(def, fake, nestedPrefabs).entities!.find((e) => e.id === id);

    session.select(["room-1/door-1/panel"]);
    host.cut();
    let def = session.getDoc();
    expect(def.instances![0]!.overrides).toEqual({ "door-1/panel.off": true });
    expect(entityOf(def, "room-1/door-1/panel")?.off).toBe(true);
    expect(entityOf(def, "room-1/door-1/frame")?.off).toBeFalsy();
    expect(validateScene(def, fake, { prefabs: nestedPrefabs })).toEqual([]);
    session.undo();
    expect(session.getDoc().instances![0]!.overrides).toBeUndefined();

    session.select(["room-1/door-1"]);
    host.cut();
    def = session.getDoc();
    expect(def.instances![0]!.overrides).toEqual({ "door-1.off": true });
    for (const id of ["room-1/door-1/panel", "room-1/door-1/frame", "room-1/door-1/latch/door"]) {
      expect(entityOf(def, id)?.off).toBe(true);
    }
    expect(entityOf(def, "room-1/lamp")?.off).toBeFalsy();
    expect(validateScene(def, fake, { prefabs: nestedPrefabs })).toEqual([]);
    session.undo();
    expect(session.getDoc()).toEqual(hall);
  });
});
