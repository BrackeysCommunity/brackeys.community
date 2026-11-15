import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as Y from "yjs";

import { gridRowKey } from "../../../packages/engine/collab/convert.ts";
import { Z_FIELD } from "../../../packages/engine/collab/types.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import {
  addNamed,
  addSolid,
  connectScene,
  newSceneId,
  sceneOf,
  sceneSynced,
  SECRET,
  type SceneClient,
  sleep,
  until,
} from "./harness.ts";

setDefaultTimeout(60_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** One random batch in one transaction: adds, shape edits, reorders, deletes and settings. */
function randomBatch(client: SceneClient, random: () => number, tag: string): void {
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const z = () => `a${Math.floor(random() * 36 ** 3).toString(36)}`;
  client.doc.transact(() => {
    const ops = 1 + Math.floor(random() * 4);
    for (let i = 0; i < ops; i++) {
      const keys = [...client.entities.keys()];
      const roll = random();
      const key = pick(keys);
      if (roll < 0.35 || !key) {
        addSolid(
          client.doc,
          `${tag}-${Math.floor(random() * 1e9).toString(36)}`,
          Math.round(random() * 600),
          z(),
        );
      } else if (roll < 0.5) {
        addNamed(
          client.doc,
          `${tag}-${Math.floor(random() * 1e9).toString(36)}`,
          pick(["spawn", "goal", "door", "key"])!,
          Math.round(random() * 600),
          z(),
        );
      } else if (roll < 0.7) {
        const entity = client.entities.get(key);
        if (entity?.has("shape")) entity.set("shape", ["box", Math.round(random() * 600), 0, 8, 8]);
        else entity?.set("at", [Math.round(random() * 600), Math.round(random() * 300)]);
      } else if (roll < 0.8) {
        client.entities.get(key)?.set(Z_FIELD, z());
      } else if (roll < 0.92) {
        client.entities.delete(key);
      } else {
        client.doc.getMap("settings").set("gravity", [0, Math.round(random() * 2000)]);
      }
    }
  });
}

describe("three clients through the real server", () => {
  const store = new MemorySceneStore();
  let server: SyncServer;
  const clients: SceneClient[] = [];

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      secret: SECRET,
      sceneStore: store,
      instanceId: "scene-converge",
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 400,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(3000);
  });

  for (const seed of [1, 7, 42]) {
    it(`converge on random batches (seed ${seed}): same canonical text and sceneHash`, async () => {
      const sceneId = newSceneId();
      store.create(sceneId);
      const trio = ["alice", "bob", "carol"].map((user) =>
        connectScene(server.port, sceneId, user),
      );
      clients.push(...trio);
      for (const client of trio) expect(await sceneSynced(client)).toBe(true);

      await Promise.all(
        trio.map(async (client, n) => {
          const random = rng(seed * 31 + n);
          for (let batch = 0; batch < 30; batch++) {
            randomBatch(client, random, `${"abc"[n]}${batch}`);
            if (random() < 0.4) await sleep(Math.floor(random() * 15));
          }
        }),
      );

      const live = () => server.hocuspocus.documents.get(`scene:${sceneId}`)!;
      const agreed = () => {
        const texts = [...trio.map((c) => sceneOf(c.doc)?.text), sceneOf(live())?.text];
        return texts.every((t) => t !== undefined && t === texts[0]);
      };
      expect(await until(agreed, 10_000)).toBe(true);

      const [first, ...rest] = trio.map((c) => sceneOf(c.doc)!);
      for (const other of rest) {
        expect(other.text).toBe(first!.text);
        expect(other.hash).toBe(first!.hash);
      }
      expect(sceneOf(live())!.hash).toBe(first!.hash);
      expect(first!.text.length).toBeGreaterThan(50);

      for (const client of trio) client.destroy();
      const storedHash = () => {
        const row = store.rows.get(sceneId)!;
        if (!row.state) return null;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, row.state);
        return sceneOf(doc)?.hash ?? null;
      };
      expect(await until(() => storedHash() === first!.hash, 5000)).toBe(true);
      expect(await until(() => store.rows.get(sceneId)!.sceneHash === first!.hash, 5000)).toBe(
        true,
      );
      expect(store.rows.get(sceneId)!.snapshot).toBe(first!.text);
    });
  }
});

describe("two clients painting one tilemap through the real server", () => {
  const store = new MemorySceneStore();
  let server: SyncServer;
  const clients: SceneClient[] = [];

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      secret: SECRET,
      sceneStore: store,
      instanceId: "scene-converge-tiles",
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 400,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(3000);
  });

  it("paint different chunks and converge on both chunks' rows", async () => {
    const sceneId = newSceneId();
    store.create(sceneId);
    const [alice, bob] = ["alice", "bob"].map((user) => connectScene(server.port, sceneId, user));
    clients.push(alice!, bob!);
    expect(await sceneSynced(alice!)).toBe(true);
    expect(await sceneSynced(bob!)).toBe(true);

    alice!.doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set(Z_FIELD, "a0");
      map.set("id", "ground");
      map.set("type", "tilemap");
      map.set("at", [0, 0]);
      map.set("tileset", "tiles");
      alice!.entities.set("ground", map);
    });
    expect(await until(() => bob!.entities.has("ground"), 5000)).toBe(true);

    const paint = (client: SceneClient, chunk: string, rows: string[]) =>
      client.doc.transact(() => {
        const rec = client.entities.get("ground")!;
        rows.forEach((row, r) => rec.set(gridRowKey("cells", chunk, r), row));
      });
    paint(alice!, "0,0", ["1*32", "2*4"]);
    paint(bob!, "1,0", ["3*32", "", "4*2"]);

    const cells = { "0,0": ["1*32", "2*4"], "1,0": ["3*32", "", "4*2"] };
    const live = () => server.hocuspocus.documents.get(`scene:${sceneId}`)!;
    // Read through the canonical text: client docs use the service's yjs, not the engine's.
    const cellsOf = (doc: Y.Doc) => {
      const text = sceneOf(doc)?.text;
      if (!text) return undefined;
      const scene = JSON.parse(text) as { entities?: { id: string; cells?: unknown }[] };
      return JSON.stringify(scene.entities?.find((e) => e.id === "ground")?.cells);
    };
    const docs = () => [alice!.doc, bob!.doc, live()];
    expect(
      await until(() => docs().every((doc) => cellsOf(doc) === JSON.stringify(cells)), 10_000),
    ).toBe(true);

    const texts = docs().map((doc) => sceneOf(doc));
    expect(texts[0]).not.toBeNull();
    for (const other of texts.slice(1)) {
      expect(other?.text).toBe(texts[0]!.text);
      expect(other?.hash).toBe(texts[0]!.hash);
    }

    alice!.destroy();
    bob!.destroy();
    expect(await until(() => store.rows.get(sceneId)?.sceneHash === texts[0]!.hash, 5000)).toBe(
      true,
    );
    expect(store.rows.get(sceneId)!.snapshot).toBe(texts[0]!.text);
  });
});
