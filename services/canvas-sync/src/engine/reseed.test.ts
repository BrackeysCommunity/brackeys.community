import { describe, expect, it } from "bun:test";

import type { beforeSyncPayload, Extension, onLoadDocumentPayload } from "@hocuspocus/server";
import * as Y from "yjs";

import {
  SEED_STALE_CODE,
  SEED_STALE_REASON,
  SeedStaleError,
  seedsOf,
} from "../../../../src/engine/collab/seed-identity.ts";
import { DATA_TABLE_VERSION } from "../../../../src/engine/project/kinds/data-table.ts";
import { SCENE_FORMAT_VERSION } from "../../../../src/engine/scene/types.ts";
import { emptyProjectState, seedProjectState } from "../../../../src/lib/scene/project-bytes.ts";
import { createSceneKind } from "../scene/kind.ts";
import { MemorySceneStore } from "../scene/store.ts";
import { SyncMetrics } from "../telemetry.ts";
import { createAssetKind } from "./asset-kind.ts";
import { MemoryAssetDocStore } from "./doc-store.ts";
import { createProjectKind, MemoryProjectStore } from "./project-kind.ts";

const scene = (name: string) =>
  JSON.stringify({
    v: SCENE_FORMAT_VERSION,
    name,
    bounds: [0, 0, 20, 10],
    entities: [{ id: "spawn", type: "marker", at: [1, 1] }],
  });

const table = (damage: number) =>
  JSON.stringify({
    kind: "data-table",
    v: DATA_TABLE_VERSION,
    table: "card",
    rows: [{ id: "fireball", cost: 3, damage }],
  });

const options = { documents: () => new Map(), now: Date.now, metrics: new SyncMetrics() };

/** What a server does with a doc: loads it into a fresh live doc, as Hocuspocus applies the load's state. */
async function load(persistence: Extension, documentName: string): Promise<Y.Doc> {
  const document = new Y.Doc();
  const state = (await persistence.onLoadDocument!({
    documentName,
    document,
  } as unknown as onLoadDocumentPayload)) as Uint8Array;
  Y.applyUpdate(document, state);
  return document;
}

/** A client's first sync step against a live doc, through the kind's hook. */
async function syncStep1(
  persistence: Extension,
  documentName: string,
  document: Y.Doc,
  client: Y.Doc,
): Promise<void> {
  await persistence.beforeSync!({
    type: 0,
    payload: Y.encodeStateVector(client),
    document,
    documentName,
  } as unknown as beforeSyncPayload);
}

const syncedFrom = (live: Y.Doc) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(live));
  return doc;
};

/**
 * Each engine kind, loaded, reseeded (its row replaced the way the web app
 * replaces it) and loaded again: a client still holding the first seed's
 * history is refused before it syncs, and nothing of it reaches the doc.
 */
const cases: {
  kind: string;
  name: string;
  make(): { persistence: Extension; reseed(): void };
}[] = [
  {
    kind: "scene",
    name: "scene:jam.level",
    make() {
      const store = new MemorySceneStore();
      store.create("jam.level", scene("first"));
      const kind = createSceneKind({ store, ...options });
      return {
        persistence: kind.persistence,
        reseed: () => store.create("jam.level", scene("next")),
      };
    },
  },
  {
    kind: "asset",
    name: "asset:jam.deck",
    make() {
      const store = new MemoryAssetDocStore();
      store.create("jam.deck", "data-table", table(5));
      const kind = createAssetKind({ store, ...options });
      return {
        persistence: kind.persistence,
        reseed: () => store.create("jam.deck", "data-table", table(9)),
      };
    },
  },
  {
    kind: "project",
    name: "project:jam",
    make() {
      const store = new MemoryProjectStore();
      store.create("jam", "Jam");
      const kind = createProjectKind({ store, ...options });
      return {
        persistence: kind.persistence,
        reseed: () =>
          store.create("jam", "Jam", seedProjectState(emptyProjectState("jam", "Jam (restored)"))),
      };
    },
  },
];

describe("a stale client after a reseed", () => {
  for (const { kind, name, make } of cases) {
    it(`is refused by the ${kind} kind, while a fresh or same-seed client syncs`, async () => {
      const { persistence, reseed } = make();
      const first = await load(persistence, name);
      expect(seedsOf(first)).toHaveLength(1);
      const stale = syncedFrom(first);
      await syncStep1(persistence, name, first, stale);

      // A reload with no reseed keeps the doc's identity.
      const reloaded = await load(persistence, name);
      expect(seedsOf(reloaded)).toEqual(seedsOf(first));
      await syncStep1(persistence, name, reloaded, stale);

      reseed();
      const live = await load(persistence, name);
      expect(seedsOf(live)).toHaveLength(1);
      expect(seedsOf(live)).not.toEqual(seedsOf(first));
      const before = Y.encodeStateAsUpdate(live);
      const refused = syncStep1(persistence, name, live, stale);
      await expect(refused).rejects.toBeInstanceOf(SeedStaleError);
      await expect(refused).rejects.toMatchObject({
        code: SEED_STALE_CODE,
        reason: SEED_STALE_REASON,
      });
      expect(Y.encodeStateAsUpdate(live)).toEqual(before);

      await syncStep1(persistence, name, live, new Y.Doc());
      await syncStep1(persistence, name, live, syncedFrom(live));
    });
  }

  it("gives two instances loading one new seed the same stamp", async () => {
    const store = new MemorySceneStore();
    store.create("jam.twin", scene("twin"));
    const a = createSceneKind({ store, ...options });
    const other = new MemorySceneStore();
    other.create("jam.twin", scene("twin"));
    const b = createSceneKind({ store: other, ...options });
    const one = await load(a.persistence, "scene:jam.twin");
    const two = await load(b.persistence, "scene:jam.twin");
    expect(Y.encodeStateAsUpdate(one)).toEqual(Y.encodeStateAsUpdate(two));
    await syncStep1(b.persistence, "scene:jam.twin", two, syncedFrom(one));
  });
});
