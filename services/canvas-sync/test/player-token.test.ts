import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import type { AssetEntry } from "../../../packages/engine/project/types.ts";
import { documentName } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken, type SyncTokenKind } from "../../../src/lib/canvas/token.ts";
import { emptyProjectState } from "../../../src/lib/scene/project-bytes.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import {
  assetToken,
  COLLAB_LAYOUT_VERSION,
  connectDoc,
  createMemoryProject,
  type EngineClient,
  memoryEngineStores,
  newProjectId,
  projectToken,
  SCENE_FORMAT_VERSION,
  sceneSynced as synced,
  sceneToken,
  SECRET,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };
const PLAYER_REFUSAL = "player tokens open game sessions only";
const ANON = "anon:6f1d2c3b-4a59-4e8f-9a0b-1c2d3e4f5a6b";

const entry = (key: string, kind: string, path: string): AssetEntry => ({
  key,
  id: key,
  kind,
  path,
  created: { at: 1, by: "alice" },
});

/** A token with every claim the document's own kind needs, marked as a player's. */
function playerToken(name: string, kind: SyncTokenKind, extra: { s?: "project" } = {}) {
  return signCanvasToken(
    {
      c: name,
      u: ANON,
      a: "write",
      k: kind,
      r: "player",
      ...(kind === "scene" || kind === "project" ? { f: SCENE_FORMAT_VERSION } : {}),
      ...(kind === "scene" || kind === "project" || kind === "asset"
        ? { l: COLLAB_LAYOUT_VERSION }
        : {}),
      ...extra,
    },
    SECRET,
  );
}

describe("player tokens", () => {
  const stores = memoryEngineStores();
  let server: SyncServer;
  const clients: EngineClient[] = [];

  const open = (name: string, token: () => Promise<string>) => {
    const client = connectDoc(server.port, name, token);
    clients.push(client);
    return client;
  };
  const refused = async (client: EngineClient) => {
    expect(await until(() => client.authFailures.length > 0, 3000)).toBe(true);
    return client.authFailures[0]!;
  };
  /** A project with a scene `level` and a data table `deck`. */
  const project = () => {
    const projectId = newProjectId();
    createMemoryProject(
      stores,
      {
        ...emptyProjectState(projectId, projectId),
        assets: {
          level: entry("level", "scene", "level.json"),
          deck: entry("deck", "data-table", "data/deck.json"),
        },
      },
      { deck: JSON.stringify({ kind: "data-table", v: 2, table: "card", rows: [{ id: "a" }] }) },
    );
    return projectId;
  };

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      secret: SECRET,
      ...stores.options,
      instanceId: "player-token",
      telemetry: quiet,
      debounceMs: 50,
      maxDebounceMs: 200,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(3000);
  });

  it("refuses a player token for a canvas:, scene:, project: and asset: doc", async () => {
    const id = project();
    const docs = [
      [documentName("canvas", "c1"), "canvas"],
      [documentName("scene", `${id}.level`), "scene"],
      [documentName("project", id), "project"],
      [documentName("asset", `${id}.deck`), "asset"],
    ] as const;
    for (const [name, kind] of docs) {
      expect(await refused(open(name, () => playerToken(name, kind)))).toContain(PLAYER_REFUSAL);
    }
    // Scoped to the project, a player token still opens none of its docs.
    const scoped = () => playerToken(documentName("project", id), "project", { s: "project" });
    for (const [name] of docs.slice(1)) {
      expect(await refused(open(name, scoped))).toContain(PLAYER_REFUSAL);
    }
    // A session token aimed at a hosted doc is refused by the same rule, first.
    const session = () => playerToken("session:s-1", "session");
    expect(await refused(open(documentName("scene", `${id}.level`), session))).toContain(
      PLAYER_REFUSAL,
    );
  });

  it("leaves a normal token for the same docs unaffected", async () => {
    const id = project();
    const opened = [
      open(documentName("scene", `${id}.level`), () => sceneToken(`${id}.level`, "alice")),
      open(documentName("project", id), () => projectToken(id, "alice")),
      open(documentName("asset", `${id}.deck`), () => assetToken(`${id}.deck`, "alice")),
    ];
    for (const client of opened) {
      expect(await synced(client)).toBe(true);
      expect(client.scope()).toBe("read-write");
      expect(client.authFailures).toEqual([]);
    }
  });
});
