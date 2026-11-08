// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import {
  AVATAR_SPEED,
  CARD_TABLE,
  testGame,
  type TestGameSnapshot,
} from "../../__tests__/fixtures/test-game";
import { engineHomeRegistry } from "../../project/__tests__/fixtures/engine-home";
import { memoryContentStore, type ContentStore } from "../../project/content-store";
import { sha256 } from "../../project/hash";
import { atlasKind } from "../../project/kinds/atlas";
import { textureKind } from "../../project/kinds/texture";
import { runtimeView } from "../../project/runtime-view";
import { snapshotProject, SnapshotError, type ProjectSnapshot } from "../../project/snapshot";
import type { AssetEntry, AssetId } from "../../project/types";
import { projectView } from "../../project/view";
import type { RapierModule } from "../../types";
import { loadHeadless } from "../load";
import { runPlaytest } from "../playtest";
import type { PlaytestReport } from "../playtest-types";

const scenes = new URL("../../scenes/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, scenes), "utf8");
const registry = engineHomeRegistry(testGame);

const entry = (id: AssetId, kind: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind,
  path,
  created: { at: 1, by: "test" },
});

const CARDS = {
  kind: "data-table",
  v: 1,
  table: CARD_TABLE,
  rows: [
    { id: "fireball", cost: 3, damage: 5 },
    { id: "heal", cost: 2 },
  ],
};
const MORE_CARDS = {
  kind: "data-table",
  v: 1,
  table: CARD_TABLE,
  rows: [
    { id: "heal", cost: 9 },
    { id: "shield", cost: 1 },
  ],
};
const settings = (game: Record<string, unknown>) => ({
  kind: "game-settings",
  v: 1,
  engine: {},
  game,
});

