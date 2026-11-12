import { describe, expect, it } from "bun:test";

import {
  UNLIMITED_QUOTA,
  type AssetEntry,
  type ProjectState,
} from "../../../../packages/engine/project/index.ts";
import { createRegistry } from "../../../../packages/engine/scene/index.ts";
import { PROJECT_QUOTA } from "../../../../src/lib/engine/limits.ts";
import { siteQuotaPolicy } from "../../../../src/lib/engine/quota.ts";
import {
  applyProjectDuties,
  emptyProjectState,
  ENGINE_KINDS,
  readProjectState,
  seedProjectState,
} from "../../../../src/lib/scene/project-bytes.ts";
import { SyncMetrics } from "../telemetry.ts";
import { MemoryAssetDocStore } from "./doc-store.ts";
import { createProjectKind, MemoryProjectStore, planProjectDuties } from "./project-kind.ts";

const MISSING = "f".repeat(64);
const STORED = "a".repeat(64);
const EARLIER = "b".repeat(64);

const crate: AssetEntry = {
  key: "crate",
  id: "crate",
  kind: "texture",
  path: "art/crate.png",
  created: { at: 1, by: "alice" },
  sha256: MISSING,
  bytes: 99,
  meta: { format: "png", width: 64, height: 64 },
};

const plan = (state: ProjectState, stored: ProjectState | null, known: string[]) =>
  planProjectDuties({
    state,
    stored: () => stored,
    now: 5,
    kinds: ENGINE_KINDS,
    registry: createRegistry(null),
    quota: UNLIMITED_QUOTA,
    values: () => new Map(),
    knownBlobs: async () => new Set(known),
    hasRow: () => true,
    rows: async () => [],
  });

describe("planProjectDuties", () => {
  const base = emptyProjectState("demo", "Demo");

  it("reverts a missing hash to the stored one with the stored meta", async () => {
    const meta = { format: "png", width: 8, height: 8 };
    const stored = { ...base, assets: { crate: { ...crate, sha256: STORED, bytes: 4, meta } } };
    const { duties } = await plan({ ...base, assets: { crate } }, stored, [STORED]);
    expect(duties.hashes).toEqual([{ key: "crate", to: { sha256: STORED, bytes: 4, meta } }]);
    const after = readProjectState(applyProjectDuties(seedProjectState(stored), duties).state);
    expect(after.assets.crate).toMatchObject({ sha256: STORED, bytes: 4, meta });
  });

  it("reverts a missing hash to one from history without meta, so nothing describes the missing bytes", async () => {
    const state: ProjectState = {
      ...base,
      assets: { crate },
      history: { crate: [{ sha256: EARLIER, bytes: 3, at: 1, by: "alice" }] },
    };
    const { duties } = await plan(state, null, [EARLIER]);
    expect(duties.hashes).toEqual([{ key: "crate", to: { sha256: EARLIER, bytes: 3 } }]);
    const after = readProjectState(applyProjectDuties(seedProjectState(state), duties).state);
    expect(after.assets.crate).toMatchObject({ sha256: EARLIER, bytes: 3 });
    expect(after.assets.crate!.meta).toBeUndefined();
  });
});

describe("the site's quota on new docs", () => {
  const material = (key: string, deleted = false): AssetEntry => ({
    key,
    id: key,
    kind: "material",
    path: `materials/${key}.json`,
    created: { at: 1, by: "alice" },
    ...(deleted ? { deleted: { at: 2, by: "alice" } } : {}),
  });

  /** `held` docs with rows, plus one new doc entry without a row. */
  const project = (held: number): ProjectState => {
    const assets: Record<string, AssetEntry> = {};
    for (let i = 0; i < held; i++) assets[`m${i}`] = material(`m${i}`);
    assets.fresh = material("fresh");
    return { ...emptyProjectState("demo", "Demo"), assets };
  };

  const planWithSiteQuota = (state: ProjectState) =>
    planProjectDuties({
      state,
      stored: () => null,
      now: 5,
      kinds: ENGINE_KINDS,
      registry: createRegistry(null),
      quota: siteQuotaPolicy(),
      values: () => new Map(),
      knownBlobs: async () => new Set(),
      hasRow: () => false,
      rows: async () =>
        Object.keys(state.assets)
          .filter((key) => key !== "fresh")
          .map((key) => ({ key, kind: "material", prefix: "asset" as const, bytes: 10 })),
    });

  it("gives the 1,000th doc its row", async () => {
    const { duties, create } = await planWithSiteQuota(project(PROJECT_QUOTA.docs - 1));
    expect(create).toEqual([{ key: "fresh", kind: "material", prefix: "asset" }]);
    expect(duties.refused).toBeUndefined();
  });

  it("repairs the 1,001st doc to deleted with quota-exceeded and the stated words", async () => {
    const state = project(PROJECT_QUOTA.docs);
    const { duties, create } = await planWithSiteQuota(state);
    expect(create).toEqual([]);
    expect(duties.refused).toEqual([
      {
        key: "fresh",
        message: "This project already has 1,000 documents, the most a hosted project can have.",
      },
    ]);
    const applied = applyProjectDuties(seedProjectState(state), duties);
    expect(readProjectState(applied.state).assets.fresh!.deleted).toEqual({
      at: 5,
      by: expect.any(String),
    });
    expect(applied.entries.map((e) => e.actor)).toEqual([
      { kind: "repair", reason: "quota-exceeded" },
    ]);
  });

  it("counts trashed docs, which are still stored", async () => {
    const state = project(PROJECT_QUOTA.docs);
    const trashed = { ...state, assets: { ...state.assets, m0: material("m0", true) } };
    expect((await planWithSiteQuota(trashed)).duties.refused).toHaveLength(1);
  });

  it("is the project kind's policy unless one is passed", async () => {
    const assets = new MemoryAssetDocStore();
    const store = new MemoryProjectStore({ assets });
    const state = project(PROJECT_QUOTA.docs);
    store.create("demo", "Demo", seedProjectState(state));
    for (const key of Object.keys(state.assets))
      if (key !== "fresh") assets.create(`demo.${key}`, "material");
    const kind = createProjectKind({
      store,
      documents: () => new Map(),
      now: () => 5,
      metrics: new SyncMetrics(),
    });
    expect(await kind.update("demo", seedProjectState(state))).toBe("stored");
    const stored = readProjectState(store.rowsById.get("demo")!.state);
    expect(stored.assets.fresh!.deleted).toBeDefined();
    expect(assets.rows.has("demo.fresh")).toBe(false);
  });
});
