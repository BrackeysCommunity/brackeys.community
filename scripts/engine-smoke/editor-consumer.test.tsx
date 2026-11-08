// @vitest-environment jsdom

/**
 * The packed editor UI in an outside host: `smoke.ts` copies this file next
 * to the extracted tarball with a scratch copy of the engine project, so
 * every `@jams/engine` import below is `dist`. The editor mounts on `./vite`'s
 * dev server with the real Hocuspocus provider, as a game outside the repo
 * would run it. It isn't part of the root `vp test` run.
 */
import { join } from "node:path";

import * as hocuspocus from "@hocuspocus/provider";
import { devProjectHost, mountSceneEditor } from "@jams/engine/editor-ui";
import { listenSceneCollab, readFileProject, type ListeningSceneCollab } from "@jams/engine/vite";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { smokeGame } from "./game";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

/** `smoke.ts` puts the jsdom page on this port, so the page and the dev server share an origin. */
const PORT = Number(process.env.SMOKE_COLLAB_PORT);

/** The provider module the host hands the editor, with every socket it opens recorded. */
const sockets: WebSocket[] = [];
class TrackedWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    sockets.push(this);
  }
}
const provider: typeof hocuspocus = {
  ...hocuspocus,
  HocuspocusProviderWebsocket: class extends hocuspocus.HocuspocusProviderWebsocket {
    constructor(config: ConstructorParameters<typeof hocuspocus.HocuspocusProviderWebsocket>[0]) {
      super({ ...config, WebSocketPolyfill: TrackedWebSocket });
    }
  },
};

let collab: ListeningSceneCollab | null = null;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await collab?.close();
  collab = null;
});

describe("the packed @jams/engine/editor-ui", () => {
  it("mounts on ./vite's dev server, opens the kitchen sink, and closes its socket on unmount", async () => {
    // vitest runs from the consumer directory, which holds the scratch project.
    const project = await readFileProject(join(process.cwd(), "engine-project"), {
      cacheDir: join(process.cwd(), ".engine-project-cache"),
    });
    expect(PORT, "SMOKE_COLLAB_PORT").toBeGreaterThan(0);
    collab = await listenSceneCollab({ projects: [project], port: PORT, warn: () => {} });
    const server = collab;
    expect(location.origin).toBe(server.httpUrl);

    const element = document.createElement("div");
    document.body.append(element);
    let mounted!: ReturnType<typeof mountSceneEditor>;
    act(() => {
      mounted = mountSceneEditor(element, {
        host: devProjectHost({ hocuspocus: provider, origin: server.httpUrl }),
        game: smokeGame,
        project: project.file.id,
        scene: "kitchen-sink",
        rapier: () => import("@dimforge/rapier2d"),
      });
    });

    const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
    const crate = await waitFor(() => outliner().getByRole("button", { name: /^crate/ }), {
      timeout: 20_000,
    });
    for (const id of ["ledge", "zone", "ball"])
      expect(outliner().getByRole("button", { name: new RegExp(`^${id}`) })).toBeTruthy();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.readyState).toBe(WebSocket.OPEN);
    expect(server.server.hocuspocus.getConnectionsCount()).toBeGreaterThan(0);

    fireEvent.click(crate);
    expect(screen.getByRole("region", { name: "Identity" })).toBeTruthy();

    act(() => mounted.unmount());
    expect(element.childElementCount).toBe(0);
    await waitFor(() => expect(sockets[0]!.readyState).toBe(WebSocket.CLOSED), {
      timeout: 10_000,
    });
    element.remove();
  }, 60_000);
});
