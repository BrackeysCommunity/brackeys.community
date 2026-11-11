// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { seedProjectDoc } from "../../collab/project-doc";
import { SEED_STALE_REASON } from "../../collab/seed-identity";
import type { AwarenessLike } from "../../collab/types";
import { createKindRegistry } from "../../project/kinds";
import { createRegistry } from "../../scene/index";
import * as engineVite from "../../vite/index";
import {
  devCollabUrl,
  devProjectHost,
  findDevScene,
  PROJECT_ROUTE,
  SCENE_COLLAB_PATH,
  SCENE_ROUTE,
} from "../connect/dev";
import { CONNECTION_OFF, connectProjectSession, offConnection } from "../connect/project-session";
import type { HocuspocusModule, ProjectDocEvents, ProjectTransport } from "../host";

/** A Hocuspocus module that records the socket URLs it's asked for and never connects. */
function recordingHocuspocus() {
  const urls: string[] = [];
  const mod = {
    WebSocketStatus: { Connected: "connected", Connecting: "connecting" },
    HocuspocusProviderWebsocket: class {
      status = "connecting";
      constructor({ url }: { url: string }) {
        urls.push(url);
      }
      destroy() {}
    },
    HocuspocusProvider: class {
      awareness = {};
      attach() {}
      detach() {}
      destroy() {}
    },
  } as unknown as HocuspocusModule;
  return { mod, urls };
}

describe("the dev server's routes", () => {
  it("match ./vite's", () => {
    expect(SCENE_COLLAB_PATH).toBe(engineVite.SCENE_COLLAB_PATH);
    expect(PROJECT_ROUTE).toBe(engineVite.PROJECT_ROUTE);
    expect(SCENE_ROUTE).toBe(engineVite.SCENE_ROUTE);
  });

  it("build the websocket URL from the page's origin, or the one given", () => {
    expect(devCollabUrl({ protocol: "http:", host: "localhost:3000" })).toBe(
      "ws://localhost:3000/__scene-collab",
    );
    expect(devCollabUrl({ protocol: "https:", host: "dev.test" })).toBe(
      "wss://dev.test/__scene-collab",
    );
    expect(devCollabUrl("https://dev.test:8443")).toBe("wss://dev.test:8443/__scene-collab");
    expect(devCollabUrl("wss://dev.test")).toBe("wss://dev.test/__scene-collab");
    expect(devCollabUrl()).toBe(`ws://${window.location.host}/__scene-collab`);
  });
});

describe("devProjectHost", () => {
  const args = {
    project: "p",
    registry: createRegistry(null),
    origin: { kind: "user", userId: "u", name: "U" } as const,
  };

  it("connects on the page's collab path with the dev blob route, by default", async () => {
    const { mod, urls } = recordingHocuspocus();
    const host = devProjectHost({ hocuspocus: mod });
    const connection = host.connect(args);
    await expect.poll(() => urls).toEqual([`ws://${window.location.host}${SCENE_COLLAB_PATH}`]);
    expect(connection.blobs).toBeDefined();
    expect(connection.getState()).toMatchObject({ status: "connecting", access: "write" });
    connection.destroy();
  });

  it("connects to another origin's dev server when given one", async () => {
    const { mod, urls } = recordingHocuspocus();
    const host = devProjectHost({ hocuspocus: mod, origin: "http://dev.test:5173" });
    const connection = host.connect(args);
    await expect.poll(() => urls).toEqual(["ws://dev.test:5173/__scene-collab"]);
    const entry = { id: "sky", kind: "texture", sha256: "ab".repeat(32), bytes: 1 };
    expect(host.assetUrl("p", entry)).toBe(
      `http://dev.test:5173${PROJECT_ROUTE}/p/blob/${entry.sha256}`,
    );
    connection.destroy();
  });

  it("takes a websocket origin, and serves blobs over http(s) on the same host", async () => {
    const { mod, urls } = recordingHocuspocus();
    const host = devProjectHost({ hocuspocus: mod, origin: "wss://dev.test:8443" });
    const connection = host.connect(args);
    await expect.poll(() => urls).toEqual(["wss://dev.test:8443/__scene-collab"]);
    const entry = { id: "sky", kind: "texture", sha256: "ab".repeat(32), bytes: 1 };
    expect(host.assetUrl("p", entry)).toMatch(/^https:\/\/dev\.test:8443\/__project\//);
    connection.destroy();
  });
});

/** The dev server's listing routes over two projects, as `fetch` answers them. */
function listingFetch(over: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    "/__scene": { ok: true, scenes: ["7c1d2e3f", "kitchen-sink", "test-yard"] },
    "/__scene/kitchen-sink": { v: 4, name: "kitchen-sink", bounds: [0, 0, 1, 1] },
    "/__scene/test-yard": { v: 4, game: "platformer", name: "test-yard", bounds: [0, 0, 1, 1] },
    "/__scene/7c1d2e3f": { v: 4, name: "grid-yard", bounds: [0, 0, 1, 1] },
    "/__project": {
      ok: true,
      projects: [
        { id: "engine", name: "Engine", game: null },
        { id: "platformer", name: "Platformer", game: "platformer" },
      ],
    },
    ...over,
  };
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const body = routes[url];
    return { ok: body !== undefined, json: async () => body };
  };
  return { fetch, asked };
}

