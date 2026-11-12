// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  AVATAR_SPEED,
  GOAL_EVENT,
  testGame,
  type TestGameSnapshot,
} from "../../__tests__/fixtures/test-game";
import { createRegistry, withProject } from "../../game/define";
import {
  engineHomeMaterials,
  engineHomeRegistry,
} from "../../project/__tests__/fixtures/engine-home";
import { memoryContentStore, type ContentStore } from "../../project/content-store";
import { textureKind } from "../../project/kinds/texture";
import { snapshotProject, SnapshotError, type ProjectSnapshot } from "../../project/snapshot";
import type { AssetEntry, AssetId } from "../../project/types";
import { projectView } from "../../project/view";
import { formatPrefab, formatScene } from "../../scene/format";
import { parseScene, SceneParseError } from "../../scene/parse";
import { parsePrefab } from "../../scene/prefab";
import type { Prefab, SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import { loadHeadless, type HeadlessLoad } from "../load";
import { runPlaytest } from "../playtest";
import type { InputScript, PlaytestReport } from "../playtest-types";
import { replayRecording, type ReplayReport } from "../recording";

vi.mock("pixi.js", () => {
  throw new Error("pixi.js was imported");
});

const scenes = new URL("../../scenes/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, scenes), "utf8");
/** Parses the files on disk, whose scenes name the engine home's materials. */
const registry = engineHomeRegistry(testGame);
/** What loads by snapshot: no materials of its own, so every one comes from the snapshot. */
const plain = createRegistry(testGame);
const homeMaterials = engineHomeMaterials();
const BOUNCY = homeMaterials.values.get("bouncy") as { physics: Record<string, number> };

function scene(name: string): SceneDefinition {
  const parsed = parseScene(read(`${name}.json`), registry);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.def;
}
function prefab(id: string): Prefab {
  const parsed = parsePrefab(read(`prefabs/${id}.json`), registry);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.prefab;
}

/** Every prefab of the engine's home: the kitchen sink reaches all of them through instances, nesting and bases. */
const homePrefabs = (): Prefab[] =>
  readdirSync(new URL("prefabs/", scenes))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => prefab(f.slice(0, -".json".length)));

const entry = (id: AssetId, kind: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind,
  path,
  created: { at: 1, by: "test" },
});

