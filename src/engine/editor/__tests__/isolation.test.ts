import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyOpsToDoc } from "../../collab/apply";
import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import { readLog } from "../../collab/log";
import type { SceneOrigin } from "../../collab/types";
import { createRegistry } from "../../game/define";
import { prefabLibrary } from "../../scene/prefab";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { isolationBounds, openPrefabIsolation } from "../isolation";
import { createEditorSession } from "../session";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const bo: SceneOrigin = { kind: "user", userId: "bo", name: "Bo" };

const POST: Prefab = {
  kind: "prefab",
  v: 2,
  id: "post",
  entities: [{ id: "top", type: "marker", at: [0, -40] }],
  bulk: { solid: [["box", 0, 0, 6, 40]] },
};

function scene(): SceneDefinition {
  return {
    v: 2,
    name: "posts",
    bounds: [0, 0, 2000, 1200],
    entities: [{ id: "lamp", type: "marker", at: [50, 50] }],
    instances: [
      { id: "post-1", prefab: "post", at: [100, 900] },
      { id: "post-2", prefab: "post", at: [300, 900], overrides: { "top.at": [0, -60] } },
    ],
  };
}

function setup() {
  const doc = sceneToDoc(scene(), { key: sequentialKeys("t"), prefabs: prefabLibrary([POST]) });
  const main = createEditorSession({
    doc,
    origin: ada,
    name: "posts",
    registry,
    issuesDebounceMs: 0,
  });
  const iso = openPrefabIsolation(main, "post", {
    key: sequentialKeys("iso"),
    issuesDebounceMs: 0,
  })!;
  return { doc, main, iso };
}

const childAt = (main: ReturnType<typeof setup>["main"], ref: string) =>
  main.getResolved().entities!.find((e) => e.id === ref)!.at;

describe("openPrefabIsolation", () => {
  it("edits the prefab at its local coordinates, around its origin", () => {
    const { iso } = setup();
    const def = iso.session.getDoc();
    expect(def.name).toBe("post");
    expect(def.entities).toEqual([{ id: "top", type: "marker", at: [0, -40] }]);
    expect(def.solid).toEqual([["box", 0, 0, 6, 40]]);
    expect(def.bounds).toEqual([-1000, -600, 1000, 600]);
    expect(iso.session.store.state.canUndo).toBe(false);
  });

  it("lands each batch in the scene as one definePrefab, so every instance follows", () => {
    const { doc, main, iso } = setup();
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    const result = iso.session.dispatch({ ops: [{ op: "move", refs: ["top"], by: [10, 0] }] });
    expect(result.ok).toBe(true);
    expect(transactions).toBe(1);
    expect(main.getPrefabs().get("post")!.entities[0]!.at).toEqual([10, -40]);
    expect(childAt(main, "post-1/top")).toEqual([110, 860]);
    // post-2 overrides `top.at`, so it keeps its own.
    expect(childAt(main, "post-2/top")).toEqual([300, 840]);
    expect(readLog(doc).at(-1)!.label).toBe("Move top in post");
    expect(iso.session.store.state.canUndo).toBe(true);
    expect(iso.session.store.state.history.at(-1)!.label).toBe("Move top in post");
  });

  it("undoes and redoes through the scene's history, only back through its own edits", () => {
    const { main, iso } = setup();
    main.dispatch({ ops: [{ op: "move", refs: ["lamp"], by: [5, 5] }] });
    iso.session.dispatch({ ops: [{ op: "move", refs: ["top"], by: [10, 0] }] });
    expect(iso.session.undo()).toBe(true);
    expect(iso.session.getDoc().entities![0]!.at).toEqual([0, -40]);
    expect(childAt(main, "post-1/top")).toEqual([100, 860]);
    expect(iso.session.store.state.canUndo).toBe(false);
    // The scene edit made before opening stays.
    expect(iso.session.undo()).toBe(false);
    expect(main.getDoc().entities![0]!.at).toEqual([55, 55]);
    expect(iso.session.redo()).toBe(true);
    expect(iso.session.getDoc().entities![0]!.at).toEqual([10, -40]);
    iso.close();
    // Back in the scene, its undo covers the isolation's edit.
    expect(main.undo()).toBe(true);
    expect(main.getPrefabs().get("post")!.entities[0]!.at).toEqual([0, -40]);
  });

  it("refuses scene-only ops, and a batch the prefab can't hold, leaving both docs as they were", () => {
    const { main, iso } = setup();
    const before = main.getHash();
    const refused = iso.session.dispatch({
      ops: [{ op: "setScene", set: { name: "other" } }],
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.issue.code).toBe("op-invalid");
    expect(main.getHash()).toBe(before);
    expect(iso.session.getDoc().name).toBe("post");
    const grouped = iso.session.dispatch({
      ops: [{ op: "add", entity: { id: "x", type: "marker", at: [0, 0], group: "walls" } }],
    });
    expect(grouped.ok).toBe(false);
    expect(main.getHash()).toBe(before);
    expect(main.getPrefabs().get("post")).toEqual(POST);
    expect(iso.session.getDoc().entities!.map((e) => e.id)).toEqual(["top"]);
  });

  it("follows the prefab when it changes elsewhere, and closes when it's deleted", () => {
    const { doc, main, iso } = setup();
    let gone = 0;
    iso.close();
    const live = openPrefabIsolation(main, "post", { onGone: () => gone++, issuesDebounceMs: 0 })!;
    applyOpsToDoc(
      doc,
      {
        ops: [
          {
            op: "definePrefab",
            id: "post",
            prefab: { entities: [{ id: "top", type: "marker", at: [0, -80] }] },
          },
        ],
      },
      bo,
      registry,
    );
    expect(live.session.getDoc().entities).toEqual([{ id: "top", type: "marker", at: [0, -80] }]);
    expect(live.session.getDoc().solid).toBeUndefined();
    applyOpsToDoc(doc, { ops: [{ op: "definePrefab", id: "post", prefab: null }] }, bo, registry);
    expect(gone).toBe(1);
    expect(live.session.dispatch({ ops: [{ op: "move", refs: ["top"], by: [1, 0] }] }).ok).toBe(
      false,
    );
  });

  it("is null for a prefab the scene doesn't hold", () => {
    const { main } = setup();
    expect(openPrefabIsolation(main, "nope")).toBeNull();
  });

  it("grows the bounds to hold children far from the origin", () => {
    const far: Prefab = { ...POST, entities: [{ id: "top", type: "marker", at: [3000, 0] }] };
    expect(isolationBounds(far, [0, 0, 200, 400], registry)).toEqual([-100, -200, 3064, 200]);
  });

  it("works on a doc another client also edits", () => {
    const { doc, iso } = setup();
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    iso.session.dispatch({ ops: [{ op: "move", refs: ["top"], by: [0, 4] }] });
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const peer = createEditorSession({ doc: other, origin: bo, name: "posts", registry });
    expect(peer.getPrefabs().get("post")!.entities[0]!.at).toEqual([0, -36]);
  });
});
