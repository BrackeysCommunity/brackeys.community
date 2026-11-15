import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { LIVE_MESSAGE_MAX_BYTES } from "../../../packages/engine/collab/live-channel.ts";
import { syncEnvPrefix } from "../../../src/lib/canvas/sync-channels.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { createRedisExtension, redisChannels, redisLedger } from "../src/redis.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import { FakeRedis } from "./fake-redis.ts";
import {
  connectScene,
  newSceneId,
  sceneSynced,
  SECRET,
  type SceneClient,
  sleep,
  TEST_REDIS_URL,
  until,
} from "./harness.ts";

setDefaultTimeout(60_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

/**
 * The engine's live channel rides a doc's stateless messages: the service
 * passes each one to the doc's other connections, on every instance, over
 * the relay Redis. Runs on the in-process fake Redis, or a real one when
 * CANVAS_SYNC_TEST_REDIS_URL is set.
 */
describe("stateless messages between a scene's clients across two instances", () => {
  const store = new MemorySceneStore();
  const fake = TEST_REDIS_URL ? null : new FakeRedis();
  const servers: SyncServer[] = [];
  const clients: SceneClient[] = [];
  let url = TEST_REDIS_URL ?? "";

  const instance = async (id: string, prefix: string) => {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      sceneStore: store,
      instanceId: id,
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 500,
      redis: createRedisExtension(url, prefix, id),
      channels: redisChannels(url, prefix),
      ledger: redisLedger(url, prefix, id),
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
    await fake?.stop();
  });

  it("reaches the doc's other connections on both instances, not the sender; oversized is dropped", async () => {
    if (fake) url = (await fake.start()).url;
    const prefix = syncEnvPrefix(`stateless-${crypto.randomUUID().slice(0, 8)}`);
    const one = await instance("stateless-1", prefix);
    const two = await instance("stateless-2", prefix);
    const sceneId = newSceneId();
    const otherScene = newSceneId();
    store.create(sceneId);
    store.create(otherScene);

    const sender = open(one.port, sceneId, "alice");
    const sameInstance = open(one.port, sceneId, "bob");
    const acrossInstances = open(two.port, sceneId, "carol");
    const elsewhere = open(two.port, otherScene, "dan");
    const reader = open(two.port, sceneId, "erin", { access: "read" });
    for (const c of [sender, sameInstance, acrossInstances, elsewhere, reader])
      expect(await sceneSynced(c)).toBe(true);
    // Both instances have subscribed the doc on the relay before anything is sent.
    await sleep(300);

    const request = JSON.stringify({ t: "state", id: "r1" });
    sender.provider.sendStateless(request);
    expect(
      await until(
        () => sameInstance.notices.includes(request) && acrossInstances.notices.includes(request),
        8000,
      ),
    ).toBe(true);
    expect(reader.notices).toContain(request);

    const big = "x".repeat(LIVE_MESSAGE_MAX_BYTES + 1);
    sender.provider.sendStateless(big);
    // Only the live channel's messages pass: not an asset notice only the server may send.
    sender.provider.sendStateless(
      JSON.stringify({ type: "asset:changed", project: "p", id: "a", sha256: "0".repeat(64) }),
    );
    sender.provider.sendStateless("plain text");
    const after = JSON.stringify({ t: "state", id: "after" });
    sender.provider.sendStateless(after);
    expect(
      await until(
        () => sameInstance.notices.includes(after) && acrossInstances.notices.includes(after),
        8000,
      ),
    ).toBe(true);
    await sleep(200);

    for (const c of [sameInstance, acrossInstances]) expect(c.notices).toEqual([request, after]);
    expect(sender.notices).toEqual([]);
    expect(elsewhere.notices).toEqual([]);
    expect(sender.closes).toEqual([]);
    expect(sender.provider.isSynced).toBe(true);
    expect(one.metrics.refusals.size).toBe(1);

    // A read-only connection listens but doesn't speak.
    reader.provider.sendStateless("from the reader");
    await sleep(500);
    expect(sender.notices).toEqual([]);
    expect(acrossInstances.notices).not.toContain("from the reader");
    expect(reader.closes).toEqual([]);
  });

  it("drops a burst past the rate limit without closing the agent or the editor answering it", async () => {
    if (fake && !url) url = (await fake.start()).url;
    const prefix = syncEnvPrefix(`stateless-burst-${crypto.randomUUID().slice(0, 8)}`);
    const server = await instance("stateless-burst", prefix);
    const sceneId = newSceneId();
    store.create(sceneId);
    const agent = open(server.port, sceneId, "agent");
    const editor = open(server.port, sceneId, "editor");
    for (const c of [agent, editor]) expect(await sceneSynced(c)).toBe(true);
    await sleep(300);

    const BURST = 300;
    const answered = new Set<string>();
    editor.provider.on("stateless", ({ payload }: { payload: string }) => {
      const req = JSON.parse(payload) as { t: string; id: string };
      if (answered.has(req.id)) return;
      answered.add(req.id);
      editor.provider.sendStateless(JSON.stringify({ ...req, ok: true }));
    });
    for (let i = 0; i < BURST; i++)
      agent.provider.sendStateless(JSON.stringify({ t: "state", id: `b${i}` }));
    expect(await until(() => agent.notices.length > 0, 8000)).toBe(true);
    await sleep(1000);

    expect(editor.notices.length).toBeLessThan(BURST);
    expect(editor.notices.length).toBeGreaterThan(0);
    expect(agent.notices.length).toBeLessThanOrEqual(editor.notices.length);
    expect(server.metrics.refusals.rate).toBeGreaterThan(0);
    for (const c of [agent, editor]) {
      expect(c.closes).toEqual([]);
      expect(c.provider.isSynced).toBe(true);
    }
    // Both still talk once the bucket refills.
    await sleep(1000);
    agent.provider.sendStateless(JSON.stringify({ t: "state", id: "later" }));
    expect(await until(() => agent.notices.some((n) => n.includes('"later"')), 8000)).toBe(true);
  });
});
