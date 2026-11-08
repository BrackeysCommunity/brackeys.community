// @vitest-environment jsdom
import {
  createProjectSession,
  memoryDocHost,
  prefabToDoc,
  readLog,
  sceneToDoc,
  seedProjectDoc,
  projectPeersByDoc,
  sequentialKeys,
} from "@jams/engine/collab";
import type { SceneDefinition } from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import { createKindRegistry, prefabKind, sceneKind, type AssetEntry } from "@jams/engine/project";
import type { Prefab } from "@jams/engine/scene";
import { useStore } from "@tanstack/react-store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CanvasShell } from "@/components/canvas/shell/CanvasShell";
import { editorChrome } from "@/components/game/editor/EditorShell";
import {
  editorIdentity,
  openLiveEditor,
  prefabsReady,
  type LiveEditor,
} from "@/components/game/live-scene-editor";

import { fakeWorldGame } from "./fake-world-game";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);
vi.mock("@/lib/toast", () => ({ toast }));

const registry = createRegistry();

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
      { id: "post-1", prefab: "post", at: [100, 900] },
      { id: "post-2", prefab: "post", at: [300, 900] },
      { id: "post-3", prefab: "post", at: [100, 900], group: "east" },
    ],
  };
}

type Fake = ReturnType<typeof fakeWorldGame>;

/** The chrome as `useSceneEditor` builds it: on the scene, or on the prefab open in isolation. */
function Editor({ live, game }: { live: LiveEditor; game: Fake["game"] }) {
  const open = useStore(live.prefab);
  const chrome = useMemo(
    () =>
      editorChrome({
        ...live.editing(open),
        host: live.host,
        game,
        onPlay: live.play,
        onReplay: live.replay,
        onStop: live.stop,
        onRestart: live.restart,
      }),
    [live, game, open],
  );
  return (
    <CanvasShell topLeft={null} {...chrome}>
      <canvas />
    </CanvasShell>
  );
}

/** The scene and its prefab as a project holds them. */
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

type Host = ReturnType<typeof seed>;

/** Someone in the project with the scene open in the live editor, as `useSceneEditor` opens it. */
async function join(host: Host, who: string) {
  const identity = editorIdentity(who);
  const project = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: identity.origin,
    registry,
    kinds: createKindRegistry(null, [sceneKind, prefabKind]),
  });
  await prefabsReady(project);
  const scene = await project.open("scene:p.posts");
  const fake = fakeWorldGame(registry);
  const live = openLiveEditor({
    game: fake.game,
    doc: scene.doc,
    awareness: scene.awareness,
    name: "posts",
    identity,
    issuesDebounceMs: 0,
    project: { session: project, doc: "scene:p.posts" },
  });
  return { doc: scene.doc, prefabDoc: project.get("asset:p.post")!.doc, live, project, ...fake };
}

/** Ada's editor on screen, edited through her project session. */
async function setup(host = seed()) {
  const ada = await join(host, "Ada");
  render(<Editor live={ada.live} game={ada.game} />);
  return { ...ada, host };
}

/** Lets an isolation's doc open. */
const opened = () => act(() => new Promise((r) => setTimeout(r, 0)));

const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
const inspector = () => within(screen.getByLabelText("Inspector"));
const worldAt = (fake: Fake, id: string) => fake.world()!.entities.find((e) => e.id === id)?.at;
const topOf = (live: LiveEditor, instance: string) =>
  live.session.getResolved().entities!.find((e) => e.id === `${instance}/top`)!.at;

/** Edits the selected entity's `at.x` in the inspector. */
function setX(x: number) {
  const field = inspector().getByLabelText("at.x") as HTMLInputElement;
  fireEvent.change(field, { target: { value: String(x) } });
  fireEvent.keyDown(field, { key: "Enter" });
}

beforeEach(() => {
  toast.mockReset();
  for (const fn of [toast.error, toast.warning, toast.success]) fn.mockReset();
});
afterEach(cleanup);

