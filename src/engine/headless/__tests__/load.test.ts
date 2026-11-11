// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { memoryContentStore, type ContentStore } from "../../project/content-store";
import { snapshotProject, type ProjectSnapshot } from "../../project/snapshot";
import type { AssetEntry, AssetId } from "../../project/types";
import { projectView } from "../../project/view";
import { formatPrefab, formatScene } from "../../scene/format";
import { sceneHashWith } from "../../scene/prefab";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { loadHeadless, type HeadlessLoad } from "../load";
import { runPlaytest } from "../playtest";
import type { PlaytestReport } from "../playtest-types";
import { replayRecording } from "../recording";

/** A game that places the `spare` prefab, which no scene instance names, at load. */
const game: GameDefinition<{ placed: readonly string[] }> = defineGame({
  id: "spares",
  types: [],
  actions: [],
  createRuntime: (ctx) => {
    let placed: readonly string[] = [];
    return {
      onLoad() {
        placed = ctx.instantiate("spare", [40, 0]).entities;
      },
      snapshot: () => ({ placed }),
    };
  },
});
const registry = createRegistry(game);

const prefab = (id: string, x: number): Prefab => ({
  kind: "prefab",
  v: 3,
  id,
  entities: [{ id: "pin", type: "marker", at: [x, 0] }],
});
const used = prefab("used", 0);
const spare = prefab("spare", 5);

const def: SceneDefinition = {
  v: 3,
  name: "spares",
  bounds: [-100, -100, 100, 100],
  settings: { physics: "none" },
  instances: [{ id: "u", prefab: "used", at: [0, 0] }],
};

const entry = (id: AssetId, kind: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind,
  path,
  created: { at: 1, by: "test" },
});

/** A snapshot of the scene and both prefabs; `store` gets the texts `stored` keeps. */
async function snapshotOf(
  store: ContentStore,
  stored: (id: AssetId) => boolean = () => true,
): Promise<ProjectSnapshot> {
  const texts = new Map<AssetId, string>([
    [def.name, formatScene(def).text],
    [used.id, formatPrefab(used)],
    [spare.id, formatPrefab(spare)],
  ]);
  for (const [id, text] of texts) if (stored(id)) await store.put(new TextEncoder().encode(text));
  const entries = [
    entry(def.name, "scene", `scenes/${def.name}.json`),
    entry(used.id, "prefab", "scenes/prefabs/used.json"),
    entry(spare.id, "prefab", "scenes/prefabs/spare.json"),
  ];
  const view = projectView({
    meta: { projectId: "spares", layout: 1, name: "Spares" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  });
  return snapshotProject(view, texts, {});
}

const byFiles = () =>
  loadHeadless({
    files: { scene: formatScene(def).text, prefabs: [formatPrefab(used), formatPrefab(spare)] },
    registry,
  });

function play(loaded: HeadlessLoad): PlaytestReport<{ placed: readonly string[] }> {
  const run = runPlaytest({ game, ...loaded, script: { v: 1, steps: [{ wait: 2 }] } });
  if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
  return run as PlaytestReport<{ placed: readonly string[] }>;
}

describe("loadHeadless's prefab library", () => {
  it("by files: hashes the used prefabs and hands the runtime all of them", async () => {
    const loaded = await byFiles();
    expect([...loaded.prefabs.keys()]).toEqual(["used"]);
    expect([...loaded.library.keys()].sort()).toEqual(["spare", "used"]);
    expect(loaded.sceneHash).toBe(sceneHashWith(def, new Map([["used", used]])));
    expect(play(loaded).final).toEqual({ placed: ["spare#1/pin"] });
  });

  it("by snapshot: adds the snapshot's other prefabs to the library", async () => {
    const store = memoryContentStore();
    const loaded = await loadHeadless({
      snapshot: await snapshotOf(store),
      store,
      scene: def.name,
      registry,
    });
    const files = await byFiles();
    expect(loaded.prefabs).toEqual(files.prefabs);
    expect(loaded.library).toEqual(files.library);
    expect(loaded.sceneHash).toBe(files.sceneHash);
    expect(play(loaded).final).toEqual(play(files).final);
  });

  it("by snapshot: leaves out a prefab the store has no text for, so placing it fails the run", async () => {
    const store = memoryContentStore();
    const loaded = await loadHeadless({
      snapshot: await snapshotOf(store, (id) => id !== spare.id),
      store,
      scene: def.name,
      registry,
    });
    expect([...loaded.library.keys()]).toEqual(["used"]);
    const run = runPlaytest({ game, ...loaded, script: { v: 1, steps: [{ wait: 2 }] } });
    expect(run).toMatchObject({ blocked: true, stage: "load" });
  });

  it("replays a recording with the same library", async () => {
    const loaded = await byFiles();
    const run = play(loaded);
    const replay = replayRecording({ game, ...loaded, recording: run.recording });
    expect(replay).toMatchObject({ blocked: false, stale: false });
    if (!replay.blocked) expect(replay.final).toEqual(run.final);
  });
});
