import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { gridField, pointField } from "../../game/fields";
import { engine } from "../../scene/__tests__/fixtures/fake-game";
import type { Prefab } from "../../scene/types";
import { sceneToDoc } from "../convert";
import { docToPrefab, prefabPatch, prefabToDoc } from "../prefab-doc";
import { localPrefabSource, staticPrefabSource } from "../prefab-source";
import { validateDoc, watchIssues } from "../watch-issues";
import { ada } from "./helpers";

const lamp = { id: "lamp", type: "marker", at: [0, 0] as [number, number] };
const prefab = (id: string, over: Partial<Prefab> = {}): Prefab => ({
  kind: "prefab",
  v: 3,
  id,
  entities: [lamp],
  ...over,
});

describe("validateDoc on a prefab doc", () => {
  it("reports a nested instance that reaches the open prefab as prefab-cycle", () => {
    // The library's copy of `loop` is stale: it doesn't hold `outer` yet.
    const library = new Map<string, Prefab>([
      ["loop", prefab("loop")],
      ["outer", prefab("outer", { instances: [{ id: "in", prefab: "loop", at: [0, 0] }] })],
    ]);
    const doc = prefabToDoc(
      prefab("loop", { instances: [{ id: "o1", prefab: "outer", at: [0, 0] }] }),
    );
    const issues = validateDoc(doc, engine, { prefabs: staticPrefabSource(library) });
    expect(issues.map((i) => i.code)).toContain("prefab-cycle");
  });

  it("doesn't ask a prefab with a grid child for settings.grid", () => {
    const PAINT = defineEntityType({
      type: "paint",
      description: "Painted cells.",
      base: "marker",
      fields: { at: pointField("The grid's corner."), cells: gridField("The cells.") },
    });
    const painter = createRegistry(
      defineGame({
        id: "painter",
        types: [PAINT],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const tiles = prefab("tiles", {
      game: "painter",
      entities: [{ id: "floor", type: "paint", at: [0, 0], cells: { "0,0": ["1*4"] } }],
    });
    const library = new Map([["tiles", tiles]]);
    const issues = validateDoc(prefabToDoc(tiles), painter, {
      prefabs: staticPrefabSource(library),
    });
    expect(issues).toEqual([]);
  });
});

describe("watchIssues", () => {
  const library = () =>
    new Map<string, Prefab>([
      [
        "outer",
        prefab("outer", { entities: [], instances: [{ id: "m", prefab: "mid", at: [0, 0] }] }),
      ],
      [
        "mid",
        prefab("mid", { entities: [], instances: [{ id: "i", prefab: "inner", at: [0, 0] }] }),
      ],
      ["inner", prefab("inner")],
      ["room", prefab("room")],
      ["red", prefab("red", { entities: [], base: "room" })],
    ]);
  const edit = (prefabs: ReturnType<typeof localPrefabSource>, id: string) => {
    const doc = prefabs.docs().get(id)!;
    const cur = docToPrefab(doc);
    prefabPatch(doc, { ...cur, id, entities: [{ ...lamp, at: [40, 0] }] }, ada);
  };
  /** Watches `doc` on a manual timer: `runs` counts validations, `pending` whether one is scheduled. */
  function watched(
    doc: Parameters<typeof watchIssues>[0],
    prefabs: ReturnType<typeof localPrefabSource>,
  ) {
    let pending: (() => void) | null = null;
    let runs = 0;
    const watch = watchIssues(doc, engine, () => runs++, {
      prefabs,
      setTimer: (fn) => (pending = fn),
      clearTimer: () => (pending = null),
    });
    return {
      watch,
      pending: () => pending !== null,
      fire() {
        const fn = pending;
        pending = null;
        fn?.();
        return runs;
      },
    };
  }
  const scene = (prefabId: string) =>
    sceneToDoc({
      v: 3,
      name: "reach",
      bounds: [0, 0, 1000, 1000],
      instances: [{ id: "o", prefab: prefabId, at: [100, 100] }],
      entities: [],
    });

  it("revalidates after an edit to a prefab nested two levels down", () => {
    const prefabs = localPrefabSource(library());
    const w = watched(scene("outer"), prefabs);
    edit(prefabs, "inner");
    expect(w.pending()).toBe(true);
    expect(w.fire()).toBe(1);
    w.watch.stop();
  });

  it("revalidates after an edit to a variant's base, from a scene and from the variant's own doc", () => {
    const prefabs = localPrefabSource(library());
    const fromScene = watched(scene("red"), prefabs);
    const fromVariant = watched(prefabToDoc(library().get("red")!), prefabs);
    edit(prefabs, "room");
    expect(fromScene.fire()).toBe(1);
    expect(fromVariant.fire()).toBe(1);
    fromScene.watch.stop();
    fromVariant.watch.stop();
  });

  it("leaves a scene alone when a prefab it doesn't reach changes", () => {
    const prefabs = localPrefabSource(library());
    const w = watched(scene("outer"), prefabs);
    edit(prefabs, "room");
    expect(w.pending()).toBe(false);
    w.watch.stop();
  });
});
