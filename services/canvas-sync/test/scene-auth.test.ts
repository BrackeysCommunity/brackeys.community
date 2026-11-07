import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as Y from "yjs";

import { documentName, SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import {
  addSolid,
  connectScene,
  newSceneId,
  SCENE_FORMAT_VERSION,
  sceneSynced,
  sceneToken,
  SECRET,
  type SceneClient,
  sleep,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

describe("scene auth", () => {
  const store = new MemorySceneStore();
  let server: SyncServer;
  const clients: SceneClient[] = [];
  const open = (...args: Parameters<typeof connectScene>) => {
    const client = connectScene(...args);
    clients.push(client);
    return client;
  };
  const freshScene = () => {
    const id = newSceneId();
    store.create(id);
    return id;
  };
  const storedKeys = (sceneId: string) => {
    const state = store.rows.get(sceneId)?.state;
    if (!state) return [];
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return [...doc.getMap("entities").keys()].sort();
  };

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      secret: SECRET,
      sceneStore: store,
      instanceId: "scene-auth",
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 500,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(3000);
  });

  it("a read-only token's writes never reach anyone", async () => {
    const sceneId = freshScene();
    const writer = open(server.port, sceneId, "alice");
    const reader = open(server.port, sceneId, "bob", { access: "read" });
    expect(await sceneSynced(writer)).toBe(true);
    expect(await sceneSynced(reader)).toBe(true);
    expect(reader.scope()).toBe("readonly");
    expect(writer.scope()).toBe("read-write");

    addSolid(reader.doc, "from-reader", 50);
    addSolid(writer.doc, "from-writer", 10);
    expect(await until(() => reader.entities.has("from-writer"), 3000)).toBe(true);
    await sleep(400);
    expect(writer.entities.has("from-reader")).toBe(false);
    expect(storedKeys(sceneId)).toEqual(["from-writer"]);

    const late = open(server.port, sceneId, "carol");
    expect(await sceneSynced(late)).toBe(true);
    expect(late.entities.has("from-writer")).toBe(true);
    expect(late.entities.has("from-reader")).toBe(false);
  });

  it("revocation closes that user's sockets and refuses their token after", async () => {
    const sceneId = freshScene();
    const other = freshScene();
    const alice = open(server.port, sceneId, "alice");
    const erin = open(server.port, sceneId, "erin");
    const erinElsewhere = open(server.port, other, "erin");
    for (const client of [alice, erin, erinElsewhere]) expect(await sceneSynced(client)).toBe(true);

    const token = await sceneToken(sceneId, "erin");
    expect(server.handleRevoke({ sceneId, userId: "erin" })).toBe(1);
    expect(await until(() => erin.stopped() === SYNC_CLOSE.revoked, 3000)).toBe(true);
    await sleep(200);
    expect(alice.closes).toEqual([]);
    expect(erinElsewhere.closes).toEqual([]);

    const again = open(server.port, sceneId, "erin", { token: async () => token });
    expect(await until(() => again.authFailures.length > 0, 3000)).toBe(true);
    expect(again.authFailures[0]).toContain("access revoked");

    expect(server.handleRevoke({ userId: "erin" })).toBe(1);
    expect(await until(() => erinElsewhere.stopped() === SYNC_CLOSE.revoked, 3000)).toBe(true);
    expect(alice.closes).toEqual([]);
  });

  it("refuses a canvas token, another scene's token, an expired one and one with no engine version", async () => {
    const sceneId = freshScene();
    const name = documentName("scene", sceneId);
    const attempts = {
      canvasKind: () => signCanvasToken({ c: name, u: "alice", a: "write" }, SECRET),
      otherScene: () => sceneToken(freshScene(), "alice"),
      expired: () =>
        signCanvasToken(
          { c: name, u: "alice", a: "write", k: "scene", f: SCENE_FORMAT_VERSION },
          SECRET,
          Date.now() - 120_000,
        ),
      noVersion: () => signCanvasToken({ c: name, u: "alice", a: "write", k: "scene" }, SECRET),
      tampered: async () => {
        const [payload, signature] = (await sceneToken(sceneId, "alice")).split(".");
        const claims = JSON.parse(atob(payload!.replace(/-/g, "+").replace(/_/g, "/")));
        const forged = btoa(JSON.stringify({ ...claims, u: "mallory" }))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        return `${forged}.${signature}`;
      },
    };
    const reasons: Record<string, string> = {};
    for (const [label, token] of Object.entries(attempts)) {
      const client = open(server.port, sceneId, "alice", { token });
      expect(await until(() => client.authFailures.length > 0, 3000)).toBe(true);
      reasons[label] = client.authFailures[0]!;
      client.destroy();
    }
    expect(reasons).toEqual({
      canvasKind: expect.stringContaining("token is for another kind"),
      otherScene: expect.stringContaining("token is for another document"),
      expired: expect.stringContaining("invalid token"),
      noVersion: expect.stringContaining("no engine version"),
      tampered: expect.stringContaining("invalid token"),
    });
    expect(server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0).toBe(0);
  });

  it("refuses canvases on an instance that hosts only scenes", async () => {
    const client = connectScene(server.port, "unused.scene", "alice", {
      token: () => signCanvasToken({ c: "canvas:c1", u: "alice", a: "write" }, SECRET),
    });
    clients.push(client);
    // The provider names the scene doc; a token for a canvas doesn't match it.
    expect(await until(() => client.authFailures.length > 0, 3000)).toBe(true);
    expect(client.authFailures[0]).toContain("another document");
  });
});
