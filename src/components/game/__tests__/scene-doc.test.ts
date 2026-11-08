import { readFileSync } from "node:fs";

import {
  applyOpsToDoc,
  createProjectSession,
  docToScene,
  memoryDocHost,
  readLog,
  revertEntry,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  watchIssues,
  writeEntry,
  type ProjectSession,
} from "@jams/engine/collab";
import { createRegistry } from "@jams/engine/game";
import {
  createKindRegistry,
  prefabKind,
  projectView,
  SCENE_KIND_NAME,
  sceneKind,
  type AssetEntry,
} from "@jams/engine/project";
import { SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import * as engineVite from "@jams/engine/vite";
import { describe, expect, it } from "vite-plus/test";

import {
  DEV_PROJECT_ROUTE,
  SCENE_COLLAB_PATH,
  SCENE_KIND,
  SCENE_PROJECT,
  sceneCollabUrl,
} from "../scene-collab";
import type { ProjectSessionState } from "../use-project-session";
import { createSceneDocLink, pickScene, type SceneDocSource } from "../use-scene-doc";

describe("scene collab constants", () => {
  it("match the engine's dev server and project model", () => {
    expect(SCENE_COLLAB_PATH).toBe(engineVite.SCENE_COLLAB_PATH);
    expect(DEV_PROJECT_ROUTE).toBe(engineVite.PROJECT_ROUTE);
    expect(SCENE_KIND).toBe(SCENE_KIND_NAME);
    const platformer = new URL("../../../games/platformer/jams.project.json", import.meta.url);
    expect(SCENE_PROJECT).toBe(JSON.parse(readFileSync(platformer, "utf8")).id);
  });

  it("build the websocket URL from the page's origin", () => {
    expect(sceneCollabUrl({ protocol: "http:", host: "localhost:3000" })).toBe(
      "ws://localhost:3000/__scene-collab",
    );
    expect(sceneCollabUrl({ protocol: "https:", host: "dev.test" })).toBe(
      "wss://dev.test/__scene-collab",
    );
  });
});

const registry = createRegistry();
const kinds = createKindRegistry(null, [sceneKind, prefabKind]);

const entry = (key: string, kind: string, path: string, id = key): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created: { at: 0, by: "seed" },
});