describe("findDevScene", () => {
  it("names the project that holds a scene, by id or by name", async () => {
    const { fetch } = listingFetch();
    expect(await findDevScene("kitchen-sink", { fetch })).toEqual({
      project: "engine",
      id: "kitchen-sink",
      name: "kitchen-sink",
    });
    expect(await findDevScene("test-yard", { fetch })).toEqual({
      project: "platformer",
      id: "test-yard",
      name: "test-yard",
    });
    expect(await findDevScene("grid-yard", { fetch })).toEqual({
      project: "engine",
      id: "7c1d2e3f",
      name: "grid-yard",
    });
    expect(await findDevScene("7c1d2e3f", { fetch })).toMatchObject({ name: "grid-yard" });
  });

  it("reads the scenes together to match a name, and takes the first match in listing order", async () => {
    const { fetch: answer } = listingFetch({
      "/__scene/kitchen-sink": { v: 4, name: "grid-yard", bounds: [0, 0, 1, 1] },
    });
    let open = 0;
    let most = 0;
    const fetch = async (url: string) => {
      open += 1;
      most = Math.max(most, open);
      // The first scene answers last, so a match picked by arrival order would be wrong.
      await new Promise((r) => setTimeout(r, url.endsWith("7c1d2e3f") ? 20 : 0));
      open -= 1;
      return answer(url);
    };
    expect(await findDevScene("grid-yard", { fetch })).toEqual({
      project: "engine",
      id: "7c1d2e3f",
      name: "grid-yard",
    });
    expect(most).toBeGreaterThanOrEqual(3);
  });

  it("says nothing when no scene matches, two projects play its game, or the server can't answer", async () => {
    expect(await findDevScene("nowhere", listingFetch())).toBeNull();
    const twoGameless = listingFetch({
      "/__project": {
        ok: true,
        projects: [
          { id: "engine", name: "Engine", game: null },
          { id: "sandbox", name: "Sandbox", game: null },
        ],
      },
    });
    expect(await findDevScene("kitchen-sink", twoGameless)).toBeNull();
    const down = async () => {
      throw new Error("offline");
    };
    expect(await findDevScene("kitchen-sink", { fetch: down })).toBeNull();
  });

  it("asks the dev server's origin when the host was given one", async () => {
    const { fetch, asked } = listingFetch();
    await findDevScene("nowhere", { base: "http://dev.test:5173", fetch });
    expect(asked).toContain("http://dev.test:5173/__scene");
    expect(asked).toContain("http://dev.test:5173/__project");
  });
});