describe("Open prefab", () => {
  it("opens from the inspector, edits the prefab's doc, every instance follows, then Back", async () => {
    const fake = await setup();
    const { doc, prefabDoc, live, game } = fake;
    act(() => live.session.select(["post-1"]));
    fireEvent.click(inspector().getByRole("button", { name: "Open prefab" }));
    await opened();

    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("posts›post");
    // The edit world holds the prefab alone, at its local coordinates.
    expect(worldAt(fake, "top")).toEqual([0, -40]);
    expect(worldAt(fake, "post-1/top")).toBeUndefined();
    expect(game.frame).toHaveBeenCalled();

    fireEvent.click(outliner().getByRole("button", { name: /^top/ }));
    let transactions = 0;
    let prefabTransactions = 0;
    doc.on("afterTransaction", () => transactions++);
    prefabDoc.on("afterTransaction", () => prefabTransactions++);
    act(() => setX(10));

    expect([transactions, prefabTransactions]).toEqual([0, 1]);
    expect(readLog(prefabDoc).at(-1)!.label).toBe("Set Position");
    expect(worldAt(fake, "top")).toEqual([10, -40]);
    expect(topOf(live, "post-1")).toEqual([110, 860]);
    expect(topOf(live, "post-2")).toEqual([310, 860]);
    expect(topOf(live, "post-3")).toEqual([1110, 860]);

    // Undo here steps the project's one stack: the prefab and every instance go back.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(worldAt(fake, "top")).toEqual([0, -40]);
    expect(topOf(live, "post-2")).toEqual([300, 860]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    });
    expect(topOf(live, "post-2")).toEqual([310, 860]);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(worldAt(fake, "post-1/top")).toEqual([110, 860]);
    expect(worldAt(fake, "post-3/top")).toEqual([1110, 860]);
    expect(worldAt(fake, "top")).toBeUndefined();
    expect(outliner().getAllByText("prefab").length).toBe(3);
    // Back in the scene, its undo still covers the edit.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(topOf(live, "post-1")).toEqual([100, 860]);
    fake.project.destroy();
  });

  it("opens from an instance row in the outliner", async () => {
    const fake = await setup();
    fireEvent.click(outliner().getAllByRole("button", { name: "Open prefab post" })[0]!);
    await opened();
    expect(fake.live.prefab.state?.isolation.prefab).toBe("post");
    expect(worldAt(fake, "top")).toEqual([0, -40]);
    fake.project.destroy();
  });

  it("offers no Create prefab inside a prefab", async () => {
    const fake = await setup();
    act(() => {
      fake.live.openPrefab("post", "post-1");
    });
    await opened();
    fireEvent.click(outliner().getByRole("button", { name: /^top/ }));
    expect(inspector().queryByRole("button", { name: "Create prefab" })).toBeNull();
    fake.project.destroy();
  });

  it("refuses a prefab the project doesn't hold, with a toast", async () => {
    const fake = await setup();
    let result = true;
    act(() => {
      result = fake.live.openPrefab("nope");
    });
    expect(result).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("No prefab nope in this scene");
    fake.project.destroy();
  });

  it("goes back to the scene when the prefab is deleted, and when Play starts", async () => {
    const fake = await setup();
    const { live, game } = fake;
    act(() => {
      live.openPrefab("post");
    });
    await opened();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
    });
    expect(live.prefab.state).toBeNull();
    expect(game.getMode()).toBe("play");
    act(() => live.stop());
    expect(worldAt(fake, "post-1/top")).toEqual([100, 860]);

    act(() => {
      live.openPrefab("post");
    });
    await opened();
    expect(live.prefab.state?.isolation.prefab).toBe("post");
    act(() => {
      live.session.dispatch({ ops: [{ op: "definePrefab", id: "post", prefab: null }] });
    });
    expect(live.prefab.state).toBeNull();
    expect(toast).toHaveBeenCalledWith("The prefab was deleted", expect.anything());
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    fake.project.destroy();
  });
});

describe("the prefab's doc in the project", () => {
  it("names the doc an undo stepped in when it isn't on screen", async () => {
    const fake = await setup();
    const { live } = fake;
    act(() => {
      live.openPrefab("post", "post-1");
    });
    await opened();
    const prefab = live.prefab.state!.isolation.session;
    act(() => {
      prefab.dispatch({ ops: [{ op: "move", refs: ["top"], by: [5, 0] }] });
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(toast).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(toast).toHaveBeenCalledWith("Undid Move top in post");
    expect(topOf(live, "post-2")).toEqual([300, 860]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    });
    expect(toast).toHaveBeenLastCalledWith("Redid Move top in post");
    expect(topOf(live, "post-2")).toEqual([305, 860]);
    fake.project.destroy();
  });

  it("publishes which doc this client is in", async () => {
    const host = seed();
    const fake = await setup(host);
    const bob = await join(host, "Bob");
    const adaInProject = () => bob.live.projectPeers.state.find((p) => p.user.name === "Ada");
    expect(adaInProject()).toMatchObject({ doc: "scene:p.posts", mode: "edit" });

    act(() => {
      fake.live.openPrefab("post");
    });
    await opened();
    expect(adaInProject()?.doc).toBe("asset:p.post");
    act(() => fake.live.play());
    expect(adaInProject()).toMatchObject({ doc: "scene:p.posts", mode: "play" });
    act(() => fake.live.stop());
    expect(adaInProject()?.mode).toBe("edit");
    fake.live.destroy();
    expect(adaInProject()?.doc).toBeNull();
    bob.live.destroy();
    bob.project.destroy();
    fake.project.destroy();
  });

  it("shows a collaborator inside the prefab, in the prefab and in the tree's data", async () => {
    const host = seed();
    const fake = await setup(host);
    const bob = await join(host, "Bob");
    act(() => {
      bob.live.openPrefab("post");
    });
    await opened();
    const bobInPrefab = bob.live.prefab.state!.isolation.session;
    act(() => bobInPrefab.select(["top"]));

    const byDoc = projectPeersByDoc(fake.live.projectPeers.state);
    expect(byDoc.get("asset:p.post")?.map((p) => p.user.name)).toEqual(["Bob"]);
    expect(byDoc.get("scene:p.posts")).toBeUndefined();
    // In the scene, Bob isn't here.
    expect(fake.live.session.store.state.peers.map((p) => p.user.name)).not.toContain("Bob");

    act(() => {
      fake.live.openPrefab("post");
    });
    await opened();
    const peers = fake.live.prefab.state!.isolation.session.store.state.peers;
    expect(peers.find((p) => p.user.name === "Bob")?.selection).toEqual([bobInPrefab.keyOf("top")]);
    expect(screen.getByText("1 other here")).toBeTruthy();
    bob.live.destroy();
    bob.project.destroy();
    fake.project.destroy();
  });
});
