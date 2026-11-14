import { readFileSync, writeFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { measureBudget } from "../export/budget";
import { planContent } from "../export/content";
import { finishExport, type BuiltCode, type ExportInput } from "../export/plan";
import { createRegistry, withProject } from "../game/define";
import { stableJson } from "../project/canonical";
import { memoryContentStore } from "../project/content-store";
import { sha256 } from "../project/hash";
import {
  checkReleaseManifest,
  findRelease,
  formatReleaseManifest,
  parseReleaseManifest,
  RELEASE_SCHEMA_ID,
  releaseBuildHash,
  releaseId,
  releaseJsonSchema,
  releaseSnapshot,
  type ReleaseAsset,
  type ReleaseFile,
  type ReleaseManifest,
} from "../project/release";
import { heldProject, type HeldFile } from "../project/runtime-view";
import type { AssetSidecar } from "../project/sidecar";
import {
  jsonValues,
  parseProjectSnapshot,
  snapshotProject,
  snapshotScene,
} from "../project/snapshot";
import type { AssetEntry, AssetId, ProjectFile, Sha256 } from "../project/types";
import { projectView } from "../project/view";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { undescribedProperties } from "../scene/json-schema";
import { parseScene } from "../scene/parse";
import type { SceneIssue } from "../scene/types";
import { manifestRuntimeView, manifestView } from "../standalone/manifest-view";
import { ENGINE_VERSION } from "../version";
import { testGame } from "./fixtures/test-game";

const SCHEMA_FILE = new URL("../project/release.schema.json", import.meta.url);

type Fixture = {
  manifest: ReleaseManifest;
  /** Every file of the build by path, as its hash. */
  files: Map<string, Sha256>;
  /** The view and texts the snapshot was taken from. */
  view: ReturnType<typeof projectView>;
  texts: Map<AssetId, string>;
};

const DOCS: Record<AssetId, { kind: string; path: string; text: string }> = {
  menu: { kind: "scene", path: "scenes/menu.json", text: '{ "kind": "scene", "id": "menu" }\n' },
  "level-1": {
    kind: "scene",
    path: "scenes/level-1.json",
    text: '{ "kind": "scene", "id": "level-1" }\n',
  },
  knight: { kind: "prefab", path: "prefabs/knight.json", text: '{ "kind": "prefab" }\n' },
};
const BLOBS: Record<AssetId, { path: string; bytes: string }> = {
  tiles: { path: "art/tiles.png", bytes: "tile pixels" },
  units: { path: "art/units.png", bytes: "unit pixels, a few more" },
};

async function fixture(): Promise<Fixture> {
  const files: ReleaseFile[] = [];
  const add = async (path: string, text: string, role: ReleaseFile["role"]) => {
    const sha = await sha256(text);
    files.push({ path, sha256: sha, bytes: new TextEncoder().encode(text).length, role });
    return sha;
  };
  const assets: Record<AssetId, ReleaseAsset> = {};
  const entries: Record<string, AssetEntry> = {};
  const texts = new Map<AssetId, string>();
  let k = 0;
  for (const [id, doc] of Object.entries(DOCS)) {
    const sha = await sha256(doc.text);
    const file = `data/${sha}.json`;
    await add(file, doc.text, "data");
    const key = `k${++k}`;
    assets[id] = {
      key,
      kind: doc.kind,
      path: doc.path,
      sha256: sha,
      bytes: doc.text.length,
      storage: "doc",
      file,
    };
    entries[key] = { key, id, kind: doc.kind, path: doc.path, created: { at: 0, by: "" } };
    texts.set(id, doc.text);
  }
  for (const [id, blob] of Object.entries(BLOBS)) {
    const sha = await sha256(blob.bytes);
    const file = `assets/${sha}.png`;
    await add(file, blob.bytes, "asset");
    const key = `k${++k}`;
    const meta = { format: "png", width: 16, height: 16 };
    const settings = { filter: "nearest" };
    assets[id] = {
      key,
      kind: "texture",
      path: blob.path,
      sha256: sha,
      bytes: blob.bytes.length,
      storage: "blob",
      file,
      meta,
      import: settings,
      licence: { spdx: "CC0-1.0", author: "The fixture's authors" },
    };
    entries[key] = {
      key,
      id,
      kind: "texture",
      path: blob.path,
      sha256: sha,
      bytes: blob.bytes.length,
      meta,
      import: settings,
      created: { at: 0, by: "" },
    };
  }
  await add("code/main-3f9a1c.js", "console.log('game')", "code");
  await add("code/style-77b0.css", "body{margin:0}", "style");
  await add("index.html", "<!doctype html>", "shell");
  await add("credits.html", "<!doctype html><h1>Credits</h1>", "shell");
  await add("app.webmanifest", "{}", "shell");
  await add("sw.js", "self.addEventListener('fetch', () => {})", "worker");
  await add("icons/icon-192.png", "icon 192", "icon");
  await add("icons/icon-512.png", "icon 512", "icon");

  const view = projectView({
    meta: { projectId: "fixture", layout: 1, name: "Fixture" },
    assets: entries,
    history: {},
    code: {},
    build: {},
  });
  const snapshot = await snapshotProject(view, texts, {});
  const flow: ReleaseManifest["flow"] = {
    start: "menu",
    scenes: [
      {
        id: "menu",
        title: "Title",
        physics: "none",
        prefabs: [],
        bundle: { entries: ["tiles"], bytes: assets.tiles!.bytes },
      },
      {
        id: "level-1",
        title: "Ford",
        physics: "none",
        prefabs: ["knight"],
        bundle: { entries: ["tiles", "units"], bytes: assets.tiles!.bytes + assets.units!.bytes },
      },
    ],
  };
  const projectBundle = { entries: [], bytes: 0 };
  const limits = {
    codeBytes: 4194304,
    firstLoadBytes: 16777216,
    totalBytes: 104857600,
    fileBytes: 33554432,
  };
  const manifest: ReleaseManifest = {
    $schema: "./release.schema.json",
    kind: "release",
    v: 1,
    engine: {
      version: ENGINE_VERSION,
      agentSurface: AGENT_SURFACE_VERSION,
      formats: { scene: 4, prefab: 4, recording: 2, inputScript: 2, save: 1, collabLayout: 3 },
    },
    game: { id: "fixture", configHash: null, saveVersion: 1 },
    project: {
      id: "fixture",
      name: "Fixture",
      snapshot: snapshot.hash,
      snapshotEngine: snapshot.engine,
      build: {},
    },
    build: {
      hash: await releaseBuildHash(files),
      target: "web",
      rapier: null,
      entry: "code/main-3f9a1c.js",
      files,
    },
    time: { kind: "turns", rate: 60, catchUp: null, wakeOnPointerMove: false },
    replay: { acrossPlatforms: true },
    flow,
    projectBundle,
    assets,
    credits: {
      assets: [{ assets: ["tiles", "units"], spdx: "CC0-1.0", author: "The fixture's authors" }],
      missing: [],
      code: [{ package: "zod", version: "4.1.11", licence: "MIT", notice: "MIT License" }],
    },
    budget: measureBudget(
      files,
      { start: "menu", scenes: flow.scenes, projectBundle, assets },
      limits,
    ),
    pwa: {
      name: "Fixture",
      shortName: "Fixture",
      display: "fullscreen",
      orientation: "landscape",
      themeColor: "#1b1f2a",
      background: "#0d0f14",
      icons: [
        { file: "icons/icon-192.png", size: 192 },
        { file: "icons/icon-512.png", size: 512 },
      ],
    },
  };
  return {
    manifest,
    files: new Map(files.map((f) => [f.path, f.sha256])),
    view,
    texts,
  };
}

let base: Fixture;
beforeAll(async () => {
  base = await fixture();
});

/** A deep copy of the fixture's manifest, changed by `edit`. */
function corrupt(edit: (m: ReleaseManifest) => void): ReleaseManifest {
  const m = structuredClone(base.manifest) as ReleaseManifest;
  edit(m);
  return m;
}

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
const mutable = <T>(v: T) => v as Mutable<T>;

const where = (issues: readonly SceneIssue[]) => issues.map((i) => [i.code, i.path]);

const fileIndex = (m: ReleaseManifest, path: string) =>
  m.build.files.findIndex((f) => f.path === path);

describe("urn:jams-engine:release:v1", () => {
  it("matches the committed file (UPDATE_SCHEMAS=1 regenerates)", () => {
    const schema = releaseJsonSchema();
    if (process.env.UPDATE_SCHEMAS)
      writeFileSync(SCHEMA_FILE, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(SCHEMA_FILE, "utf8"))).toEqual(schema);
  });

  it("has its URN, draft 2020-12, the agent surface and no domain", () => {
    const schema = releaseJsonSchema();
    expect(RELEASE_SCHEMA_ID).toBe("urn:jams-engine:release:v1");
    expect(schema.$id).toBe(RELEASE_SCHEMA_ID);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(JSON.stringify(schema)).not.toMatch(/brackeys\.(community|dev)|jams\.team/);
  });

  it("describes every property", () => {
    expect(undescribedProperties(releaseJsonSchema())).toEqual([]);
  });
});

