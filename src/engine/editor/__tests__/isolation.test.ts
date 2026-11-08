import { describe, expect, it } from "vite-plus/test";

import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import { readLog } from "../../collab/log";
import { docToPrefab, prefabToDoc } from "../../collab/prefab-doc";
import { sessionPrefabSource } from "../../collab/prefab-source";
import { readProject, seedProjectDoc, writeEntry } from "../../collab/project-doc";
import { createProjectSession, memoryDocHost } from "../../collab/project-session";
import type { SceneOrigin } from "../../collab/types";
import { createRegistry } from "../../game/define";
import { createKindRegistry } from "../../project/kinds";
import { prefabKind } from "../../project/kinds/prefab";
import { sceneKind } from "../../project/kinds/scene";
import type { AssetEntry } from "../../project/types";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { isolationBounds, openPrefabIsolation } from "../isolation";
import { createEditorSession, projectHistory } from "../session";

const registry = createRegistry();
const kinds = createKindRegistry(null, [sceneKind, prefabKind]);
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

function seed() {
  const host = memoryDocHost();
  const entry = (key: string, kind: string, path: string): AssetEntry => ({
    key,
    id: key,
    kind,
    path,
    created: { at: 0, by: "seed" },
  });
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        posts: entry("posts", "scene", "posts.json"),
        post: entry("post", "prefab", "prefabs/post.json"),
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(scene(), { doc: host.doc("scene:p.posts"), key: sequentialKeys("t") });
  prefabToDoc(POST, { doc: host.doc("asset:p.post"), key: sequentialKeys("p") });
  return host;
}

/** A client of the project: its session, the scene's editor, and the prefab source behind it. */
async function client(host: ReturnType<typeof seed>, origin: SceneOrigin) {
  const project = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin,
    registry,
    kinds,
  });
  const prefabs = sessionPrefabSource(project, { scene: "posts" });
  await prefabs.ready();
  const { doc } = await project.open("scene:p.posts");
  const main = createEditorSession({
    doc,
    origin,
    name: "posts",
    registry,
    prefabs,
    history: projectHistory(project, "scene:p.posts"),
    issuesDebounceMs: 0,
  });
  return { project, prefabs, main };
}

async function setup() {
  const host = seed();
  const ours = await client(host, ada);
  const iso = (await openPrefabIsolation(ours.main, "post", {
    key: sequentialKeys("iso"),
    issuesDebounceMs: 0,
    user: { id: "ada", name: "Ada", color: "#f00" },
  }))!;
  return { host, ...ours, iso };
}

const childAt = (main: { getResolved(): SceneDefinition }, ref: string) =>
  main.getResolved().entities!.find((e) => e.id === ref)!.at;

