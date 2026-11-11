import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { EMPTY_SCENE_TEMPLATE } from "../../../src/engine/scene/create.ts";
import { syncEnvPrefix } from "../../../src/lib/canvas/sync-channels.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { createRedisExtension, redisChannels } from "../src/redis.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import { FakeRedis } from "./fake-redis.ts";
import {
  connectScene,
  newSceneId,
  SCENE_FORMAT_VERSION,
  sceneOf,
  sceneSynced,
  SECRET,
  type SceneClient,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

const SEED = {
  v: SCENE_FORMAT_VERSION,
  game: "test",
  name: "seeded",
  bounds: [0, 0, 640, 360],
  solid: [
    ["box", 0, 300, 320, 20],
    ["box", 400, 200, 40, 10],
    ["circle", 100, 100, 8],
  ],
  entities: [
    { id: "spawn", type: "marker", at: [10, 280] },
    { id: "goal", type: "marker", at: [600, 180] },
  ],
};

/** Only the server fills a new doc, so however many open it at once, each entity exists once. */
describe("seeding a brand-new hosted scene", () => {
  const store = new MemorySceneStore();
  const servers: SyncServer[] = [];
  const clients: SceneClient[] = [];
  const redis = new FakeRedis();

  const instance = async (id: string, relay?: string) => {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      sceneStore: store,
      instanceId: id,
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 500,
      ...(relay
        ? {
            redis: createRedisExtension(redis.url, relay, id),
            channels: redisChannels(redis.url, relay),
          }
        : {}),
    });
    servers.push(server);
    return server;
  };
  const open = (...args: Parameters<typeof connectScene>) => {
    const client = connectScene(...args);
    clients.push(client);
    return client;
  };

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await Promise.all(servers.map((server) => server.stop(3000)));
    await redis.stop();
  });

  it("two clients opening it at once see one copy of each entity", async () => {
    const server = await instance("seed-one");
    const sceneId = newSceneId();
    store.create(sceneId, JSON.stringify(SEED));
    const a = open(server.port, sceneId, "alice");
    const b = open(server.port, sceneId, "bob");
    expect(await sceneSynced(a)).toBe(true);
    expect(await sceneSynced(b)).toBe(true);

    expect(a.entities.size).toBe(5);
    expect(b.entities.size).toBe(5);
    expect(sceneOf(a.doc)).toEqual(sceneOf(b.doc));
    const { text } = sceneOf(a.doc)!;
    expect(JSON.parse(text).solid).toEqual(SEED.solid);
    expect(JSON.parse(text).entities).toEqual(SEED.entities);
    // The seed is stored at load, with its snapshot.
    expect(store.rows.get(sceneId)!.state).not.toBeNull();
    expect(store.rows.get(sceneId)!.snapshot).toBe(text);
    expect(store.rows.get(sceneId)!.sceneHash).toBe(sceneOf(a.doc)!.hash);
  });

  it("starts an empty scene of the id's name when the row has no seed", async () => {
    const server = await instance("seed-empty");
    const sceneId = newSceneId("platformer");
    store.create(sceneId);
    const a = open(server.port, sceneId, "alice");
    expect(await sceneSynced(a)).toBe(true);
    const scene = JSON.parse(sceneOf(a.doc)!.text);
    expect(scene).toEqual({
      v: SCENE_FORMAT_VERSION,
      game: "platformer",
      name: sceneId.split(".")[1],
      bounds: EMPTY_SCENE_TEMPLATE.bounds,
    });
    expect(a.entities.size).toBe(0);
  });

  it("two instances seeding it at once, relayed to each other, still hold one copy", async () => {
    await redis.start();
    const prefix = syncEnvPrefix(`seed-${crypto.randomUUID().slice(0, 8)}`);
    const one = await instance("seed-relay-one", prefix);
    const two = await instance("seed-relay-two", prefix);
    const sceneId = newSceneId();
    store.create(sceneId, JSON.stringify(SEED));
    const a = open(one.port, sceneId, "alice");
    const b = open(two.port, sceneId, "bob");
    expect(await sceneSynced(a)).toBe(true);
    expect(await sceneSynced(b)).toBe(true);
    // Each instance loaded it on its own; the seed writes the same items on both.
    a.doc.getMap("settings").set("gravity", [0, 900]);
    expect(await until(() => b.doc.getMap("settings").has("gravity"), 5000)).toBe(true);
    expect(a.entities.size).toBe(5);
    expect(b.entities.size).toBe(5);
    expect(sceneOf(a.doc)).toEqual(sceneOf(b.doc));
  });

  it("refuses a scene the web app never created", async () => {
    const server = await instance("seed-missing");
    const a = open(server.port, newSceneId(), "alice");
    expect(await until(() => a.authFailures.length > 0, 3000)).toBe(true);
    expect(a.authFailures[0]).toContain("scene not found");
  });
});