/** engine-yard with two card tables and game-settings, every text put in `store` unless `skip` names it. */
async function snapshotOf(
  store: ContentStore,
  game: Record<string, unknown>,
  skip?: AssetId,
): Promise<ProjectSnapshot> {
  const texts = new Map<AssetId, string>([
    ["engine-yard", read("engine-yard.json")],
    ["cards", JSON.stringify(CARDS)],
    ["more-cards", JSON.stringify(MORE_CARDS)],
    ["game-settings", JSON.stringify(settings(game))],
  ]);
  const entries = [
    entry("engine-yard", "scene", "scenes/engine-yard.json"),
    entry("cards", "data-table", "data/a.json"),
    entry("more-cards", "data-table", "data/b.json"),
    entry("game-settings", "game-settings", "game-settings.json"),
  ];
  for (const [id, text] of texts) if (id !== skip) await store.put(new TextEncoder().encode(text));
  const view = projectView({
    meta: { projectId: "engine", layout: 1, name: "Engine" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  });
  return snapshotProject(view, texts, {});
}

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

describe("loadHeadless's project", () => {
  it("is the snapshot's settings and tables when none is given", async () => {
    const store = memoryContentStore();
    const snapshot = await snapshotOf(store, { title: "Yard" });
    const loaded = await loadHeadless({ snapshot, store, scene: "engine-yard", registry });
    expect(loaded.project?.settings).toEqual({ avatarSpeed: AVATAR_SPEED, title: "Yard" });
    expect(loaded.project?.table(CARD_TABLE)).toEqual([
      { id: "fireball", cost: 3, damage: 5 },
      { id: "heal", cost: 2, damage: 0 },
      { id: "shield", cost: 1, damage: 0 },
    ]);
  });

  it("copies and freezes the game-settings engine block, empty without one", () => {
    const engine = { resolution: { virtual: { height: 180 }, integer: true } };
    const file = { ...settings({}), engine };
    const view = projectView({
      ...emptyState(),
      assets: { "game-settings": entry("game-settings", "game-settings", "game-settings.json") },
    });
    const project = runtimeView(view, new Map([["game-settings", file]]), registry);
    expect(project.engine).toEqual(engine);
    expect(Object.isFrozen(project.engine)).toBe(true);
    expect(Object.isFrozen((project.engine.resolution as { virtual: object }).virtual)).toBe(true);
    engine.resolution.integer = false;
    expect(project.engine).toMatchObject({ resolution: { integer: true } });
    expect(runtimeView(projectView(emptyState()), new Map(), registry).engine).toEqual({});
  });

  it("feeds a run's game: a faster avatarSpeed walks it farther", async () => {
    const script = { v: 1 as const, scene: "engine-yard", steps: [{ hold: ["right"], for: 60 }] };
    const walked = async (game: Record<string, unknown>) => {
      const store = memoryContentStore();
      const snapshot = await snapshotOf(store, game);
      const loaded = await loadHeadless({ snapshot, store, scene: "engine-yard", registry });
      const run = runPlaytest<TestGameSnapshot>({ rapier, game: testGame, ...loaded, script });
      if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
      return (run as PlaytestReport<TestGameSnapshot>).final!.position.x;
    };
    const start = 300;
    const slow = await walked({});
    const fast = await walked({ avatarSpeed: AVATAR_SPEED * 2 });
    expect(fast - start).toBeGreaterThan(1.5 * (slow - start));
  });

  it("takes the project it is given over the snapshot's, and is null by files", async () => {
    const store = memoryContentStore();
    const snapshot = await snapshotOf(store, {});
    const given = runtimeView(projectView(emptyState()), new Map(), registry);
    const pinned = await loadHeadless({
      snapshot,
      store,
      scene: "engine-yard",
      registry,
      project: given,
    });
    expect(pinned.project).toBe(given);
    const none = await loadHeadless({
      snapshot,
      store,
      scene: "engine-yard",
      registry,
      project: null,
    });
    expect(none.project).toBeNull();
    const files = await loadHeadless({ files: { scene: read("engine-yard.json") }, registry });
    expect(files.project).toBeNull();
  });

  it("refuses a snapshot whose project data the store lacks", async () => {
    const store = memoryContentStore();
    const snapshot = await snapshotOf(store, {}, "cards");
    const failed = await loadHeadless({ snapshot, store, scene: "engine-yard", registry }).catch(
      (e: unknown) => e,
    );
    expect(failed).toBeInstanceOf(SnapshotError);
    expect((failed as SnapshotError).issues[0]).toMatchObject({
      code: "asset-missing",
      entityIds: ["cards"],
    });
  });
});

describe("the runtime view's assets", () => {
  const fixture = (name: string) =>
    new Uint8Array(
      readFileSync(new URL(`../../project/__tests__/fixtures/${name}`, import.meta.url)),
    );
  const blobs = async (store?: ContentStore) => {
    const png = fixture("items.png");
    const json = fixture("items.json");
    const art = textureKind.inspect(png, {}, { path: "art/items.png", idAt: () => undefined });
    const atlas = atlasKind.inspect(
      json,
      {},
      {
        path: "art/items.json",
        idAt: (p) => (p === "art/items.png" ? "items-art" : undefined),
      },
    );
    if (!art.ok || !atlas.ok) throw new Error("fixtures don't inspect");
    const [artHash, atlasHash] = await Promise.all([sha256(png), sha256(json)]);
    if (store) await Promise.all([store.put(png), store.put(json)]);
    return [
      {
        ...entry("items-art", "texture", "art/items.png"),
        sha256: artHash,
        bytes: png.length,
        meta: art.meta as Record<string, unknown>,
        import: { pivot: [0.5, 1] },
      },
      {
        ...entry("items", "atlas", "art/items.json"),
        sha256: atlasHash,
        bytes: json.length,
        meta: atlas.meta as Record<string, unknown>,
        import: atlas.import,
      },
    ] satisfies AssetEntry[];
  };

  it("gives each blob's info from its meta, frozen at load, and undefined for an unknown id", async () => {
    const entries = await blobs();
    const view = projectView({
      ...emptyState(),
      assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    });
    const project = runtimeView(view, new Map(), registry);
    expect(project.asset("items-art")).toMatchObject({ size: [16, 16], pivot: [0.5, 1] });
    expect(project.asset("items", "gem.png")).toMatchObject({
      kind: "atlas",
      size: [8, 8],
      pivot: [0.5, 1],
      texture: "items-art",
    });
    expect(project.asset("items")?.frames).toEqual(["coin.png", "gem.png", "panel.png"]);
    expect(project.asset("items", "nope")).toBeUndefined();
    expect(project.asset("nowhere")).toBeUndefined();
    expect(Object.isFrozen(project.asset("items", "gem.png")?.size)).toBe(true);
    (entries[0]!.meta as { width: number }).width = 99;
    expect(project.asset("items-art")?.size).toEqual([16, 16]);
  });

  it("by snapshot, gives what the snapshot pins of each blob, reading none", async () => {
    const reads: string[] = [];
    const inner = memoryContentStore();
    const store: ContentStore = {
      ...inner,
      get: (hash) => {
        reads.push(hash);
        return inner.get(hash);
      },
    };
    const base = await snapshotOf(store, {});
    const pinned = await blobs(store);
    const snapshot: ProjectSnapshot = {
      ...base,
      assets: {
        ...base.assets,
        ...Object.fromEntries(
          pinned.map((e) => [
            e.id,
            { key: e.key, kind: e.kind, path: e.path, sha256: e.sha256, import: e.import },
          ]),
        ),
      },
    };
    reads.length = 0;
    const loaded = await loadHeadless({ snapshot, store, scene: "engine-yard", registry });
    expect(loaded.project?.asset("items-art")).toEqual({
      id: "items-art",
      kind: "texture",
      sha256: pinned[0]!.sha256,
      pivot: [0.5, 1],
    });
    expect(loaded.project?.asset("items")).toEqual({
      id: "items",
      kind: "atlas",
      sha256: pinned[1]!.sha256,
      texture: "items-art",
    });
    expect(loaded.project?.asset("cards")).toBeUndefined();
    const blobHashes = new Set(pinned.map((e) => e.sha256));
    expect(reads.filter((h) => blobHashes.has(h))).toEqual([]);
  });
});

function emptyState() {
  return {
    meta: { projectId: "engine", layout: 1, name: "Engine" },
    assets: {},
    history: {},
    code: {},
    build: {},
  };
}
