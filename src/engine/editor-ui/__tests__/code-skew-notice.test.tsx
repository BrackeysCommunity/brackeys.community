// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  docToPrefab,
  memoryDocHost,
  prefabToDoc,
  projectBuildMap,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
} from "../../collab/index";
import type { SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import {
  createKindRegistry,
  prefabKind,
  sceneKind,
  type AssetEntry,
  type BuildStamp,
} from "../../project/index";
import { SCENE_FORMAT_VERSION, type Prefab } from "../../scene/index";
import { EditorFrame, editorChrome } from "../frame/EditorFrame";
import {
  editorIdentity,
  openLiveEditor,
  prefabsReady,
  type LiveEditor,
} from "../session/live-scene-editor";
import { useStoreValue } from "../session/use-store-value";
import { fakeWorldGame } from "./fake-world-game";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);

const registry = createRegistry();
const kinds = createKindRegistry(null, [sceneKind, prefabKind]);

const POST: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "post",
  entities: [{ id: "top", type: "marker", at: [0, -40] }],
};

const SCENE: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "posts",
  bounds: [0, 0, 2000, 1200],
  instances: [{ id: "post-1", prefab: "post", at: [100, 900] }],
};

/** A build later than this suite's, with another prefab schema. */
const NEWER: BuildStamp = { hash: "f".repeat(64), buildAt: 5_000, engine: "0.0.0" };

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
      build: { prefab: NEWER },
    },
    { kind: "migration" },
  );
  sceneToDoc(SCENE, { doc: host.doc("scene:p.posts"), key: sequentialKeys("t") });
  prefabToDoc(POST, { doc: host.doc("asset:p.post"), key: sequentialKeys("p") });
  return host;
}

type Host = ReturnType<typeof seed>;

async function join(host: Host, who: string, buildAt: number) {
  const identity = editorIdentity(who);
  const project = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: identity.origin,
    registry,
    kinds,
    buildAt,
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
    notify: toast,
    issuesDebounceMs: 0,
    project: { session: project, doc: "scene:p.posts" },
  });
  return { live, project, ...fake };
}

function Editor({
  live,
  game,
}: {
  live: LiveEditor;
  game: ReturnType<typeof fakeWorldGame>["game"];
}) {
  const open = useStoreValue(live.prefab, (p) => p, Object.is);
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
        notify: toast,
      }),
    [live, game, open],
  );
  return (
    <EditorFrame topLeft={null} {...chrome}>
      <canvas />
    </EditorFrame>
  );
}

const notice = () => screen.queryByRole("status", { name: "Read only" });
const opened = () => act(() => new Promise((r) => setTimeout(r, 0)));
const prefabAt = (host: Host) => docToPrefab(host.doc("asset:p.post")).entities[0]!.at;

afterEach(cleanup);

describe("code skew in the editor", () => {
  it("is read-only on docs of the kind a newer build changed and writable on the rest", async () => {
    const host = seed();
    const ada = await join(host, "Ada", 1_000);
    render(<Editor live={ada.live} game={ada.game} />);

    // The scene kind carried no stamp, so this build wrote its own and edits the scene.
    expect(notice()).toBeNull();
    expect(ada.project.state().build.scene?.buildAt).toBe(1_000);
    let moved = false;
    act(() => {
      moved = ada.live.session.dispatch({
        ops: [{ op: "move", refs: ["post-1"], by: [10, 0] }],
      }).ok;
    });
    expect(moved).toBe(true);

    // A scene batch that writes the prefab is refused before anything is written.
    let refused: { ok: boolean; issue?: { code: string } } = { ok: true };
    act(() => {
      refused = ada.live.session.dispatch({
        ops: [{ op: "definePrefab", id: "post", prefab: null }],
      });
    });
    expect(refused).toMatchObject({ ok: false, issue: { code: "code-skew" } });
    expect(ada.live.session.getPrefabs().has("post")).toBe(true);

    act(() => {
      ada.live.openPrefab("post", "post-1");
    });
    await opened();
    const shown = notice()!;
    expect(within(shown).getByText(/changed the prefab schema/)).toBeTruthy();
    expect(within(shown).getByRole("button", { name: "Reload" })).toBeTruthy();
    const inPrefab = ada.live.prefab.state!.isolation.session;
    let result: { ok: boolean; issue?: { code: string } } = { ok: true };
    act(() => {
      result = inPrefab.dispatch({ ops: [{ op: "move", refs: ["top"], by: [5, 0] }] });
    });
    expect(result).toMatchObject({ ok: false, issue: { code: "code-skew" } });
    expect(prefabAt(host)).toEqual([0, -40]);

    act(() => ada.live.closePrefab());
    expect(notice()).toBeNull();
    ada.live.destroy();
    ada.project.destroy();
  });

  it("follows the stamps live: the newest build wins, and an older one turns read-only", async () => {
    const host = seed();
    const ada = await join(host, "Ada", 1_000);
    render(<Editor live={ada.live} game={ada.game} />);
    act(() => {
      ada.live.openPrefab("post");
    });
    await opened();
    expect(notice()).not.toBeNull();

    // A build newer than the stamp, with Ada's schema, writes its stamp: Ada may edit the prefab again.
    const bob = await join(host, "Bob", 9_000);
    await opened();
    expect(bob.project.state().build.prefab).toMatchObject({ buildAt: 9_000 });
    expect(ada.project.state().build.prefab?.hash).toBe(ada.project.hashes.prefab);
    expect(notice()).toBeNull();
    const inPrefab = ada.live.prefab.state!.isolation.session;
    act(() => {
      inPrefab.dispatch({ ops: [{ op: "move", refs: ["top"], by: [5, 0] }] });
    });
    expect(prefabAt(host)).toEqual([5, -40]);

    // A still newer build changes the scene schema: Ada's scene turns read-only while she's in it.
    act(() => ada.live.closePrefab());
    expect(notice()).toBeNull();
    act(() => {
      projectBuildMap(host.doc("project:p")).set("scene", { ...NEWER, buildAt: 20_000 });
    });
    expect(within(notice()!).getByText(/changed the scene schema/)).toBeTruthy();
    let result: { ok: boolean } = { ok: true };
    act(() => {
      result = ada.live.session.dispatch({ ops: [{ op: "move", refs: ["post-1"], by: [1, 0] }] });
    });
    expect(result.ok).toBe(false);
    bob.live.destroy();
    bob.project.destroy();
    ada.live.destroy();
    ada.project.destroy();
  });
});