describe("openPrefabIsolation", () => {
  it("is a session over the prefab's doc, at its local coordinates around its origin", async () => {
    const { host, project, iso } = await setup();
    expect(iso.session.doc).toBe(project.get("asset:p.post")!.doc);
    const def = iso.session.getDoc();
    expect(def.name).toBe("post");
    expect(def.entities).toEqual([{ id: "top", type: "marker", at: [0, -40] }]);
    expect(def.solid).toEqual([["box", 0, 0, 6, 40]]);
    expect(def.bounds).toEqual([-1000, -600, 1000, 600]);
    expect(iso.session.store.state.canUndo).toBe(false);
    expect(host.doc("asset:p.post").getMap("scene").size).toBe(0);
    project.destroy();
  });

  it("writes each batch to the prefab's doc alone, and every instance follows", async () => {
    const { host, project, main, iso } = await setup();
    let sceneTx = 0;
    let prefabTx = 0;
    main.doc.on("afterTransaction", () => sceneTx++);
    iso.session.doc.on("afterTransaction", () => prefabTx++);
    const result = iso.session.dispatch({ ops: [{ op: "move", refs: ["top"], by: [10, 0] }] });
    expect(result.ok).toBe(true);
    expect([sceneTx, prefabTx]).toEqual([0, 1]);
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([10, -40]);
    expect(main.getPrefabs().get("post")!.entities[0]!.at).toEqual([10, -40]);
    expect(childAt(main, "post-1/top")).toEqual([110, 860]);
    // post-2 overrides `top.at`, so it keeps its own.
    expect(childAt(main, "post-2/top")).toEqual([300, 840]);
    expect(readLog(host.doc("asset:p.post")).at(-1)!.label).toBe("Move top");
    expect(iso.session.store.state.canUndo).toBe(true);
    expect(iso.session.store.state.history.at(-1)!.label).toBe("Move top");
    project.destroy();
  });

  it("undoes through the project's one stack: its own edit, then the scene's before it", async () => {
    const { project, main, iso } = await setup();
    main.dispatch({ ops: [{ op: "move", refs: ["lamp"], by: [5, 5] }] });
    iso.session.dispatch({ ops: [{ op: "move", refs: ["top"], by: [10, 0] }] });
    expect(iso.session.undo()).toBe(true);
    expect(iso.session.getDoc().entities![0]!.at).toEqual([0, -40]);
    expect(childAt(main, "post-1/top")).toEqual([100, 860]);
    expect(main.getDoc().entities![0]!.at).toEqual([55, 55]);
    expect(iso.session.undo()).toBe(true);
    expect(main.getDoc().entities![0]!.at).toEqual([50, 50]);
    expect(iso.session.redo()).toBe(true);
    expect(iso.session.redo()).toBe(true);
    expect(iso.session.getDoc().entities![0]!.at).toEqual([10, -40]);
    iso.close();
    // Back in the scene, its undo covers the prefab's edit.
    expect(main.undo()).toBe(true);
    expect(main.getPrefabs().get("post")!.entities[0]!.at).toEqual([0, -40]);
    project.destroy();
  });

  it("refuses scene-only ops, and grouped children, with op-invalid, leaving both docs as they were", async () => {
    const { project, main, iso } = await setup();
    const before = main.getHash();
    for (const ops of [
      [{ op: "setScene", set: { name: "other" } }],
      [{ op: "setSettings", set: { gravity: 1 } }],
      [{ op: "instantiate", instance: { prefab: "post", at: [0, 0] } }],
      [{ op: "definePrefab", id: "post", prefab: null }],
      [{ op: "add", entity: { id: "x", type: "marker", at: [0, 0], group: "walls" } }],
    ] as const) {
      const refused = iso.session.dispatch({ ops: [...ops] as never });
      expect(refused.ok || refused.issue.code, JSON.stringify(ops)).toBe("op-invalid");
    }
    expect(main.getHash()).toBe(before);
    expect(iso.session.getDoc().name).toBe("post");
    expect(main.getPrefabs().get("post")).toEqual(POST);
    expect(iso.session.getDoc().entities!.map((e) => e.id)).toEqual(["top"]);
    project.destroy();
  });

  it("follows the prefab when another client edits it, and closes when it's deleted", async () => {
    const { host, project, iso } = await setup();
    const theirs = await client(host, bo);
    let gone = 0;
    iso.close();
    const live = (await openPrefabIsolation(iso.scene, "post", { onGone: () => gone++ }))!;
    const peer = (await openPrefabIsolation(theirs.main, "post"))!;
    peer.session.dispatch({ ops: [{ op: "move", refs: ["top"], by: [0, -40] }] });
    expect(live.session.getDoc().entities).toEqual([{ id: "top", type: "marker", at: [0, -80] }]);
    expect(childAt(iso.scene, "post-1/top")).toEqual([100, 820]);

    const registry = theirs.project.projectDoc;
    registry.transact(
      () =>
        writeEntry(registry, {
          ...readProject(registry).assets.post!,
          deleted: { at: 1, by: "bo" },
        }),
      bo,
    );
    expect(gone).toBe(1);
    expect(live.session.dispatch({ ops: [{ op: "move", refs: ["top"], by: [1, 0] }] }).ok).toBe(
      false,
    );
    theirs.project.destroy();
    project.destroy();
  });

  it("shares presence in the prefab's doc with others editing it", async () => {
    const { host, project, iso } = await setup();
    const theirs = await client(host, bo);
    const peer = (await openPrefabIsolation(theirs.main, "post", {
      user: { id: "bo", name: "Bo", color: "#00f" },
    }))!;
    iso.session.select(["top"]);
    expect(peer.session.store.state.peers.map((p) => [p.user.name, p.selection])).toEqual([
      ["Ada", [peer.session.keyOf("top")]],
    ]);
    theirs.project.destroy();
    project.destroy();
  });

  it("is null for a prefab the project doesn't hold", async () => {
    const { project, main } = await setup();
    expect(await openPrefabIsolation(main, "nope")).toBeNull();
    project.destroy();
  });

  it("grows the bounds to hold children far from the origin", () => {
    const far: Prefab = { ...POST, entities: [{ id: "top", type: "marker", at: [3000, 0] }] };
    expect(isolationBounds(far, [0, 0, 200, 400], registry)).toEqual([-100, -200, 3064, 200]);
  });
});