/** A project with two scenes, `b-yard` keyed apart from its id, served from memory. */
function project(assets: AssetEntry[] = []) {
  const host = memoryDocHost();
  const all = assets.length
    ? assets
    : [entry("yard", "scene", "scenes/yard.json"), entry("k2", "scene", "a/b-yard.json", "b-yard")];
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: Object.fromEntries(all.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  for (const e of all) {
    if (e.kind !== "scene") continue;
    sceneToDoc(
      { v: SCENE_FORMAT_VERSION, name: e.id, bounds: [0, 0, 100, 100] },
      { doc: host.doc(`scene:p.${e.key}`), key: sequentialKeys(e.key) },
    );
  }
  const client = host.client();
  const open = () =>
    createProjectSession({
      project: "p",
      openDoc: client.openDoc,
      origin: { kind: "user", userId: "u", name: "U" },
      registry,
      kinds,
    });
  return { host, client, open };
}

/** A project session link's state, set by hand. */
function fakeSource() {
  const listeners = new Set<() => void>();
  let state: ProjectSessionState = {
    status: "connecting",
    session: null,
    access: "write",
    stopped: {},
    error: null,
  };
  const source: SceneDocSource = {
    getState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const set = (patch: Partial<ProjectSessionState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };
  return { source, set };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("pickScene", () => {
  it("takes the scene of that id, else the first scene by path", async () => {
    const { open } = project();
    const session = await open();
    const view = projectView(session.state(), kinds);
    expect(pickScene(view, "yard")?.key).toBe("yard");
    expect(pickScene(view, "b-yard")?.key).toBe("k2");
    expect(pickScene(view, "nope")?.key).toBe("k2");
    expect(pickScene(view, null)?.key).toBe("k2");
    session.destroy();
  });

  it("skips what isn't a scene", async () => {
    const { open } = project([
      entry("post", "prefab", "a/post.json"),
      entry("yard", "scene", "b/yard.json"),
    ]);
    const session = await open();
    const view = projectView(session.state(), kinds);
    expect(pickScene(view, "post")?.key).toBe("yard");
    session.destroy();
  });
});

describe("createSceneDocLink", () => {
  it("opens the scene from the project once the session is up", async () => {
    const { open, client } = project();
    const { source, set } = fakeSource();
    const link = createSceneDocLink({ source, scene: "b-yard" });
    expect(link.getState()).toMatchObject({ status: "connecting", ready: null });

    const session = await open();
    set({ status: "live", session });
    expect(link.getState().status).toBe("connecting");
    await settle();
    const ready = link.getState().ready!;
    expect(link.getState().status).toBe("live");
    expect(ready).toMatchObject({ session, name: "scene:p.k2", id: "b-yard" });
    expect(ready.doc).toBe(session.get("scene:p.k2"));
    expect(client.opened).toEqual(["project:p", "scene:p.k2"]);

    link.destroy();
    expect(session.get("scene:p.k2")).toBeUndefined();
    session.destroy();
  });

  it("keeps the same doc through a dropped connection, reconnecting it in place", async () => {
    const { open, client } = project();
    const { source, set } = fakeSource();
    const session = await open();
    set({ status: "live", session });
    const link = createSceneDocLink({ source, scene: "yard" });
    await settle();
    const first = link.getState().ready!;

    client.setOnline(false);
    set({ status: "reconnecting" });
    expect(link.getState()).toMatchObject({ status: "reconnecting", ready: first });
    set({ status: "offline" });
    expect(link.getState().status).toBe("offline");

    // An edit made while the server was away survives the reconnect, in the same doc.
    first.doc.doc.getMap("probe").set("while", "away");
    client.setOnline(true);
    set({ status: "live" });
    expect(link.getState().status).toBe("live");
    expect(link.getState().ready).toBe(first);
    expect(client.opened.filter((n) => n === "scene:p.yard")).toHaveLength(1);
    const again = await open();
    const seen = await again.open("scene:p.yard");
    expect(seen.doc.getMap("probe").get("while")).toBe("away");
    again.destroy();
    link.destroy();
    session.destroy();
  });

  it("opens the scene again in a new session and lets the old one go", async () => {
    const { open } = project();
    const { source, set } = fakeSource();
    const one = await open();
    set({ status: "live", session: one });
    const link = createSceneDocLink({ source, scene: "yard" });
    await settle();
    expect(one.get("scene:p.yard")).toBeDefined();

    const two = await open();
    set({ session: two });
    expect(one.get("scene:p.yard")).toBeUndefined();
    expect(link.getState()).toMatchObject({ status: "connecting", ready: null });
    await settle();
    expect(link.getState().ready?.session).toBe(two);
    link.destroy();
    one.destroy();
    two.destroy();
  });

  it("fails when the project holds no scene, or the session does", async () => {
    const { open } = project([entry("post", "prefab", "post.json")]);
    const { source, set } = fakeSource();
    const session: ProjectSession = await open();
    const link = createSceneDocLink({ source });
    set({ status: "live", session });
    expect(link.getState().status).toBe("failed");
    expect(link.getState().error?.message).toMatch(/holds no scene/);
    link.destroy();
    session.destroy();

    const other = fakeSource();
    const failing = createSceneDocLink({ source: other.source });
    const error = new Error("refused");
    other.set({ status: "failed", error });
    expect(failing.getState()).toMatchObject({ status: "failed", error });
    failing.destroy();
  });

  it("fails when the service closes the scene's doc for good", async () => {
    const { open } = project();
    const { source, set } = fakeSource();
    const session = await open();
    set({ status: "live", session });
    const link = createSceneDocLink({ source, scene: "yard" });
    await settle();
    set({ stopped: { "scene:p.yard": "revoked" } });
    expect(link.getState().status).toBe("failed");
    expect(link.getState().error?.message).toMatch(/revoked/);
    link.destroy();
    session.destroy();
  });
});

describe("a project's scene doc at layout 3", () => {
  it("writes the assets header through the session's doc and checks it against the project", async () => {
    const { open } = project();
    const session = await open();
    const { doc } = await session.open("scene:p.yard");
    const origin = session.origin;
    const r = applyOpsToDoc(
      doc,
      { ops: [{ op: "useAssets", add: ["b-yard", "boom"] }] },
      origin,
      registry,
    );
    expect(r.ok).toBe(true);
    expect(docToScene(doc).assets).toEqual(["b-yard", "boom"]);
    expect(doc.getMap("assets").toJSON()).toEqual({ "b-yard": true, boom: true });

    const timers: (() => void)[] = [];
    const seen: string[][] = [];
    const watch = watchIssues(doc, registry, (issues) => seen.push(issues.map((i) => i.code)), {
      project: session,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
    });
    expect(watch.flush()).toEqual([
      expect.objectContaining({ code: "asset-missing", path: "/assets/1" }),
    ]);
    const unchecked = watchIssues(doc, registry, () => {});
    expect(unchecked.flush()).toEqual([]);
    unchecked.stop();

    writeEntry(session.projectDoc, entry("boom", "prefab", "prefabs/boom.json"));
    expect(timers).toHaveLength(1);
    timers[0]!();
    expect(seen.at(-1)).toEqual([]);
    watch.stop();

    expect(revertEntry(doc, readLog(doc).at(-1)!, origin).ok).toBe(true);
    expect(docToScene(doc).assets).toBeUndefined();
    session.destroy();
  });
});
