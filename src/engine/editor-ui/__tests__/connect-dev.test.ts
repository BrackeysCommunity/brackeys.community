// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../scene/index";
import * as engineVite from "../../vite/index";
import { devCollabUrl, devProjectHost, PROJECT_ROUTE, SCENE_COLLAB_PATH } from "../connect/dev";
import { CONNECTION_OFF, offConnection } from "../connect/project-session";
import type { HocuspocusModule } from "../host";

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
  });

  it("build the websocket URL from the page's origin, or the one given", () => {
    expect(devCollabUrl({ protocol: "http:", host: "localhost:3000" })).toBe(
      "ws://localhost:3000/__scene-collab",
    );
    expect(devCollabUrl({ protocol: "https:", host: "dev.test" })).toBe(
      "wss://dev.test/__scene-collab",
    );
    expect(devCollabUrl("https://dev.test:8443")).toBe("wss://dev.test:8443/__scene-collab");
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
