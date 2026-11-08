import { describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { attachField, shapeField } from "../../game/fields";
import { prefabLibrary } from "../../scene/prefab";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { attachBatch, attachFieldOf, isFollowerType } from "../attach";
import { createEditorSession } from "../session";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const follower = (id: string, x: number) => ({
  id,
  type: "follower",
  shape: ["box", x, 0, 10, 2],
  path: {
    pts: [
      [0, 0],
      [50, 0],
    ],
    mode: "loop",
    speed: 10,
  },
});

function scene(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "rides",
    bounds: [0, 0, 1000, 1000],
    solid: [["box", 0, 990, 1000, 10]],
    entities: [
      { id: "deck", type: "solid", shape: ["box", 100, 100, 20, 4] },
      { id: "trip", type: "sensor", shape: ["box", 200, 100, 8, 8], attach: "lift" },
      { id: "pad", type: "marker", at: [5, 5] },
      follower("lift", 100),
      follower("rail", 300),
    ] as SceneDefinition["entities"],
    instances: [{ id: "gate-2", prefab: "gate", at: [500, 500] }],
  };
}

const prefabs = prefabLibrary([
  {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id: "gate",
    entities: [follower("lift", 0), { id: "post", type: "marker", at: [0, 0] }] as never,
  },
]);

describe("attachBatch", () => {
  it("is one update setting the type's attachField to the follower", () => {
    expect(attachBatch(scene(), "deck", "lift", registry)).toEqual({
      label: "Attach deck to lift",
      ops: [{ op: "update", ref: "deck", set: { attach: "lift" } }],
    });
    expect(attachBatch(scene(), "trip", "rail", registry)?.ops).toEqual([
      { op: "update", ref: "trip", set: { attach: "rail" } },
    ]);
  });

  it("clears the field for a null follower, and is null when nothing is attached", () => {
    expect(attachBatch(scene(), "trip", null, registry)).toEqual({
      label: "Detach trip",
      ops: [{ op: "update", ref: "trip", unset: ["attach"] }],
    });
    expect(attachBatch(scene(), "deck", null, registry)).toBeNull();
  });

  it("is null without an attachField, for a follower its refs don't allow, or with nothing to change", () => {
    expect(attachBatch(scene(), "pad", "lift", registry)).toBeNull();
    expect(attachBatch(scene(), "deck", "pad", registry)).toBeNull();
    expect(attachBatch(scene(), "deck", "trip", registry)).toBeNull();
    expect(attachBatch(scene(), "deck", "nowhere", registry)).toBeNull();
    expect(attachBatch(scene(), "trip", "lift", registry)).toBeNull();
    expect(attachBatch(scene(), "~solid:0", "lift", registry)).toBeNull();
    expect(attachBatch(scene(), "gate-2", "lift", registry)).toBeNull();
  });

  it("takes an instance's child follower by its resolved ref", () => {
    expect(attachBatch(scene(), "deck", "gate-2/lift", registry, prefabs)?.ops).toEqual([
      { op: "update", ref: "deck", set: { attach: "gate-2/lift" } },
    ]);
    expect(attachBatch(scene(), "deck", "gate-2/post", registry, prefabs)).toBeNull();
    expect(attachBatch(scene(), "deck", "gate-2/lift", registry)).toBeNull();
  });

  it("follows a game type's own attachField and the types its refs name, bases included", () => {
    const game = createRegistry(
      defineGame({
        id: "cranes",
        types: [
          defineEntityType({
            type: "crate",
            base: "solid",
            description: "A box that can ride a hook.",
            fields: {
              shape: shapeField("Crate shape."),
              hook: attachField("The hook it hangs from."),
            },
          }),
          defineEntityType({
            type: "hook",
            base: "follower",
            description: "A moving hook.",
            fields: registry.types.get("follower")!.shape,
          }),
        ],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    expect(attachFieldOf(game, "crate")).toEqual({ field: "hook", targets: ["follower"] });
    expect(attachFieldOf(game, "marker")).toBeNull();
    expect(isFollowerType(game, "hook")).toBe(true);
    expect(isFollowerType(game, "marker")).toBe(false);
    const def: SceneDefinition = {
      ...scene(),
      game: "cranes",
      entities: [
        { id: "box", type: "crate", shape: ["box", 0, 0, 4, 4] },
        { ...follower("h", 0), type: "hook" },
      ] as SceneDefinition["entities"],
      instances: [],
    };
    expect(attachBatch(def, "box", "h", game)?.ops).toEqual([
      { op: "update", ref: "box", set: { hook: "h" } },
    ]);
  });

  it("dispatches as one undo step and one history row", () => {
    const session = createEditorSession({
      doc: sceneToDoc(scene(), { key: sequentialKeys("t") }),
      origin: ada,
      name: "rides",
      registry,
      issuesDebounceMs: 0,
    });
    const rows = session.store.state.history.length;
    session.dispatch(attachBatch(session.getDoc(), "deck", "lift", registry)!);
    expect(session.getDoc().entities![0]).toMatchObject({ id: "deck", attach: "lift" });
    expect(session.store.state.history.length).toBe(rows + 1);
    expect(session.store.state.history.at(-1)).toMatchObject({ label: "Attach deck to lift" });
    session.undo();
    expect(session.getDoc().entities![0]!.attach).toBeUndefined();
    session.destroy();
  });
});
