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

function emptyState() {
  return {
    meta: { projectId: "engine", layout: 1, name: "Engine" },
    assets: {},
    history: {},
    code: {},
    build: {},
  };
}
