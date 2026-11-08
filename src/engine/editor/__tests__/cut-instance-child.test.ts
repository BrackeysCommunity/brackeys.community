import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import type { SceneOrigin } from "../../collab/types";
import { fake, yardPrefabs } from "../../scene/__tests__/fixtures/random-ops";
import { resolveScene } from "../../scene/resolve";
import type { SceneDefinition } from "../../scene/types";
import { createToolRouter } from "../../tool-router";
import { createEditorSession } from "../session";
import { createToolHost, type ToolHost } from "../tool-host";
import { DEFAULT_SNAP } from "../tools";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const prefabs = yardPrefabs("fake");
const yard: SceneDefinition = {
  v: 3,
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

function rig() {
  const doc = sceneToDoc(yard, { key: sequentialKeys("k") });
  const session = createEditorSession({
    doc,
    origin: ada,
    name: "yard",
    registry: fake,
    issuesDebounceMs: 0,
    prefabs: { library: () => prefabs, subscribe: () => () => {}, open: async () => null },
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
});
