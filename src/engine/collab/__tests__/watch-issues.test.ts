import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { gridField, pointField } from "../../game/fields";
import { engine } from "../../scene/__tests__/fixtures/fake-game";
import type { Prefab } from "../../scene/types";
import { prefabToDoc } from "../prefab-doc";
import { staticPrefabSource } from "../prefab-source";
import { validateDoc } from "../watch-issues";

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
