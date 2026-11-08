import { readdirSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createRegistry, withProject } from "../../game/define";
import { formatPrefab, formatScene } from "../../scene/format";
import { parseScene } from "../../scene/parse";
import { parsePrefab } from "../../scene/prefab";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { ENGINE_VERSION } from "../../version";
import { stableJson } from "../canonical";
import { memoryContentStore, type ContentStore } from "../content-store";
import { isSha256, sha256 } from "../hash";
import { inspectEntry } from "../inspect/entry";
import {
  createKindRegistry,
  defineAssetKind,
  formatAssetDoc,
  parseAssetDoc,
  type BlobKindDef,
  type DocKindDef,
  type KindEnv,
} from "../kinds";
import { ENGINE_ASSET_KINDS } from "../kinds/index";
import type { RefSite } from "../refs";
import {
  checkSnapshot,
  formatProjectSnapshot,
  parseProjectSnapshot,
  snapshotProject,
  snapshotScene,
  snapshotView,
  SnapshotError,
  type ProjectSnapshot,
} from "../snapshot";
import type { AssetEntry, AssetId, ProjectState, ProjectView } from "../types";
import { projectView } from "../view";
import { engineHomeMaterials, engineHomeRegistry } from "./fixtures/engine-home";

const scenes = new URL("../../scenes/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, scenes), "utf8");
const registry = engineHomeRegistry();
const materials = engineHomeMaterials();

const sinkDef = (): SceneDefinition => {
  const parsed = parseScene(read("kitchen-sink.json"), registry);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  // Its sprites name the engine home's art, which this synthetic project doesn't hold.
  return { ...parsed.def, entities: parsed.def.entities?.map(({ behaviors: _, ...e }) => e) };
};
/** Every prefab of the engine's home, which the kitchen sink reaches through instances, nesting and bases. */
const PREFAB_IDS = readdirSync(new URL("prefabs/", scenes))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();
const prefabDef = (id: string): Prefab => {
  const parsed = parsePrefab(read(`prefabs/${id}.json`), registry);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.prefab;
};

type Skin = { kind: "skin"; v: 1; texture: string };
/** A doc that names a texture, so references into blobs are covered. */
const skinKind = defineAssetKind({
  kind: "skin",
  title: "Skin",
  description: "A test doc naming a texture.",
  match: { jsonKind: "skin" },
  storage: "doc",
  version: 1,
  schemaId: "urn:test:skin:v1",
  schema: () => z.strictObject({ kind: z.literal("skin"), v: z.literal(1), texture: z.string() }),
  layout: { as: "map" },
  empty: () => ({ kind: "skin", v: 1, texture: "" }),
  refs: (value: Skin): RefSite[] => [
    { pointer: "/texture", id: value.texture, kinds: ["texture"] },
  ],
});

const kinds = createKindRegistry(null, [...ENGINE_ASSET_KINDS, skinKind]);
const env: KindEnv = { registry, project: null };

const skinText = (texture: string) =>
  `${JSON.stringify({ kind: "skin", v: 1, texture }, null, 2)}\n`;

const entry = (
  id: AssetId,
  kind: string,
  path: string,
  extra: Partial<AssetEntry> = {},
): AssetEntry => ({ key: id, id, kind, path, created: { at: 1, by: "test" }, ...extra });

type Fixture = {
  view: ProjectView;
  texts: Map<AssetId, string>;
  build: ProjectState["build"];
  heroHash: string;
};

async function fixture(
  opts: {
    drop?: string[];
    post?: Prefab;
    heroBytes?: string;
    created?: number;
    sheetImport?: Record<string, unknown>;
  } = {},
): Promise<Fixture> {
  const heroHash = await sha256(opts.heroBytes ?? "hero pixels");
  const created = { at: opts.created ?? 1, by: "test" };
  const entries = [
    entry("kitchen-sink", "scene", "scenes/kitchen-sink.json", { created }),
    ...PREFAB_IDS.map((id) => entry(id, "prefab", `scenes/prefabs/${id}.json`, { created })),
    entry("cards", "data-table", "scenes/data/cards.json", { created }),
    entry("hero", "texture", "art/hero.png", {
      created,
      sha256: heroHash,
      bytes: 11,
      meta: { width: 16, height: 16 },
    }),
    entry("hero-skin", "skin", "art/hero.skin.json", { created }),
    ...materials.entries.map((m) => ({ ...m, created })),
    entry("hero-sheet", "atlas", "art/hero.atlas.json", {
      created,
      sha256: await sha256("hero sheet"),
      bytes: 10,
      import: opts.sheetImport ?? { texture: "hero", pivotDefault: [0.5, 1] },
    }),
  ].filter((e) => !opts.drop?.includes(e.id));
  const view = projectView(
    {
      meta: { projectId: "engine", layout: 1, name: "Engine" },
      assets: Object.fromEntries(entries.map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    kinds,
  );
  const texts = new Map<AssetId, string>([
    ["kitchen-sink", formatScene(sinkDef()).text],
    ...PREFAB_IDS.map((id): [AssetId, string] => [
      id,
      formatPrefab((id === "post" ? opts.post : undefined) ?? prefabDef(id)),
    ]),
    [
      "cards",
      formatAssetDoc(kinds.get("data-table") as DocKindDef, JSON.parse(read("data/cards.json"))),
    ],
    ["hero-skin", skinText("hero")],
    ...[...materials.values].map(([id, value]): [AssetId, string] => [
      id,
      formatAssetDoc(kinds.get("material") as DocKindDef, value),
    ]),
  ]);
  const build = {
    scene: { hash: await sha256("scene schema"), buildAt: 5, engine: ENGINE_VERSION },
  };
  return { view, texts, build, heroHash };
}

async function storeOf(texts: ReadonlyMap<AssetId, string>): Promise<ContentStore> {
  const store = memoryContentStore();
  for (const text of texts.values()) await store.put(new TextEncoder().encode(text));
  return store;
}

const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("snapshotProject", () => {
  it("pins docs by their canonical text's hash and blobs by their content hash, size and meta", async () => {
    const f = await fixture();
    const snap = await snapshotProject(f.view, f.texts, f.build);
    expect(snap).toMatchObject({ kind: "project-snapshot", v: 1, project: "engine" });
    expect(snap.engine).toBe(ENGINE_VERSION);
    expect(snap.build).toEqual({ scene: f.build.scene!.hash });
    expect(Object.keys(snap.assets).sort()).toEqual(
      [
        "cards",
        "hero",
        "hero-sheet",
        "hero-skin",
        "kitchen-sink",
        ...PREFAB_IDS,
        ...materials.values.keys(),
      ].sort(),
    );
    expect(snap.assets.post).toEqual({
      key: "post",
      kind: "prefab",
      path: "scenes/prefabs/post.json",
      sha256: await sha256(f.texts.get("post")!),
    });
    expect(snap.assets.hero).toEqual({
      key: "hero",
      kind: "texture",
      path: "art/hero.png",
      sha256: f.heroHash,
      bytes: 11,
      meta: { width: 16, height: 16 },
    });
    expect(snap.assets["hero-sheet"]!.import).toEqual({ texture: "hero", pivotDefault: [0.5, 1] });
    expect(snap.assets["hero-sheet"]!.meta).toBeUndefined();
    expect(isSha256(snap.hash)).toBe(true);
    const back = snapshotView(snap, kinds).byId.get("hero");
    expect(back).toMatchObject({ bytes: 11, meta: { width: 16, height: 16 } });
    expect(snapshotView(snap, kinds).byId.get("post")?.meta).toBeUndefined();
  });

  it("refuses a live doc with no text", async () => {
    const f = await fixture();
    f.texts.delete("gate");
    await expect(snapshotProject(f.view, f.texts, f.build)).rejects.toThrow(/"gate"/);
  });

  it("every reference resolves to a hash in the snapshot (scenes, prefabs and textures)", async () => {
    const f = await fixture();
    const snap = await snapshotProject(f.view, f.texts, f.build);
    const store = await storeOf(f.texts);
    const sites: RefSite[] = [];
    for (const [id, asset] of Object.entries(snap.assets)) {
      const def = kinds.get(asset.kind)!;
      if (def.storage === "blob") {
        const pinned = { ...asset, id, created: { at: 0, by: "" } };
        sites.push(...(def.refs?.({ ...pinned, import: { ...asset.import } }) ?? []));
        continue;
      }
      if (def.storage !== "doc") continue;
      const bytes = await store.get(asset.sha256);
      expect(bytes, id).not.toBeNull();
      const parsed = parseAssetDoc(def, new TextDecoder().decode(bytes!), env);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      sites.push(...(def.refs?.(parsed.value, env) ?? []));
    }
    const named = new Set(sites.map((s) => s.id));
    expect([...named]).toEqual(expect.arrayContaining(["gate", "hero", "post"]));
    expect(
      sites.some((s) => s.kinds.includes("material")),
      "the scene names a material asset",
    ).toBe(true);
    for (const site of sites) {
      const target = snap.assets[site.id];
      expect(target, site.id).toBeDefined();
      // An `assets` header names an id of any kind, so its sites list none.
      if (site.kinds.length > 0) expect(site.kinds).toContain(target!.kind);
      expect(isSha256(target!.sha256)).toBe(true);
    }
    expect(await checkSnapshot(snap, store, kinds, env)).toEqual([]);
  });

  it("gives equal content an equal hash whatever `at`, entry order or creation time", async () => {
    const a = await fixture();
    const b = await fixture({
      created: 99,
      sheetImport: { pivotDefault: [0.5, 1], texture: "hero" },
    });
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    const first = await snapshotProject(a.view, a.texts, a.build);
    const second = await snapshotProject(b.view, new Map([...b.texts].reverse()), b.build);
    expect(first.at).toBe(1_000);
    expect(second.at).toBe(2_000);
    expect(second.hash).toBe(first.hash);
    expect(second.assets).toEqual(first.assets);
  });

  it("changes the hash with a doc's text, a blob's bytes or its import, and only that asset's entry", async () => {
    const a = await snapshotProject(...args(await fixture()));
    const moved = prefabDef("post");
    moved.entities[0]!.shape = ["box", 0, -70, 10, 70];
    const edited = await snapshotProject(...args(await fixture({ post: moved })));
    const repainted = await snapshotProject(...args(await fixture({ heroBytes: "new pixels" })));
    const resliced = await snapshotProject(
      ...args(await fixture({ sheetImport: { texture: "hero", pivotDefault: [0, 0] } })),
    );
    const changed = (s: ProjectSnapshot) =>
      Object.keys(a.assets).filter(
        (id) => JSON.stringify(a.assets[id]) !== JSON.stringify(s.assets[id]),
      );
    for (const s of [edited, repainted, resliced]) expect(s.hash).not.toBe(a.hash);
    expect(changed(edited)).toEqual(["post"]);
    expect(changed(repainted)).toEqual(["hero"]);
    expect(changed(resliced)).toEqual(["hero-sheet"]);
  });
});

const args = (f: Fixture) => [f.view, f.texts, f.build] as const;

describe("checkSnapshot", () => {
  it("reports a reference to an asset the snapshot lacks as asset-missing", async () => {
    const f = await fixture({ drop: ["gate", "hero"] });
    f.texts.delete("gate");
    const snap = await snapshotProject(...args(f));
    const issues = await checkSnapshot(snap, await storeOf(f.texts), kinds, env);
    expect(codes(issues)).toEqual(Array(4).fill("asset-missing"));
    expect(issues.map((i) => [i.entityIds[0], i.got, i.path])).toEqual([
      ["hero-sheet", "hero", "/import/texture"],
      ["hero-skin", "hero", "/texture"],
      ["kitchen-sink", "gate", "/instances/@gate-1/prefab"],
      ["kitchen-sink", "gate", "/instances/@gate-2/prefab"],
    ]);
  });

  it("reports a doc whose text the store lacks, or whose bytes don't hash to the pin", async () => {
    const f = await fixture();
    const snap = await snapshotProject(...args(f));
    const texts = new Map(f.texts);
    texts.delete("post");
    const missing = await checkSnapshot(snap, await storeOf(texts), kinds, env);
    expect(missing).toEqual([
      expect.objectContaining({ code: "asset-missing", entityIds: ["post"] }),
    ]);

    const full = await storeOf(f.texts);
    const lying: ContentStore = {
      ...full,
      get: async (hash) =>
        hash === snap.assets.post!.sha256 ? new TextEncoder().encode("{}") : full.get(hash),
    };
    const mismatch = await checkSnapshot(snap, lying, kinds, env);
    expect(mismatch).toEqual([
      expect.objectContaining({ code: "hash-mismatch", entityIds: ["post"] }),
    ]);
  });

  it("reports a tampered hash, an unregistered kind and a doc that doesn't parse", async () => {
    const f = await fixture();
    const snap = await snapshotProject(...args(f));
    const store = await storeOf(f.texts);
    const broken = {
      ...snap.assets["hero-skin"]!,
      sha256: await store.put(enc('{"kind":"skin"}')),
    };
    const tampered: ProjectSnapshot = {
      ...snap,
      assets: { ...snap.assets, "hero-skin": broken, odd: { ...broken, kind: "odd", key: "odd" } },
    };
    const issues = await checkSnapshot(tampered, store, kinds, env);
    expect(issues[0]).toMatchObject({ code: "hash-mismatch", path: "/hash" });
    expect(codes(issues)).toContain("asset-kind");
    expect(issues.find((i) => i.code === "schema")?.entityIds[0]).toBe("hero-skin");
  });
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("snapshotScene", () => {
  it("reads the scene and the prefabs it places from the store", async () => {
    const f = await fixture();
    const snap = await snapshotProject(...args(f));
    const { def, prefabs } = await snapshotScene(
      snap,
      "kitchen-sink",
      await storeOf(f.texts),
      registry,
    );
    expect(def).toEqual(sinkDef());
    expect([...prefabs.keys()].sort()).toEqual(PREFAB_IDS);
    expect(prefabs.get("post")).toEqual(prefabDef("post"));
  });

  it("throws a SnapshotError for a missing prefab, a wrong kind or missing text", async () => {
    const f = await fixture({ drop: ["gate"] });
    f.texts.delete("gate");
    const snap = await snapshotProject(...args(f));
    const store = await storeOf(f.texts);
    const fail = async (id: string, s: ContentStore = store) => {
      const error = await snapshotScene(snap, id, s, registry).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SnapshotError);
      return (error as SnapshotError).issues.map((i) => [i.code, i.entityIds[0]]);
    };
    expect(await fail("kitchen-sink")).toEqual([["asset-missing", "gate"]]);
    expect(await fail("post")).toEqual([["asset-kind", "post"]]);
    expect(await fail("nowhere")).toEqual([["asset-missing", "nowhere"]]);
    expect(await fail("kitchen-sink", memoryContentStore())).toEqual([
      ["asset-missing", "kitchen-sink"],
    ]);
  });
});

describe("a snapshot's materials", () => {
  const bouncy = materials.values.get("bouncy") as { physics: Record<string, number> };
  const plain = createRegistry(null);
  /** The engine's registry with a `bouncy` of other physics overlaid, as files edited after a snapshot would give. */
  const edited = withProject(
    plain,
    projectView({
      meta: { projectId: "engine", layout: 1, name: "Engine" },
      assets: { bouncy: materials.entries.find((e) => e.id === "bouncy")! },
      history: {},
      code: {},
      build: {},
    }),
    new Map([["bouncy", { ...bouncy, physics: { friction: 0, restitution: 0.1 } }]]),
  );

  it("are what its scene parses and checks by, whatever registry the caller passes", async () => {
    const f = await fixture();
    const snap = await snapshotProject(...args(f));
    const store = await storeOf(f.texts);
    for (const caller of [plain, edited]) {
      expect(await checkSnapshot(snap, store, kinds, { registry: caller, project: null })).toEqual(
        [],
      );
      const read = await snapshotScene(snap, "kitchen-sink", store, caller);
      expect(read.def).toEqual(sinkDef());
      expect(read.registry.materials.get("bouncy")).toMatchObject(bouncy.physics);
    }
  });

  it("leave a material the snapshot lacks unknown, even to a caller whose registry has it", async () => {
    const f = await fixture({ drop: ["bouncy"] });
    f.texts.delete("bouncy");
    const snap = await snapshotProject(...args(f));
    const store = await storeOf(f.texts);
    const issues = await checkSnapshot(snap, store, kinds, env);
    expect(issues.map((i) => [i.code, i.entityIds[0], i.path, i.message])).toEqual([
      [
        "schema",
        "kitchen-sink",
        "/entities/0/material",
        '/entities/0/material: unknown material "bouncy": this project and game define no materials',
      ],
    ]);
    const error = await snapshotScene(snap, "kitchen-sink", store, registry).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SnapshotError);
    expect((error as SnapshotError).message).toContain('unknown material "bouncy"');
  });
});

describe("parseProjectSnapshot", () => {
  it("reads back what formatProjectSnapshot writes, and refuses a hash the content doesn't give", async () => {
    const snap = await snapshotProject(...args(await fixture()));
    const text = formatProjectSnapshot(snap);
    expect(await parseProjectSnapshot(text)).toEqual({ ok: true, snapshot: snap });
    const other = { ...snap, at: snap.at + 1 };
    expect((await parseProjectSnapshot(other)).ok).toBe(true);
    const edited = { ...snap, project: "other" };
    const result = await parseProjectSnapshot(edited);
    expect(result.ok ? [] : codes(result.issues)).toEqual(["hash-mismatch"]);
    const bad = await parseProjectSnapshot({ ...snap, assets: { Bad: snap.assets.post } });
    expect(bad.ok).toBe(false);
  });
});

describe("snapshot pinning over the real texture kind", () => {
  const bytesOf = (name: string) =>
    new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

  /** The kitchen sink beside a real texture and the atlas cutting it, each inspected by its kind; bytes put in `store`. */
  async function project(store: ContentStore, png: Uint8Array) {
    const f = await fixture({ drop: ["hero", "hero-sheet"] });
    const blob = async (id: AssetId, path: string, bytes: Uint8Array) => {
      const def = kinds.get(path.endsWith(".png") ? "texture" : "atlas") as BlobKindDef;
      const e = entry(id, def.kind, path, { sha256: await store.put(bytes), bytes: bytes.length });
      const inspected = inspectEntry(def, e, bytes, (p) =>
        p === "art/hero.png" ? "hero" : undefined,
      );
      if (!inspected.ok) throw new Error(inspected.issue.message);
      return {
        ...e,
        meta: inspected.meta as Record<string, unknown>,
        ...(inspected.import ? { import: inspected.import } : {}),
      };
    };
    const assets = Object.fromEntries(
      [
        ...f.view.byId.values(),
        await blob("hero", "art/hero.png", png),
        await blob("hero-sheet", "art/hero.atlas.json", bytesOf("hero.json")),
      ].map((e) => [e.key, e]),
    );
    const view = projectView({ ...f.view.state, assets }, kinds);
    for (const text of f.texts.values()) await store.put(enc(text));
    return { view, texts: f.texts, build: f.build };
  }

  it("pins a texture by its bytes, resolves the atlas to it, and two snapshots of one scene read side by side", async () => {
    const store = memoryContentStore();
    const png = bytesOf("hero.png");
    const a = await project(store, png);
    const snapA = await snapshotProject(a.view, a.texts, a.build);
    expect(snapA.assets.hero).toEqual({
      key: "hero",
      kind: "texture",
      path: "art/hero.png",
      sha256: await sha256(png),
      bytes: png.length,
      meta: a.view.byId.get("hero")!.meta,
    });
    expect(snapA.assets["hero-sheet"]!.import).toMatchObject({ texture: "hero" });
    expect(await checkSnapshot(snapA, store, kinds, env)).toEqual([]);

    for (const [id, pinned] of Object.entries(snapA.assets)) {
      const def = kinds.get(pinned.kind)!;
      if (def.storage !== "blob") continue;
      const held = await store.get(pinned.sha256);
      expect(held && (await sha256(held)), id).toBe(pinned.sha256);
      const again = inspectEntry(def as BlobKindDef, pinned, held!, () => "hero");
      expect(again.ok && again.meta, `${id}: the pinned bytes give the entry's meta`).toEqual(
        a.view.byId.get(id)!.meta,
      );
    }

    const other = bytesOf("texture.png");
    const b = await project(store, other);
    const snapB = await snapshotProject(b.view, b.texts, b.build);
    expect(snapB.hash).not.toBe(snapA.hash);
    expect(
      Object.keys(snapA.assets).filter(
        (id) => stableJson(snapA.assets[id]) !== stableJson(snapB.assets[id]),
      ),
    ).toEqual(["hero"]);
    expect(snapB.assets.hero!.sha256).toBe(await sha256(other));
    expect(await checkSnapshot(snapB, store, kinds, env)).toEqual([]);

    const read = (s: ProjectSnapshot) => snapshotScene(s, "kitchen-sink", store, registry);
    const [sceneA, sceneB] = await Promise.all([read(snapA), read(snapB)]);
    expect(sceneB.def).toEqual(sceneA.def);
    expect(sceneB.prefabs).toEqual(sceneA.prefabs);
    expect(sceneA.def).toEqual(sinkDef());
  });
});