/** A snapshot of one scene, its prefabs and the engine home's materials (`materials` overriding their JSON by id), its canonical texts put in `store`. */
async function snapshotOf(
  store: ContentStore,
  def: SceneDefinition,
  prefabs: readonly Prefab[],
  materials: Readonly<Record<AssetId, unknown>> = {},
): Promise<ProjectSnapshot> {
  const entries = [
    entry(def.name, "scene", `scenes/${def.name}.json`),
    ...prefabs.map((p) => entry(p.id, "prefab", `scenes/prefabs/${p.id}.json`)),
    ...homeMaterials.entries,
    entry("scene-list", "scene-list", "scenes/scene-list.json"),
  ];
  const texts = new Map<AssetId, string>([
    [def.name, formatScene(def).text],
    ["scene-list", read("scene-list.json")],
    ...prefabs.map((p): [AssetId, string] => [p.id, formatPrefab(p)]),
    ...[...homeMaterials.values].map(([id, value]): [AssetId, string] => [
      id,
      JSON.stringify(materials[id] ?? value),
    ]),
  ]);
  for (const text of texts.values()) await store.put(new TextEncoder().encode(text));
  const view = projectView({
    meta: { projectId: "engine", layout: 1, name: "Engine" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  });
  return snapshotProject(view, texts, {});
}

/** The engine project's scene list, which every snapshot of it pins. */
const ENGINE_FLOW = {
  start: "engine-yard",
  scenes: [
    { scene: "engine-yard", title: "Engine yard" },
    { scene: "kitchen-sink", title: "Kitchen sink" },
    { scene: "grid-yard", title: "Grid yard" },
    { scene: "grid-annex", sublevel: true, title: "Grid annex" },
  ],
};

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

function play(loaded: HeadlessLoad, script: InputScript): PlaytestReport<TestGameSnapshot> {
  const run = runPlaytest<TestGameSnapshot>({ rapier, game: testGame, ...loaded, script });
  if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
  return run as PlaytestReport<TestGameSnapshot>;
}

function replay(loaded: HeadlessLoad, recording: unknown): ReplayReport<TestGameSnapshot> {
  const run = replayRecording<TestGameSnapshot>({ rapier, game: testGame, ...loaded, recording });
  if (run.blocked) throw new Error(`blocked: ${JSON.stringify(run)}`);
  return run;
}

type Case = {
  name: string;
  before: () => { def: SceneDefinition; prefabs: Prefab[] };
  edit: (s: { def: SceneDefinition; prefabs: Prefab[] }) => void;
  script: InputScript;
};

const CASES: Case[] = [
  {
    name: "engine-yard, its goal moved",
    before: () => ({ def: scene("engine-yard"), prefabs: [] }),
    edit: ({ def }) => {
      def.entities!.find((e) => e.id === "zone")!.shape = ["box", 1300, 930, 40, 30];
    },
    script: {
      v: 1,
      scene: "engine-yard",
      steps: [{ hold: ["right"], until: { event: GOAL_EVENT }, max: 600 }],
    },
  },
  {
    name: "kitchen-sink, its post prefab taller",
    before: () => ({ def: scene("kitchen-sink"), prefabs: homePrefabs() }),
    edit: ({ prefabs }) => {
      prefabs.find((p) => p.id === "post")!.entities[0]!.shape = ["box", 0, -80, 10, 80];
    },
    script: { v: 1, scene: "kitchen-sink", steps: [{ wait: 120 }] },
  },
];

describe.each(CASES)("loadHeadless by snapshot: $name", ({ before, edit, script }) => {
  it("loads two snapshots of one scene side by side, and each replays its own recording", async () => {
    const store = memoryContentStore();
    const a = before();
    const b = structuredClone(a);
    edit(b);
    const snapA = await snapshotOf(store, a.def, a.prefabs);
    const snapB = await snapshotOf(store, b.def, b.prefabs);
    expect(snapB.hash).not.toBe(snapA.hash);

    const id = a.def.name;
    const [loadA, loadB] = await Promise.all([
      loadHeadless({ snapshot: snapA, store, scene: id, registry: plain }),
      loadHeadless({ snapshot: snapB, store, scene: id, registry: plain }),
    ]);
    expect(loadA.snapshot).toBe(snapA.hash);
    expect(loadB.snapshot).toBe(snapB.hash);
    expect(loadA.project?.settings).toEqual({ avatarSpeed: AVATAR_SPEED });
    for (const loaded of [loadA, loadB]) expect(loaded.project?.flow).toEqual(ENGINE_FLOW);
    expect(loadA.sceneHash).not.toBe(loadB.sceneHash);

    const recA = play(loadA, script).recording;
    const recB = play(loadB, script).recording;
    expect(recA.sceneHash).toBe(loadA.sceneHash);
    expect(recB.sceneHash).toBe(loadB.sceneHash);

    for (const [loaded, rec] of [
      [loadA, recA],
      [loadB, recB],
    ] as const) {
      const r = replay(loaded, JSON.parse(JSON.stringify(rec)));
      expect(r.matches, r.divergence ?? "").toBe(true);
      expect(r.stale).toBe(false);
      expect(r.warnings).toEqual([]);
      expect(r.recording).toEqual(rec);
    }
    expect(replay(loadB, recA).stale).toBe(true);
    expect(replay(loadA, recB).stale).toBe(true);
  });

  it("loads the same scene from files as from the snapshot", async () => {
    const store = memoryContentStore();
    const { def, prefabs } = before();
    const snap = await snapshotOf(store, def, prefabs);
    const bySnapshot = await loadHeadless({
      snapshot: snap,
      store,
      scene: def.name,
      registry: plain,
    });
    const unused = { ...(prefabs[0] ?? prefab("post")), id: "unused" };
    const byFiles = await loadHeadless({
      files: {
        scene: formatScene(def).text,
        prefabs: [...prefabs.map((p) => formatPrefab(p)), unused],
      },
      registry,
    });
    expect(byFiles.snapshot).toBeNull();
    expect(byFiles.scene).toEqual(bySnapshot.scene);
    expect(byFiles.prefabs).toEqual(bySnapshot.prefabs);
    expect(byFiles.sceneHash).toBe(bySnapshot.sceneHash);
  });
});

describe("loadHeadless", () => {
  it("passes the project view through, and never reads a blob", async () => {
    const reads: string[] = [];
    const inner = memoryContentStore();
    const store: ContentStore = {
      ...inner,
      get: (hash) => {
        reads.push(hash);
        return inner.get(hash);
      },
    };
    const def = scene("engine-yard");
    const snap = await snapshotOf(store, def, []);
    const withBlob: ProjectSnapshot = {
      ...snap,
      assets: {
        ...snap.assets,
        hero: { key: "hero", kind: "texture", path: "art/hero.png", sha256: "f".repeat(64) },
      },
    };
    const project = {
      settings: {},
      engine: {},
      table: () => [],
      asset: () => undefined,
      inputMap: null,
    };
    const loaded = await loadHeadless({
      snapshot: withBlob,
      store,
      scene: def.name,
      registry: plain,
      project,
    });
    expect(loaded.project).toBe(project);
    expect(reads).toEqual([snap.assets[def.name]!.sha256, snap.assets.bouncy!.sha256]);
  });

  it("throws a SnapshotError for a scene the snapshot lacks, a SceneParseError for a bad file", async () => {
    const store = memoryContentStore();
    const snap = await snapshotOf(store, scene("engine-yard"), []);
    await expect(
      loadHeadless({ snapshot: snap, store, scene: "nowhere", registry: plain }),
    ).rejects.toThrow(SnapshotError);
    await expect(loadHeadless({ files: { scene: "{" }, registry })).rejects.toThrow(
      SceneParseError,
    );
  });
});

describe("loadHeadless by snapshot, with a real texture", () => {
  const png = (name: string) =>
    new Uint8Array(
      readFileSync(new URL(`../../project/__tests__/fixtures/${name}`, import.meta.url)),
    );

  /** The kitchen sink's snapshot beside a texture pinned by `bytes`, inspected by the engine's texture kind. */
  async function withTexture(store: ContentStore, bytes: Uint8Array) {
    const snap = await snapshotOf(store, scene("kitchen-sink"), homePrefabs());
    const hero = entry("hero", "texture", "art/hero.png");
    const inspected = textureKind.inspect(bytes, {}, { path: hero.path, idAt: () => undefined });
    if (!inspected.ok) throw new Error(inspected.issue.message);
    const sha256 = await store.put(bytes);
    const view = projectView({
      meta: { projectId: "engine", layout: 1, name: "Engine" },
      assets: {
        ...Object.fromEntries(
          Object.entries(snap.assets).map(([id, a]) => [a.key, entry(id, a.kind, a.path)]),
        ),
        hero: {
          ...hero,
          sha256,
          bytes: bytes.length,
          meta: inspected.meta as Record<string, unknown>,
        },
      },
      history: {},
      code: {},
      build: {},
    });
    const texts = new Map<AssetId, string>();
    for (const [id, a] of Object.entries(snap.assets))
      texts.set(id, new TextDecoder().decode((await store.get(a.sha256))!));
    return snapshotProject(view, texts, {});
  }

  it("two snapshots that differ in the texture's bytes load the same scene side by side, sized from their pins, reading no blob", async () => {
    const inner = memoryContentStore();
    const reads: string[] = [];
    const store: ContentStore = {
      ...inner,
      get: (hash) => {
        reads.push(hash);
        return inner.get(hash);
      },
    };
    const snapA = await withTexture(store, png("hero.png"));
    const snapB = await withTexture(store, png("texture.png"));
    expect(snapB.hash).not.toBe(snapA.hash);
    expect(snapA.assets.hero!.sha256).not.toBe(snapB.assets.hero!.sha256);
    reads.length = 0;

    const load = (snapshot: ProjectSnapshot) =>
      loadHeadless({ snapshot, store, scene: "kitchen-sink", registry: plain });
    const [loadA, loadB] = await Promise.all([load(snapA), load(snapB)]);
    expect([loadA.snapshot, loadB.snapshot]).toEqual([snapA.hash, snapB.hash]);
    expect(loadB.sceneHash).toBe(loadA.sceneHash);
    expect(loadB.scene).toEqual(loadA.scene);
    const blobs = new Set([snapA.assets.hero!.sha256, snapB.assets.hero!.sha256]);
    expect(reads.filter((h) => blobs.has(h))).toEqual([]);
    const sizeOf = (s: ProjectSnapshot) => {
      const meta = s.assets.hero!.meta as { width: number; height: number };
      return [meta.width, meta.height];
    };
    expect(loadA.project?.asset("hero")).toEqual({
      id: "hero",
      kind: "texture",
      sha256: snapA.assets.hero!.sha256,
      bytes: png("hero.png").length,
      size: sizeOf(snapA),
    });
    expect(sizeOf(snapA)[0]).toBeGreaterThan(0);
    expect(loadB.project?.asset("hero")?.sha256).toBe(snapB.assets.hero!.sha256);
    expect(loadB.project?.asset("hero")?.size).toEqual(sizeOf(snapB));

    const script: InputScript = { v: 1, scene: "kitchen-sink", steps: [{ wait: 60 }] };
    const recA = play(loadA, script).recording;
    const r = replay(loadB, JSON.parse(JSON.stringify(recA)));
    expect(r.matches, r.divergence ?? "").toBe(true);
    expect(r.stale).toBe(false);
  });
});

describe("loadHeadless by snapshot, with a material edited between two", () => {
  const script: InputScript = { v: 1, scene: "kitchen-sink", steps: [{ wait: 120 }] };
  const slick = { ...BOUNCY, physics: { friction: 0, restitution: 0.1 } };

  it("pins each snapshot's own material, and each replays its own recording", async () => {
    const store = memoryContentStore();
    const a = { def: scene("kitchen-sink"), prefabs: homePrefabs() };
    const snapA = await snapshotOf(store, a.def, a.prefabs);
    const snapB = await snapshotOf(store, a.def, a.prefabs, { bouncy: slick });
    expect(snapB.hash).not.toBe(snapA.hash);
    expect(
      Object.keys(snapA.assets).filter(
        (id) => snapA.assets[id]!.sha256 !== snapB.assets[id]!.sha256,
      ),
    ).toEqual(["bouncy"]);

    const load = (snapshot: ProjectSnapshot) =>
      loadHeadless({ snapshot, store, scene: "kitchen-sink", registry: plain });
    const [loadA, loadB] = await Promise.all([load(snapA), load(snapB)]);
    expect(loadA.registry.materials.get("bouncy")).toMatchObject(BOUNCY.physics);
    expect(loadB.registry.materials.get("bouncy")).toMatchObject(slick.physics);
    expect(loadB.scene).toEqual(loadA.scene);

    for (const loaded of [loadA, loadB]) {
      const rec = play(loaded, script).recording;
      const r = replay(loaded, JSON.parse(JSON.stringify(rec)));
      expect(r.matches, r.divergence ?? "").toBe(true);
      expect(r.warnings).toEqual([]);
      expect(r.recording).toEqual(rec);
    }
  });

  it("never takes a material from the caller's registry over the snapshot's", async () => {
    const store = memoryContentStore();
    const def = scene("kitchen-sink");
    const snapA = await snapshotOf(store, def, homePrefabs());
    const edited = withProject(
      plain,
      projectView({
        meta: { projectId: "engine", layout: 1, name: "Engine" },
        assets: Object.fromEntries(homeMaterials.entries.map((e) => [e.key, e])),
        history: {},
        code: {},
        build: {},
      }),
      new Map([["bouncy", slick]]),
    );
    expect(edited.materials.get("bouncy")).toMatchObject(slick.physics);
    const loaded = await loadHeadless({
      snapshot: snapA,
      store,
      scene: "kitchen-sink",
      registry: edited,
    });
    expect(loaded.registry.materials.get("bouncy")).toMatchObject(BOUNCY.physics);
  });
});
