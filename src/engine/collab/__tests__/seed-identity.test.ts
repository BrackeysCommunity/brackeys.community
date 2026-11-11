import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  assertSameSeed,
  isSeedStaleClose,
  SEED_STALE_CODE,
  SEED_STALE_REASON,
  SeedStaleError,
  seedsOf,
  seedVerdict,
  stampSeed,
  stampSeedState,
} from "../seed-identity";

/** A server doc seeded with `n` entities, as a fresh writer would: a new client id each time. */
function seeded(n: number, clientID?: number): Y.Doc {
  const doc = new Y.Doc();
  if (clientID !== undefined) doc.clientID = clientID;
  const entities = doc.getMap("entities");
  doc.transact(() => {
    for (let i = 0; i < n; i++) entities.set(`e${i}`, i);
  });
  return doc;
}

/** A client that synced from `server`: it holds the server's whole state. */
function syncedFrom(server: Y.Doc): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
  return doc;
}

const sv = (doc: Y.Doc) => Y.encodeStateVector(doc);
const syncStep1 = (client: Y.Doc, document: Y.Doc) => ({
  type: 0,
  payload: sv(client),
  document,
  documentName: "scene:p.a",
});

describe("seed identity", () => {
  it("stamps a seed once, and the stamp survives a persisted reload", () => {
    const server = seeded(3);
    expect(seedsOf(server)).toEqual([]);
    expect(stampSeed(server)).toBe(true);
    const [stamp] = seedsOf(server);
    expect(stamp).toBeGreaterThan(0);
    expect(stampSeed(server)).toBe(false);

    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(server));
    expect(stampSeed(reloaded)).toBe(false);
    expect(seedsOf(reloaded)).toEqual([stamp]);
    // Content and the stamp's root are all a stamp adds.
    expect(reloaded.getMap("entities").toJSON()).toEqual({ e0: 0, e1: 1, e2: 2 });
  });

  it("judges a client by whether it holds the doc's seed", () => {
    const server = seeded(2);
    stampSeed(server);
    expect(seedVerdict(server, sv(new Y.Doc()))).toBe("empty");
    const client = syncedFrom(server);
    expect(seedVerdict(server, sv(client))).toBe("same");
    // Edits on either side after the sync don't change the lineage.
    client.getMap("entities").set("mine", 1);
    server.getMap("entities").set("theirs", 2);
    expect(seedVerdict(server, sv(client))).toBe("same");

    const reseeded = seeded(2);
    stampSeed(reseeded);
    expect(seedVerdict(reseeded, sv(client))).toBe("stale");
    expect(seedVerdict(seeded(1), sv(client))).toBe("unstamped");
  });

  it("gives equal seeds equal stamps, so two servers seeding one doc agree", () => {
    const a = seeded(4, 77);
    const b = seeded(4, 77);
    stampSeed(a);
    stampSeed(b);
    expect(seedsOf(a)).toEqual(seedsOf(b));
    expect(Y.encodeStateAsUpdate(a)).toEqual(Y.encodeStateAsUpdate(b));
    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(b));
    expect(seedsOf(merged)).toEqual(seedsOf(a));
  });

  it("stamps an encoded state, leaving one that carries a stamp byte for byte", () => {
    const state = Y.encodeStateAsUpdate(seeded(2, 5));
    const stamped = stampSeedState(state);
    expect(stamped).not.toEqual(state);
    expect(stampSeedState(stamped)).toBe(stamped);
    expect(stampSeedState(state)).toEqual(stamped);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, stamped);
    expect(seedsOf(doc)).toHaveLength(1);
  });

  it("accepts a client holding either seed of a doc that merged two", () => {
    const one = seeded(1);
    const two = seeded(1);
    stampSeed(one);
    stampSeed(two);
    const merged = syncedFrom(one);
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(two));
    expect(seedsOf(merged)).toHaveLength(2);
    expect(seedVerdict(merged, sv(syncedFrom(one)))).toBe("same");
    expect(seedVerdict(merged, sv(syncedFrom(two)))).toBe("same");
  });

  it("refuses only a stale client's first sync step, with the close a client reads", () => {
    const old = seeded(2);
    stampSeed(old);
    const stale = syncedFrom(old);
    const server = seeded(2);
    stampSeed(server);

    expect(() => assertSameSeed(syncStep1(stale, server))).toThrow(SeedStaleError);
    try {
      assertSameSeed(syncStep1(stale, server));
    } catch (e) {
      expect(e).toMatchObject({ code: SEED_STALE_CODE, reason: SEED_STALE_REASON });
      expect((e as Error).message).toContain("scene:p.a");
    }
    expect(() => assertSameSeed(syncStep1(new Y.Doc(), server))).not.toThrow();
    expect(() => assertSameSeed(syncStep1(syncedFrom(server), server))).not.toThrow();
    expect(() =>
      assertSameSeed({ type: 2, payload: Y.encodeStateAsUpdate(stale), document: server }),
    ).not.toThrow();

    expect(isSeedStaleClose(SEED_STALE_CODE)).toBe(true);
    expect(isSeedStaleClose(1000, SEED_STALE_REASON)).toBe(true);
    expect(isSeedStaleClose(1000, "provider_initiated")).toBe(false);
    expect(isSeedStaleClose(null)).toBe(false);
  });
});
