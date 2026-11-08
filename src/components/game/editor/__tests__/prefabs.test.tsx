// @vitest-environment jsdom
import {
  createProjectSession,
  docToPrefab,
  memoryDocHost,
  prefabToDoc,
  readLog,
  readProject,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  sessionPrefabSource,
  type SceneOrigin,
} from "@jams/engine/collab";
import {
  applyLevels,
  applyToPrefabBatch,
  createEditorSession,
  createPrefabBatch,
  instancesOf,
  nestedInstanceOf,
  overridePathsOf,
  projectHistory,
  revertAllBatch,
  type SceneDefinition,
} from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import { createKindRegistry, prefabKind, sceneKind, type AssetEntry } from "@jams/engine/project";
import { SCENE_FORMAT_VERSION, type Prefab, type PrefabLibrary } from "@jams/engine/scene";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { EditorInspector } from "@/components/game/editor/EditorInspector";
import { EditorOutliner } from "@/components/game/editor/EditorOutliner";
import { editorIdentity, openLiveEditor, prefabsReady } from "@/components/game/live-scene-editor";

import { fakeWorldGame } from "./fake-world-game";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const POST: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "post",
  entities: [{ id: "top", type: "marker", at: [0, -40] }],
  bulk: { solid: [["box", 0, 0, 6, 40]] },
};

function scene(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "posts",
    bounds: [0, 0, 2000, 1200],
    groups: { east: { at: [1000, 0] } },
    instances: [
      { id: "post-1", prefab: "post", at: [100, 900], overrides: { "top.at": [0, -60] } },
      { id: "post-2", prefab: "post", at: [300, 900] },
      { id: "post-3", prefab: "post", at: [100, 900], group: "east" },
    ],
  };
}

/** The scene and its prefab as a project holds them: a doc each, edited through one project session. */
async function setup(selection: string[]) {
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
  const project = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: ada,
    registry,
    kinds: createKindRegistry(null, [sceneKind, prefabKind]),
  });
  const prefabs = sessionPrefabSource(project, { scene: "posts" });
  await prefabs.ready();
  const { doc } = await project.open("scene:p.posts");
  const session = createEditorSession({
    doc,
    origin: ada,
    name: "posts",
    registry,
    issuesDebounceMs: 0,
    prefabs,
    history: projectHistory(project, "scene:p.posts"),
  });
  session.select(selection);
  return { session, doc, host, project };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const topOf = (session: Setup["session"], instance: string) =>
  session.getResolved().entities!.find((e) => e.id === `${instance}/top`)!.at;
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

afterEach(cleanup);

