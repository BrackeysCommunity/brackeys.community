import * as engineVite from "@jams/engine/vite";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { SCENE_COLLAB_PATH, sceneCollabUrl, sceneDocName } from "../scene-collab";
import {
  createSceneDocLink,
  type ConnectSceneDoc,
  type SceneProviderEvents,
} from "../use-scene-doc";

describe("scene collab constants", () => {
  it("match the engine's dev server", () => {
    expect(SCENE_COLLAB_PATH).toBe(engineVite.SCENE_COLLAB_PATH);
    expect(sceneDocName("test-yard")).toBe(engineVite.sceneDocName("test-yard"));
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

function fakeConnect() {
  const opened: { doc: Y.Doc; events: SceneProviderEvents; destroy: ReturnType<typeof vi.fn> }[] =
    [];
  const connect: ConnectSceneDoc = ({ events }) => {
    const handle = { doc: new Y.Doc(), awareness: null, provider: null, destroy: vi.fn() };
    opened.push({ doc: handle.doc, events, destroy: handle.destroy });
    return handle;
  };
  return { connect, opened };
}

describe("createSceneDocLink", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is ready once the first connection syncs", () => {
    const { connect, opened } = fakeConnect();
    const link = createSceneDocLink({ name: "s", url: "ws://x", connect, isOnline: () => true });
    expect(link.getState()).toMatchObject({ status: "connecting", synced: false, ready: null });
    expect(link.getState().doc).toBe(opened[0]!.doc);

    opened[0]!.events.synced();
    expect(link.getState()).toMatchObject({ status: "live", synced: true });
    expect(link.getState().ready?.doc).toBe(opened[0]!.doc);
    link.destroy();
    expect(opened[0]!.destroy).toHaveBeenCalledOnce();
  });

  it("lets the provider retry on its own before the first sync", () => {
    const { connect, opened } = fakeConnect();
    const link = createSceneDocLink({ name: "s", url: "ws://x", connect, isOnline: () => true });
    opened[0]!.events.closed();
    expect(opened).toHaveLength(1);
    expect(opened[0]!.destroy).not.toHaveBeenCalled();
    expect(link.getState().status).toBe("connecting");
    link.destroy();
  });

  it("replaces a dropped connection with a fresh doc, keeping the old one ready until it syncs", () => {
    vi.useFakeTimers();
    const { connect, opened } = fakeConnect();
    let online = true;
    const link = createSceneDocLink({
      name: "s",
      url: "ws://x",
      connect,
      retryMs: [100],
      isOnline: () => online,
    });
    const seen = vi.fn();
    link.subscribe(seen);
    opened[0]!.events.synced();
    const first = opened[0]!.doc;

    opened[0]!.events.closed();
    expect(opened[0]!.destroy).toHaveBeenCalledOnce();
    expect(link.getState()).toMatchObject({ status: "reconnecting", synced: false });
    expect(link.getState().ready?.doc).toBe(first);

    online = false;
    vi.advanceTimersByTime(100);
    expect(opened).toHaveLength(2);
    expect(opened[1]!.doc).not.toBe(first);
    expect(link.getState()).toMatchObject({ status: "offline", ready: { doc: first } });

    online = true;
    opened[1]!.events.synced();
    expect(link.getState()).toMatchObject({ status: "live", synced: true });
    expect(link.getState().ready?.doc).toBe(opened[1]!.doc);
    expect(seen).toHaveBeenCalled();

    // A stale provider's late events change nothing.
    opened[0]!.events.closed();
    expect(link.getState().status).toBe("live");
    link.destroy();
  });

  it("stops reconnecting once destroyed", () => {
    vi.useFakeTimers();
    const { connect, opened } = fakeConnect();
    const link = createSceneDocLink({
      name: "s",
      url: "ws://x",
      connect,
      retryMs: [100],
      isOnline: () => true,
    });
    opened[0]!.events.synced();
    opened[0]!.events.closed();
    link.destroy();
    vi.advanceTimersByTime(1_000);
    expect(opened).toHaveLength(1);
  });
});