describe("offConnection", () => {
  it("stays off with the access it was given, and never notifies", () => {
    const connection = offConnection("read");
    expect(connection.getState()).toEqual({ ...CONNECTION_OFF, access: "read" });
    expect(offConnection().getState()).toEqual(CONNECTION_OFF);
    expect(connection.blobs).toBeUndefined();
    const unsubscribe = connection.subscribe(() => {
      throw new Error("an off connection never changes");
    });
    unsubscribe();
    connection.destroy();
  });
});

describe("a doc the server refuses as another seed's", () => {
  type Opened = { name: string; doc: Y.Doc; events: ProjectDocEvents; destroyed: boolean };

  /** A transport over in-memory server docs: each provider syncs its doc from the server's copy. */
  function memoryTransport() {
    const server = new Map<string, Y.Doc>();
    const project = new Y.Doc();
    seedProjectDoc(
      project,
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: {
          a: { key: "a", id: "a", kind: "scene", path: "a.json", created: { at: 0, by: "seed" } },
        },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    server.set("project:p", project);
    const sockets: { destroyed: boolean; providers: Opened[] }[] = [];
    const transport: ProjectTransport = () => {
      const socket = { destroyed: false, providers: [] as Opened[] };
      sockets.push(socket);
      return {
        status: () => "connected",
        subscribe: () => () => {},
        provider({ name, doc, events }) {
          const opened: Opened = { name, doc, events, destroyed: false };
          socket.providers.push(opened);
          const from = server.get(name) ?? new Y.Doc();
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(from));
          queueMicrotask(() => events.synced());
          return {
            awareness: {} as AwarenessLike,
            attach() {},
            detach() {},
            destroy() {
              opened.destroyed = true;
            },
          };
        },
        destroy() {
          socket.destroyed = true;
        },
      };
    };
    return { server, sockets, transport };
  }

  it("resets the whole session to the server's state on a fresh socket, never merging", async () => {
    const { server, sockets, transport } = memoryTransport();
    const link = connectProjectSession({
      project: "p",
      registry: createRegistry(null),
      kinds: createKindRegistry(null),
      origin: { kind: "user", userId: "u", name: "U" },
      transport,
      url: "ws://dev.test/__scene-collab",
    });
    await expect.poll(() => link.getState().status).toBe("live");
    const first = link.getState().session!;
    await first.open("scene:p.a");
    expect(sockets).toHaveLength(1);
    const old = sockets[0]!;

    // The server reseeds the scene: its copy shares no history with the client's.
    const reseeded = new Y.Doc();
    reseeded.getMap("entities").set("fresh", 1);
    server.set("scene:p.a", reseeded);
    const scene = old.providers.find((p) => p.name === "scene:p.a")!;
    scene.events.closed(1000, true, SEED_STALE_REASON);

    expect(link.getState()).toMatchObject({ session: null, status: "connecting", stopped: {} });
    expect(old.destroyed).toBe(true);
    expect(old.providers.every((p) => p.destroyed)).toBe(true);
    await expect.poll(() => link.getState().status).toBe("live");
    const second = link.getState().session!;
    expect(second).not.toBe(first);
    expect(sockets).toHaveLength(2);
    const doc = await second.open("scene:p.a");
    expect(doc.doc.getMap("entities").toJSON()).toEqual({ fresh: 1 });
    expect(link.getState().error).toBeNull();
    link.destroy();
  });

  it("leaves other closes to the close reasons", async () => {
    const { sockets, transport } = memoryTransport();
    const link = connectProjectSession({
      project: "p",
      registry: createRegistry(null),
      kinds: createKindRegistry(null),
      origin: { kind: "user", userId: "u", name: "U" },
      transport,
      url: "ws://dev.test/__scene-collab",
      closeReason: () => "revoked",
    });
    await expect.poll(() => link.getState().status).toBe("live");
    const session = link.getState().session!;
    sockets[0]!.providers[0]!.events.closed(4403, true, "4403 revoked");
    expect(link.getState().session).toBe(session);
    expect(link.getState().stopped).toEqual({ "project:p": "revoked" });
    expect(sockets).toHaveLength(1);
    link.destroy();
  });
});