describe("prefabs in the editor", () => {
  it("Apply to prefab updates every instance, one transaction per doc, after a Confirm that counts them", async () => {
    const { session, doc, host, project } = await setup(["post-1"]);
    render(<EditorInspector session={session} />);
    expect(screen.getByText("top.at")).toBeTruthy();
    let transactions = 0;
    let prefabTransactions = 0;
    doc.on("afterTransaction", () => transactions++);
    project.get("asset:p.post")!.doc.on("afterTransaction", () => prefabTransactions++);

    fireEvent.click(screen.getByRole("button", { name: "Apply to prefab" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/all 3 of its instances change/)).toBeTruthy();
    act(() => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    });

    expect([transactions, prefabTransactions]).toEqual([1, 1]);
    expect(session.getPrefabs().get("post")!.entities[0]!.at).toEqual([0, -60]);
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([0, -60]);
    expect(topOf(session, "post-1")).toEqual([100, 840]);
    expect(topOf(session, "post-2")).toEqual([300, 840]);
    expect(topOf(session, "post-3")).toEqual([1100, 840]);
    expect(session.getDoc().instances![0]!.overrides).toBeUndefined();
    expect(readLog(doc).at(-1)!.label).toBe("Apply post-1 to post");
    expect(session.undo()).toBe(true);
    expect(topOf(session, "post-2")).toEqual([300, 860]);
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([0, -40]);
    project.destroy();
  });

  it("edits an instance child through the resolved view as an override, bold with a Revert", async () => {
    const { session, project } = await setup(["post-2/top"]);
    render(<EditorInspector session={session} />);
    const x = screen.getByLabelText("at.x") as HTMLInputElement;
    expect(x.value).toBe("300");
    fireEvent.change(x, { target: { value: "320" } });
    fireEvent.keyDown(x, { key: "Enter" });
    expect(session.getDoc().instances![1]!.overrides).toEqual({ "top.at": [20, -40] });
    expect(topOf(session, "post-2")).toEqual([320, 860]);
    const revert = screen.getByRole("button", { name: "Revert" });
    fireEvent.click(revert);
    expect(session.getDoc().instances![1]!.overrides).toBeUndefined();
    project.destroy();
  });

  it("unpacks an instance into plain entries where they stood", async () => {
    const { session, project } = await setup(["post-3"]);
    render(<EditorInspector session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpack" }));
    const def = session.getDoc();
    expect(def.instances!.map((i) => i.id)).toEqual(["post-1", "post-2"]);
    expect(def.entities).toEqual([{ id: "top", type: "marker", group: "east", at: [100, 860] }]);
    expect(def.solid).toEqual([["box", 1100, 900, 6, 40]]);
    project.destroy();
  });

  it("creates a prefab asset from a selection of entities", async () => {
    const { session, host, project } = await setup([]);
    session.dispatch({
      ops: [{ op: "add", entity: { id: "lamp", type: "marker", at: [500, 500] } }],
    });
    session.select(["lamp"]);
    render(<EditorInspector session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Create prefab" }));
    expect(session.getPrefabs().get("lamp")!.entities).toEqual([
      { id: "lamp", type: "marker", at: [0, 0] },
    ]);
    expect(session.getDoc().instances!.at(-1)).toEqual({
      id: "lamp-1",
      prefab: "lamp",
      at: [500, 500],
    });
    await flush();
    const lamp = Object.values(readProject(host.doc("project:p")).assets).find(
      (e) => e.id === "lamp",
    )!;
    expect(lamp.path).toBe("prefabs/lamp.json");
    expect(docToPrefab(host.doc(`asset:p.${lamp.key}`)).entities).toEqual([
      { id: "lamp", type: "marker", at: [0, 0] },
    ]);
    project.destroy();
  });

  it("lists instances with a prefab badge and their children in the outliner", async () => {
    const { session, project } = await setup([]);
    render(<EditorOutliner session={session} />);
    expect(screen.getAllByText("prefab").length).toBe(3);
    expect(screen.getAllByText("top").length).toBeGreaterThanOrEqual(3);
    project.destroy();
  });
});

describe("prefabs in the project editor", () => {
  it("edits the project's prefab docs through the live editor, one undo step across both docs", async () => {
    const { host, project } = await setup([]);
    await prefabsReady(project);
    const scene = project.get("scene:p.posts")!;
    const identity = { ...editorIdentity("Ada"), origin: ada };
    const live = openLiveEditor({
      game: fakeWorldGame(registry).game,
      doc: scene.doc,
      awareness: scene.awareness,
      name: "posts",
      identity,
      issuesDebounceMs: 0,
      project: { session: project, doc: "scene:p.posts" },
    });
    act(() => live.session.select(["post-1"]));
    render(<EditorInspector session={live.session} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply to prefab" }));
    act(() => {
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Apply" }),
      );
    });
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([0, -60]);
    expect(project.undoLabel()).toBe("Apply post-1 to post");
    act(() => {
      live.session.undo();
    });
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([0, -40]);
    expect(live.session.getDoc().instances![0]!.overrides).toEqual({ "top.at": [0, -60] });
    live.destroy();
    project.destroy();
  });
});

const LOCK: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "lock",
  entities: [{ id: "bolt", type: "marker", at: [0, 0] }],
};
const DOOR: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "door",
  entities: [{ id: "panel", type: "marker", at: [0, -10] }],
  instances: [{ id: "lock-1", prefab: "lock", at: [4, 0] }],
};
const ROOM: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "room",
  entities: [{ id: "floor", type: "marker", at: [0, 0] }],
  instances: [{ id: "door-1", prefab: "door", at: [100, 0] }],
};
const NESTED: PrefabLibrary = new Map([LOCK, DOOR, ROOM].map((p) => [p.id, p]));

function rooms(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "rooms",
    bounds: [0, 0, 2000, 1200],
    instances: [
      {
        id: "room-1",
        prefab: "room",
        at: [500, 500],
        overrides: {
          "floor.at": [0, 5],
          "door-1/panel.at": [0, -20],
          "door-1/lock-1/bolt.at": [1, 1],
        },
      },
      { id: "room-2", prefab: "room", at: [900, 500] },
    ],
  };
}