describe("the canonical text", () => {
  it("round-trips a fixture manifest byte-identical", () => {
    const text = formatReleaseManifest(base.manifest);
    const parsed = parseReleaseManifest(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(formatReleaseManifest(parsed.manifest)).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("puts the type's keys in order, assets by id and files by path, each item on one line", () => {
    const shuffled = corrupt((m) => {
      mutable(m.build).files = [...m.build.files].reverse();
      mutable(m).assets = Object.fromEntries(Object.entries(m.assets).reverse()) as Mutable<
        ReleaseManifest["assets"]
      >;
    });
    const text = formatReleaseManifest(shuffled);
    expect(text).toBe(formatReleaseManifest(base.manifest));
    const lines = text.split("\n");
    const topKeys = lines.filter((l) => /^ {2}"/.test(l)).map((l) => /^ {2}"([^"]+)"/.exec(l)![1]);
    expect(topKeys).toEqual([
      "$schema",
      "kind",
      "v",
      "engine",
      "game",
      "project",
      "build",
      "time",
      "replay",
      "flow",
      "projectBundle",
      "assets",
      "credits",
      "budget",
      "pwa",
    ]);
    const filePaths = lines
      .filter((l) => l.startsWith('      { "path": '))
      .map((l) => /"path": "([^"]+)"/.exec(l)![1]!);
    expect(filePaths).toHaveLength(base.manifest.build.files.length);
    expect(filePaths).toEqual([...filePaths].sort());
    const assetIds = lines
      .filter((l) => /^ {4}"[a-z0-9-]+": \{ "key"/.test(l))
      .map((l) => /^ {4}"([^"]+)"/.exec(l)![1]);
    expect(assetIds).toEqual(["knight", "level-1", "menu", "tiles", "units"]);
    expect(lines.find((l) => l.includes('"tiles": {'))).toMatch(
      /^ {4}"tiles": \{ "key": "k4", "kind": "texture", "path": "art\/tiles.png", "sha256": "[0-9a-f]{64}", "bytes": 11, "storage": "blob", "file": "assets\/[0-9a-f]{64}.png", "meta": \{ "format": "png", "height": 16, "width": 16 \}, "import": \{ "filter": "nearest" \}, "licence": \{ "spdx": "CC0-1.0", "author": "The fixture's authors" \} \},$/,
    );
  });

  it("names a release by the SHA-256 of its text", async () => {
    const id = await releaseId(base.manifest);
    expect(id).toBe(await sha256(formatReleaseManifest(base.manifest)));
    expect(await releaseId(corrupt((m) => (mutable(m.build).target = "itch")))).not.toBe(id);
  });
});

describe("parseReleaseManifest", () => {
  it("refuses bad JSON, another kind, a newer format and unknown keys", () => {
    const text = formatReleaseManifest(base.manifest);
    const issues = (t: string) => {
      const r = parseReleaseManifest(t);
      return r.ok ? [] : r.issues.map((i) => i.code);
    };
    expect(issues("{")).toEqual(["schema"]);
    expect(issues(text.replace('"kind": "release"', '"kind": "project"'))).toEqual(["schema"]);
    expect(issues(text.replace('"v": 1,', '"v": 2,'))).toEqual(["version-newer"]);
    expect(issues(text.replace('"kind": "release",', '"kind": "release", "extra": 1,'))).toEqual([
      "unknown-key",
    ]);
  });
});

describe("releaseSnapshot", () => {
  it("rebuilds the snapshot the manifest was made from, at 0", async () => {
    const taken = await snapshotProject(base.view, base.texts, {});
    const rebuilt = releaseSnapshot(base.manifest);
    expect(rebuilt).toEqual({ ...taken, at: 0 });
  });
});

describe("checkReleaseManifest", () => {
  const check = (m: ReleaseManifest, files: ReadonlyMap<string, Sha256> = base.files) =>
    checkReleaseManifest(m, files);

  it("passes the fixture, with its files and the budget recomputed", async () => {
    expect(await checkReleaseManifest(base.manifest, base.files, { measureBudget })).toEqual([]);
    expect(await checkReleaseManifest(base.manifest)).toEqual([]);
  });

  it("fails a file whose bytes don't hash to its listing, and one that isn't there", async () => {
    const files = new Map(base.files);
    files.set("index.html", "0".repeat(64));
    const i = fileIndex(base.manifest, "index.html");
    expect(where(await check(base.manifest, files))).toEqual([
      ["hash-mismatch", `/build/files/${i}/sha256`],
    ]);
    files.delete("sw.js");
    files.set("index.html", base.files.get("index.html")!);
    expect(where(await check(base.manifest, files))).toEqual([
      ["export-asset-missing", `/build/files/${fileIndex(base.manifest, "sw.js")}/sha256`],
    ]);
  });

  it("fails a snapshot the assets don't reproduce", async () => {
    const m = corrupt((m) => (mutable(m.assets).knight!.key = "k99"));
    expect(where(await check(m))).toEqual([["hash-mismatch", "/project/snapshot"]]);
  });

  it("fails a start that isn't a listed scene", async () => {
    const m = corrupt((m) => (mutable(m.flow).start = "level-2"));
    expect(where(await check(m))).toEqual([["asset-missing", "/flow/start"]]);
  });

  it("fails a bundle entry or a prefab outside assets", async () => {
    const bundle = corrupt((m) => mutable(m.flow.scenes[1]!.bundle.entries).push("ghost"));
    expect(where(await check(bundle))).toEqual([
      ["asset-missing", "/flow/scenes/1/bundle/entries/2"],
    ]);
    const doc = corrupt((m) => (mutable(m.projectBundle).entries = ["menu"]));
    expect(where(await check(doc))).toEqual([["asset-missing", "/projectBundle/entries/0"]]);
    const prefab = corrupt((m) => mutable(m.flow.scenes[1]!.prefabs).push("archer"));
    expect(where(await check(prefab))).toEqual([["asset-missing", "/flow/scenes/1/prefabs/1"]]);
  });

  it("fails rapier set with no Rapier scene, and a Rapier scene with none", async () => {
    const set = corrupt(
      (m) =>
        (mutable(m.build).rapier = {
          package: "@dimforge/rapier2d-compat",
          version: "0.19.0",
          file: null,
          bytes: 0,
        }),
    );
    expect(where(await check(set))).toEqual([["schema", "/build/rapier"]]);
    const unset = corrupt((m) => (mutable(m.flow.scenes[1]!).physics = "rapier"));
    expect(where(await check(unset))).toEqual([["schema", "/build/rapier"]]);
  });

  it("fails an absolute path and one with ..", async () => {
    for (const bad of ["/credits.html", "../credits.html"]) {
      const m = corrupt((m) => {
        const file = m.build.files.find((f) => f.path === "credits.html")!;
        mutable(file).path = bad;
      });
      const files = new Map(base.files);
      files.set(bad, files.get("credits.html")!);
      expect(where(await check(m, files))).toEqual([
        ["schema", `/build/files/${fileIndex(m, bad)}/path`],
      ]);
    }
  });

  it("fails a build hash the program doesn't give", async () => {
    const m = corrupt((m) => (mutable(m.build).hash = "0".repeat(64)));
    expect(where(await check(m))).toEqual([["hash-mismatch", "/build/hash"]]);
  });

  it("fails a named file build.files doesn't list, and an asset its listing contradicts", async () => {
    const entry = corrupt((m) => (mutable(m.build).entry = "code/main-000000.js"));
    expect(where(await check(entry))).toEqual([["export-asset-missing", "/build/entry"]]);
    const icon = corrupt((m) => (mutable(m.pwa!.icons[1]!).file = "icons/icon-1024.png"));
    expect(where(await check(icon))).toEqual([["export-asset-missing", "/pwa/icons/1/file"]]);
  });

  it("fails a budget that doesn't recompute, only when given measureBudget", async () => {
    const m = corrupt((m) => (mutable(m.budget.measured).totalBytes += 1));
    expect(where(await check(m))).toEqual([]);
    expect(where(await checkReleaseManifest(m, base.files, { measureBudget }))).toEqual([
      ["schema", "/budget"],
    ]);
  });

  it("fails a shipped blob naming an asset that doesn't ship as a kind it takes", async () => {
    const atlas = (texture: string) =>
      corrupt((m) => {
        const units = mutable(m.assets.units!);
        units.kind = "atlas";
        units.import = { texture };
      });
    const missing = async (m: ReleaseManifest) =>
      (await check(m)).filter((i) => i.code === "asset-missing");
    expect(await missing(atlas("tiles"))).toEqual([]);
    expect(await missing(atlas("ghost"))).toEqual([
      expect.objectContaining({
        path: "/assets/units",
        entityIds: ["units", "ghost"],
        expected: "texture",
        got: "ghost",
        message: `atlas "units" names "ghost" at /import/texture, which isn't among the manifest's assets`,
      }),
    ]);
    expect((await missing(atlas("menu")))[0]?.message).toBe(
      `atlas "units" names "menu" at /import/texture, which ships as a scene, not texture`,
    );
  });

  it("fails a shipped doc's reference outside assets, given the doc's references", async () => {
    const sites = {
      "level-1": [
        { pointer: "/entities/0/skin", id: "units", kinds: ["texture"] },
        { pointer: "/entities/1/skin", id: "ghost", kinds: ["texture"] },
      ],
      knight: [{ pointer: "/look", id: "tiles", kinds: [] }],
    } as Record<string, { pointer: string; id: string; kinds: string[] }[]>;
    const docRefs = (id: AssetId) => sites[id] ?? [];
    expect(where(await checkReleaseManifest(base.manifest, base.files, { docRefs }))).toEqual([
      ["asset-missing", "/assets/level-1"],
    ]);
    const dropped = corrupt((m) => delete mutable(m.assets).tiles);
    expect(
      (await checkReleaseManifest(dropped, undefined, { docRefs }))
        .filter((i) => i.path === "/assets/knight")
        .map((i) => [i.code, i.got, i.expected]),
    ).toEqual([["asset-missing", "tiles", "an asset"]]);
    expect(where(await check(base.manifest))).toEqual([]);
  });

  it("reports a shape the schema refuses before anything else", async () => {
    const m = corrupt((m) => ((m as unknown as Record<string, unknown>).extra = true));
    expect(where(await check(m))).toEqual([["unknown-key", "/extra"]]);
  });
});

describe("findRelease", () => {
  const SNAP = "a".repeat(64);
  const release = (id: string, snapshot: string, version: string) => {
    const manifest = structuredClone(base.manifest) as ReleaseManifest;
    mutable(manifest.project).snapshot = snapshot;
    mutable(manifest.engine).version = version;
    return { id: id.repeat(64), manifest };
  };
  let newest: ReturnType<typeof release>;
  let older: ReturnType<typeof release>;
  let otherEngine: ReturnType<typeof release>;
  let releases: ReturnType<typeof release>[];
  beforeAll(() => {
    newest = release("3", SNAP, "0.14.0");
    older = release("2", SNAP, "0.14.0");
    otherEngine = release("1", SNAP, "0.13.0");
    releases = [newest, older, otherEngine];
  });
  const recording = (fields: { release?: string; snapshot?: string | null; version?: string }) => ({
    ...(fields.release ? { release: fields.release } : {}),
    project: fields.snapshot === undefined ? null : { id: "fixture", snapshot: fields.snapshot },
    engine: { version: fields.version ?? "0.14.0", physics: null },
  });

  it("finds the release a recording names, exactly", () => {
    expect(findRelease(recording({ release: older.id, snapshot: SNAP }), releases)).toBe(older);
    expect(findRelease(recording({ release: otherEngine.id }), releases)).toBe(otherEngine);
  });

  it("falls back to snapshot and engine version, newest first", () => {
    expect(findRelease(recording({ snapshot: SNAP }), releases)).toBe(newest);
    expect(findRelease(recording({ snapshot: SNAP, version: "0.13.0" }), releases)).toBe(
      otherEngine,
    );
    expect(findRelease(recording({ release: "f".repeat(64), snapshot: SNAP }), releases)).toBe(
      newest,
    );
  });

  it("finds nothing without a match", () => {
    expect(findRelease(recording({ snapshot: "b".repeat(64) }), releases)).toBeNull();
    expect(findRelease(recording({ snapshot: SNAP, version: "0.12.0" }), releases)).toBeNull();
    expect(findRelease(recording({ snapshot: null }), releases)).toBeNull();
    expect(findRelease(recording({}), releases)).toBeNull();
  });
});

describe("a planned release's snapshot", () => {
  const PROJECT: ProjectFile = { kind: "project", v: 1, id: "ford", name: "Ford", game: null };
  const CODE: BuiltCode = {
    files: [{ path: "code/main-abc123.js", sha256: "d".repeat(64), bytes: 1000, role: "code" }],
    entry: "code/main-abc123.js",
    rapier: null,
    thirdParty: [],
  };

  /** What sets one release of the project apart from another. */
  type Data = { spawnX: number; tiles: string; size: number; speed: number };
  const FIRST: Data = { spawnX: 1, tiles: "tile pixels", size: 16, speed: 2 };
  const SECOND: Data = { spawnX: 3.5, tiles: "other tile pixels", size: 32, speed: 5 };

  /** A physics-free project every file of which ships: the list, the settings, one scene, two textures. */
  async function heldFiles(data: Data): Promise<{ files: HeldFile[]; texts: Map<string, string> }> {
    const docs: Record<string, unknown> = {
      "scenes/scene-list.json": {
        kind: "scene-list",
        v: 1,
        start: "ford",
        scenes: [{ scene: "ford", title: "Ford" }],
      },
      "game-settings.json": {
        kind: "game-settings",
        v: 2,
        engine: {},
        game: { avatarSpeed: data.speed },
      },
      "scenes/ford.json": {
        v: 4,
        name: "ford",
        bounds: [0, 0, 6.4, 3.84],
        settings: { physics: "none" },
        assets: ["tiles", "units"],
        entities: [{ id: "start", type: "marker", at: [data.spawnX, 1], tags: ["spawn"] }],
      },
    };
    const texts = new Map<string, string>();
    const files: HeldFile[] = [];
    for (const [path, json] of Object.entries(docs)) {
      texts.set(path, `${JSON.stringify(json, null, 2)}\n`);
      files.push({ path, json });
    }
    const texture = async (
      id: string,
      bytes: string,
      size: number,
      extra: Partial<AssetSidecar> = {},
    ): Promise<HeldFile> => ({
      path: `art/${id}.png`,
      sidecar: {
        kind: "asset-sidecar",
        v: 1,
        key: `key-${id}`,
        id,
        sha256: await sha256(bytes),
        bytes: bytes.length,
        meta: { format: "png", width: size, height: size },
        licence: { spdx: "CC0-1.0", author: "Test authors" },
        ...extra,
      },
    });
    files.push(
      await texture("tiles", data.tiles, data.size),
      await texture("units", "unit pixels", 16, { import: { filter: "nearest" } }),
    );
    return { files, texts };
  }

  async function inputOf(data: Data): Promise<ExportInput> {
    const held = await heldFiles(data);
    const registry = createRegistry(testGame);
    const { view, kinds } = heldProject(held.files, registry, {
      projectId: PROJECT.id,
      name: PROJECT.name,
    });
    const texts = new Map<AssetId, string>();
    for (const e of view.byId.values()) {
      const text = e.sha256 === undefined ? held.texts.get(e.path) : undefined;
      if (text !== undefined) texts.set(e.id, text);
    }
    const build = { scene: { hash: await sha256("scene schema"), buildAt: 5, engine: "0.1.0" } };
    const stamped = projectView({ ...view.state, build }, kinds);
    return {
      project: PROJECT,
      view: stamped,
      texts,
      kinds,
      registry: withProject(registry, stamped, jsonValues(texts)),
      game: testGame,
      engine: {},
      target: "web",
      snapshot: await snapshotProject(stamped, texts, build),
    };
  }

  /** A release planned from `data`, and the doc texts it ships by path. */
  async function released(data: Data) {
    const input = await inputOf(data);
    const plan = await finishExport(await planContent(input), CODE, input);
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
    const shipped = new Map<string, string>();
    for (const f of plan.files) if (f.source.kind === "text") shipped.set(f.path, f.source.text);
    return { input, manifest: plan.manifest, shipped };
  }

  it("equals snapshotProject of the files it was built from: the hash and every entry", async () => {
    const { input, manifest } = await released(FIRST);
    const taken = await snapshotProject(input.view, input.texts, input.view.state.build);
    expect(Object.keys(manifest.assets)).toEqual(Object.keys(taken.assets));
    const pinned = releaseSnapshot(manifest);
    expect(pinned.hash).toBe(taken.hash);
    expect(pinned.hash).toBe(input.snapshot.hash);
    expect(manifest.project.snapshot).toBe(taken.hash);
    for (const id of Object.keys(taken.assets))
      expect(pinned.assets[id], id).toEqual(taken.assets[id]);
    expect(pinned.assets.units!.import).toEqual({ filter: "nearest" });
    expect(pinned.assets.tiles!.meta).toEqual({ format: "png", width: 16, height: 16 });
    expect(pinned.build).toEqual(taken.build);
    expect(pinned).toEqual({ ...taken, at: 0 });
    expect(await parseProjectSnapshot(pinned)).toEqual({ ok: true, snapshot: pinned });
  });

  it("gives a second release of other data its own hash, differing only in the changed entries", async () => {
    const [a, b] = await Promise.all([released(FIRST), released(SECOND)]);
    const pinA = releaseSnapshot(a.manifest);
    const pinB = releaseSnapshot(b.manifest);
    expect(pinB.hash).not.toBe(pinA.hash);
    expect(await releaseId(b.manifest)).not.toBe(await releaseId(a.manifest));
    expect(
      Object.keys(pinA.assets).filter(
        (id) => stableJson(pinA.assets[id]) !== stableJson(pinB.assets[id]),
      ),
    ).toEqual(["ford", "game-settings", "tiles"]);
    expect(pinB).toEqual({
      ...(await snapshotProject(b.input.view, b.input.texts, b.input.view.state.build)),
      at: 0,
    });
  });

  it("two releases of one scene with different data load side by side through two manifestViews keyed by hash", async () => {
    const builds = await Promise.all([released(FIRST), released(SECOND)]);
    // One page: one cache of every fetched data file, one view per release.
    const store = memoryContentStore();
    const page = new Map<Sha256, { manifest: ReleaseManifest; texts: Map<AssetId, string> }>();
    for (const { manifest, shipped } of builds) {
      const texts = new Map<AssetId, string>();
      for (const [id, a] of Object.entries(manifest.assets)) {
        if (a.storage !== "doc") continue;
        const text = shipped.get(a.file)!;
        expect(await sha256(text), a.file).toBe(a.sha256);
        await store.put(new TextEncoder().encode(text));
        texts.set(id, text);
      }
      page.set(releaseSnapshot(manifest).hash, { manifest, texts });
    }
    expect(page.size).toBe(2);
    expect([...page.keys()]).toEqual(builds.map((b) => b.manifest.project.snapshot));

    const load = async (hash: Sha256) => {
      const { manifest, texts } = page.get(hash)!;
      const view = manifestView(manifest);
      expect(view.issues).toEqual([]);
      const runtime = manifestRuntimeView(manifest, texts, testGame);
      const registry = withProject(createRegistry(testGame), view, jsonValues(texts));
      const parsed = parseScene(texts.get("ford")!, registry);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const pinned = await snapshotScene(releaseSnapshot(manifest), "ford", store, registry);
      expect(pinned.def).toEqual(parsed.def);
      return {
        spawn: parsed.def.entities?.[0]?.at,
        tiles: view.byId.get("tiles")?.sha256,
        size: runtime.asset("tiles")?.size,
        speed: runtime.settings.avatarSpeed,
        file: manifest.assets.tiles!.file,
      };
    };
    const [hashA, hashB] = [...page.keys()] as [Sha256, Sha256];
    const [sceneB, sceneA] = await Promise.all([load(hashB), load(hashA)]);
    expect(sceneA).toEqual({
      spawn: [FIRST.spawnX, 1],
      tiles: await sha256(FIRST.tiles),
      size: [FIRST.size, FIRST.size],
      speed: FIRST.speed,
      file: `assets/${await sha256(FIRST.tiles)}.png`,
    });
    expect(sceneB).toEqual({
      spawn: [SECOND.spawnX, 1],
      tiles: await sha256(SECOND.tiles),
      size: [SECOND.size, SECOND.size],
      speed: SECOND.speed,
      file: `assets/${await sha256(SECOND.tiles)}.png`,
    });
    expect(await load(hashA)).toEqual(sceneA);
  });
});
