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
import { createEditorSession, projectHistory, type SceneDefinition } from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import { createKindRegistry, prefabKind, sceneKind, type AssetEntry } from "@jams/engine/project";
import type { Prefab } from "@jams/engine/scene";
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