/** A project holding `rooms` and its three nested prefabs, edited through one project session. */
async function setupNested(selection: string[]) {
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
        rooms: entry("rooms", "scene", "rooms.json"),
        ...Object.fromEntries(
          [...NESTED.keys()].map((id) => [id, entry(id, "prefab", `prefabs/${id}.json`)]),
        ),
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(rooms(), { doc: host.doc("scene:p.rooms"), key: sequentialKeys("t") });
  for (const p of NESTED.values())
    prefabToDoc(p, { doc: host.doc(`asset:p.${p.id}`), key: sequentialKeys(p.id) });
  const project = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: ada,
    registry,
    kinds: createKindRegistry(null, [sceneKind, prefabKind]),
  });
  const prefabs = sessionPrefabSource(project, { scene: "rooms" });
  await prefabs.ready();
  const { doc } = await project.open("scene:p.rooms");
  const session = createEditorSession({
    doc,
    origin: ada,
    name: "rooms",
    registry,
    issuesDebounceMs: 0,
    prefabs,
    history: projectHistory(project, "scene:p.rooms"),
  });
  session.select(selection);
  return { session, doc, host, project };
}

describe("prefab commands over nested prefabs", () => {
  const def = rooms();

  it("finds a nested instance by its resolved ref, and the override keys each ref covers", () => {
    expect(nestedInstanceOf(def, "room-1/door-1", NESTED)).toMatchObject({
      instance: { id: "door-1", prefab: "door" },
      holder: "room",
      path: "door-1",
    });
    expect(nestedInstanceOf(def, "room-1/door-1/lock-1", NESTED)).toMatchObject({
      instance: { id: "lock-1" },
      holder: "door",
    });
    expect(nestedInstanceOf(def, "room-1/floor", NESTED)).toBeNull();
    expect(nestedInstanceOf(def, "room-1", NESTED)).toBeNull();
    expect(overridePathsOf(def, "room-1")).toHaveLength(3);
    expect(overridePathsOf(def, "room-1/door-1")).toEqual([
      "door-1/panel.at",
      "door-1/lock-1/bolt.at",
    ]);
    expect(overridePathsOf(def, "room-1/door-1/panel")).toEqual(["door-1/panel.at"]);
  });

  it("offers the levels every covered key reaches, outermost first", () => {
    expect(applyLevels(def, "room-1", NESTED)).toEqual(["room"]);
    expect(applyLevels(def, "room-1/door-1", NESTED)).toEqual(["room", "door"]);
    expect(applyLevels(def, "room-1/door-1/lock-1", NESTED)).toEqual(["room", "door", "lock"]);
    expect(applyLevels(def, "room-1/door-1/lock-1/bolt", NESTED)).toEqual(["room", "door", "lock"]);
    expect(applyLevels(def, "room-2", NESTED)).toEqual([]);
  });

  it("applies a nested child's keys to the level `to` names, and refuses one they don't reach", () => {
    expect(applyToPrefabBatch(def, "room-1/door-1", { to: "door", prefabs: NESTED })).toEqual({
      label: "Apply room-1/door-1 to door",
      ops: [
        {
          op: "applyToPrefab",
          ref: "room-1",
          paths: ["door-1/panel.at", "door-1/lock-1/bolt.at"],
          to: "door",
        },
      ],
    });
    expect(applyToPrefabBatch(def, "room-1/door-1", { to: "room", prefabs: NESTED })).toEqual({
      label: "Apply room-1/door-1 to room",
      ops: [
        {
          op: "applyToPrefab",
          ref: "room-1",
          paths: ["door-1/panel.at", "door-1/lock-1/bolt.at"],
        },
      ],
    });
    expect(applyToPrefabBatch(def, "room-1", { to: "door", prefabs: NESTED })).toBeNull();
    expect(applyToPrefabBatch(def, "room-1/door-1", { to: "door" })).toBeNull();
    expect(applyToPrefabBatch(def, "room-1")).toEqual({
      label: "Apply room-1 to room",
      ops: [{ op: "applyToPrefab", ref: "room-1" }],
    });
  });

  it("reverts only the keys a nested ref covers", () => {
    expect(revertAllBatch(def, "room-1/door-1")).toEqual({
      label: "Revert all of room-1/door-1",
      ops: [
        {
          op: "revertOverride",
          ref: "room-1",
          paths: ["door-1/panel.at", "door-1/lock-1/bolt.at"],
        },
      ],
    });
    expect(revertAllBatch(def, "room-1/door-1/panel")!.ops).toEqual([
      { op: "revertOverride", ref: "room-1", paths: ["door-1/panel.at"] },
    ]);
    expect(revertAllBatch(def, "room-1/floor")!.ops).toEqual([
      { op: "revertOverride", ref: "room-1", paths: ["floor.at"] },
    ]);
    expect(revertAllBatch(def, "room-2")).toBeNull();
  });

  it("counts placements through nesting, and lets Create prefab take instances", () => {
    expect(instancesOf(def, "room")).toBe(2);
    expect(instancesOf(def, "door")).toBe(0);
    expect(instancesOf(def, "door", NESTED)).toBe(2);
    expect(instancesOf(def, "lock", NESTED)).toBe(2);
    expect(createPrefabBatch(def, ["room-1", "room-2"], NESTED)!.ops).toEqual([
      { op: "createPrefab", refs: ["room-1", "room-2"], id: "room-2" },
    ]);
    expect(createPrefabBatch(def, ["room-1/floor"], NESTED)).toBeNull();
  });
});

