import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { resolveScene } from "../../scene/resolve";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { groupEdit, groupLeftNote, groupRefusal } from "../commands";
import {
  buildTreeOutline,
  entryLabel,
  selectionAfterPromotes,
  treeDropBatch,
  typeLabel,
} from "../outline";

const registry = createRegistry(
  defineGame({
    id: "slots",
    types: [
      defineEntityType({
        type: "slot",
        description: "A numbered place on a board; its `at` is a row and column, not a point.",
        base: "marker",
        fields: { at: z.tuple([z.number(), z.number()]).describe("Row and column.") },
        inspector: { label: "Board slot" },
      }),
    ],
    actions: [],
    createRuntime: () => ({ snapshot: () => null }),
  }),
);

const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "slots",
  name: "board",
  bounds: [0, 0, 100, 100],
  solid: [["box", 5, 5, 1, 1]],
  entities: [
    { id: "board", type: "node", at: [40, 40], rot: 90, name: "Board" },
    { id: "a1", type: "slot", parent: "board", at: [1, 2] },
    { id: "pin", type: "marker", parent: "board", at: [1, 0] },
  ],
};

describe("the tree outline's world points", () => {
  const rows = buildTreeOutline(scene, registry);
  const resolved = resolveScene(scene, registry);
  const worldAt = (id: string) => resolved.entities!.find((e) => e.id === id)!.at as number[];

  it("are the resolved view's, so a field that isn't a point stays as written", () => {
    expect(worldAt("a1")).toEqual([1, 2]);
    expect(rows.find((r) => r.ref === "a1")?.detail).toBe("Board slot · 1, 2");
    expect(rows.find((r) => r.ref === "pin")?.detail).toBe(`marker · ${worldAt("pin").join(", ")}`);
  });
});

describe("labels", () => {
  it("name a type by its inspector label and an entry by its name, else their ids", () => {
    expect(typeLabel(registry, "slot")).toBe("Board slot");
    expect(typeLabel(registry, "unknown")).toBe("unknown");
    expect(entryLabel(scene, "board")).toBe("Board");
    expect(entryLabel(scene, "a1")).toBe("a1");
    expect(entryLabel(scene, "nothing")).toBe("nothing");
  });
});

describe("selectionAfterPromotes", () => {
  it("follows a promoted drawn shape to its id, and leaves a batch without promotes alone", () => {
    const promoting = treeDropBatch(scene, registry, undefined, ["~solid:0"], {
      kind: "reparent",
      parent: "board",
    })!;
    expect(selectionAfterPromotes(promoting, ["~solid:0", "pin"])).toEqual(["solid-1", "pin"]);
    const plain = treeDropBatch(scene, registry, undefined, ["pin"], {
      kind: "reparent",
      parent: null,
    })!;
    expect(selectionAfterPromotes(plain, ["pin"])).toBeUndefined();
  });
});

describe("grouping's refusal", () => {
  it("is groupEdit's own: a ref that names nothing, or a drawn shape that isn't there, can't be grouped", () => {
    for (const refs of [["ghost"], ["~solid:9"]]) {
      const why = groupRefusal(scene, registry, refs);
      expect(why).toBe(`${refs[0]} can't go under a node.`);
      const grouping = groupEdit(scene, registry, refs);
      expect(grouping.edit).toBeNull();
      expect(groupLeftNote(grouping)).toEqual({ title: why });
    }
    expect(groupRefusal(scene, registry, ["pin", "ghost"])).toBeNull();
  });

  it("notes how much a group left out, and why the first stays out", () => {
    const grouping = groupEdit(scene, registry, ["pin", "ghost"]);
    expect(grouping.grouped).toEqual(["pin"]);
    expect(groupLeftNote(grouping)).toEqual({
      title: "Grouped 1; 1 item left out.",
      why: "ghost can't go under a node.",
    });
    expect(groupLeftNote(groupEdit(scene, registry, ["pin"]))).toBeNull();
  });
});