describe("nested prefabs in the editor", () => {
  it("applies a nested instance's overrides to the level picked, one undo step", async () => {
    const { session, doc, host, project } = await setupNested(["room-1/door-1"]);
    render(<EditorInspector session={session} />);
    expect(screen.getByText("instance of door in room")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unpack" })).toBeNull();
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);

    fireEvent.click(screen.getByRole("button", { name: "door" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to prefab" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Apply to door?")).toBeTruthy();
    expect(within(dialog).getByText(/all 2 of its instances change/)).toBeTruthy();
    act(() => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    });

    expect(transactions).toBe(1);
    const door = docToPrefab(host.doc("asset:p.door"));
    expect(door.entities[0]!.at).toEqual([0, -20]);
    expect(door.instances![0]!.overrides).toEqual({ "bolt.at": [1, 1] });
    expect(docToPrefab(host.doc("asset:p.room")).instances![0]!.overrides).toBeUndefined();
    expect(session.getDoc().instances![0]!.overrides).toEqual({ "floor.at": [0, 5] });
    expect(readLog(doc).at(-1)!.label).toBe("Apply room-1/door-1 to door");
    const panel = (id: string) =>
      session.getResolved().entities!.find((e) => e.id === `${id}/door-1/panel`)!.at;
    expect(panel("room-2")).toEqual([1000, 480]);
    expect(session.undo()).toBe(true);
    expect(panel("room-2")).toEqual([1000, 490]);
    expect(docToPrefab(host.doc("asset:p.door")).entities[0]!.at).toEqual([0, -10]);
    project.destroy();
  });

  it("applies to the instance's own prefab by default, as an override of the nested instance", async () => {
    const { session, host, project } = await setupNested(["room-1/door-1"]);
    render(<EditorInspector session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Apply to prefab" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Apply to room?")).toBeTruthy();
    act(() => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    });
    expect(docToPrefab(host.doc("asset:p.room")).instances![0]!.overrides).toEqual({
      "panel.at": [0, -20],
      "lock-1/bolt.at": [1, 1],
    });
    expect(docToPrefab(host.doc("asset:p.door")).entities[0]!.at).toEqual([0, -10]);
    project.destroy();
  });

  it("offers no level choice when the keys reach only the instance's own prefab", async () => {
    const { session, project } = await setupNested(["room-1"]);
    render(<EditorInspector session={session} />);
    expect(screen.queryByRole("group", { name: "Apply to" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unpack" })).toBeTruthy();
    project.destroy();
  });

  it("Revert all on a nested instance drops only its keys", async () => {
    const { session, project } = await setupNested(["room-1/door-1"]);
    render(<EditorInspector session={session} />);
    expect(screen.getByText("door-1/panel.at")).toBeTruthy();
    expect(screen.queryByText("floor.at")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revert all" }));
    expect(session.getDoc().instances![0]!.overrides).toEqual({ "floor.at": [0, 5] });
    project.destroy();
  });

  it("edits a nested child through the resolved view as an override with its a/b/c key", async () => {
    const { session, project } = await setupNested(["room-2/door-1/panel"]);
    render(<EditorInspector session={session} />);
    const x = screen.getByLabelText("at.x") as HTMLInputElement;
    expect(x.value).toBe("1000");
    fireEvent.change(x, { target: { value: "1010" } });
    fireEvent.keyDown(x, { key: "Enter" });
    expect(session.getDoc().instances![1]!.overrides).toEqual({ "door-1/panel.at": [10, -10] });
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(session.getDoc().instances![1]!.overrides).toBeUndefined();
    project.destroy();
  });

  it("lists nested instances and their children under their instance in the outliner", async () => {
    const { session, project } = await setupNested([]);
    render(<EditorOutliner session={session} />);
    expect(screen.getAllByText("door-1").length).toBe(2);
    expect(screen.getAllByText("lock-1").length).toBe(2);
    expect(screen.getAllByText("bolt").length).toBe(2);
    project.destroy();
  });
});
