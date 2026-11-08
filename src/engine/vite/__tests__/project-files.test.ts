// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { checkedTestGame } from "../../__tests__/fixtures/test-game";
import { applyOpsToDoc } from "../../collab/apply";
import {
  docLayout,
  docMeta,
  docToScene,
  metaMap,
  prefabsMap,
  sceneToDoc,
} from "../../collab/convert";
import { contentMap, layoutFromDoc, layoutPatch } from "../../collab/layout";
import { readLog } from "../../collab/log";
import { docToPrefab, prefabPatch } from "../../collab/prefab-doc";
import { applyRegistryBatch } from "../../collab/project-apply";
import { readProject } from "../../collab/project-doc";
import { COLLAB_LAYOUT_VERSION } from "../../collab/types";
import { createRegistry } from "../../game/define";
import { inspectEntry } from "../../project/inspect/entry";
import {
  createKindRegistry,
  formatAssetDoc,
  type DocKindDef,
  type DocLayout,
} from "../../project/kinds";
import type { ProjectOp } from "../../project/ops";
import { parseProjectFile } from "../../project/project-file";
import type { AssetEntry, ProjectFile } from "../../project/types";
import { formatPrefab, formatScene } from "../../scene/format";
import { parseSceneOrThrow } from "../../scene/parse";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { fileContentStore } from "../content-store";
import {
  createProjectFileAdapter,
  pairDiskEvents,
  PERSISTED_ORIGIN,
  type DiskEvent,
  type FileProject,
  type ProjectFileAdapter,
} from "../project-files";
import { engineProjectCopy, type ProjectCopy } from "./dev-server-fixture";

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;
const user = { kind: "user", userId: "ada" } as const;
const registry = createRegistry(checkedTestGame);
const kinds = createKindRegistry(checkedTestGame);

/** One canonical file per declarative kind, and the edit each test makes to it. */
const FILES = {
  material: {
    path: "materials/ice.json",
    text: lines(
      "{",
      '  "kind": "material",',
      '  "v": 1,',
      '  "description": "Ice.",',
      '  "physics": { "friction": 0, "restitution": 0 }',
      "}",
    ),
    edit: (v: Record<string, unknown>) => ({ ...v, description: "Thin ice." }),
  },
  "game-settings": {
    path: "settings.json",
    text: lines(
      "{",
      '  "kind": "game-settings",',
      '  "v": 1,',
      '  "engine": {},',
      '  "game": {',
      '    "avatarSpeed": 180',
      "  }",
      "}",
    ),
    edit: (v: Record<string, unknown>) => ({ ...v, game: { avatarSpeed: 240 } }),
  },
  "data-table": {
    path: "tables/cards.json",
    text: lines(
      "{",
      '  "kind": "data-table",',
      '  "v": 1,',
      '  "table": "card",',
      '  "rows": [',
      '    { "id": "zap", "cost": 0, "damage": 1 },',
      '    { "id": "bolt", "cost": 1, "damage": 2 }',
      "  ]",
      "}",
    ),
    edit: (v: Record<string, unknown>) => ({
      ...v,
      rows: [...(v.rows as unknown[]), { id: "heal", cost: 2, damage: 0 }],
    }),
  },
  "input-script": {
    path: "far.script.json",
    text: lines(
      "{",
      '  "v": 1,',
      '  "scene": "yard",',
      '  "steps": [',
      '    { "for": 10, "hold": ["left"] },',
      '    { "forMs": 250, "hold": [] }',
      "  ]",
      "}",
    ),
    edit: (v: Record<string, unknown>) => ({
      ...v,
      steps: [...(v.steps as unknown[]), { wait: 30 }],
    }),
  },
  checks: {
    path: "yard.checks.json",
    text: lines(
      "{",
      '  "v": 1,',
      '  "checks": [',
      '    { "id": "valid", "kind": "valid" },',
      '    { "id": "props", "kind": "test-game/props", "atLeast": 1 }',
      "  ]",
      "}",
    ),
    edit: (v: Record<string, unknown>) => ({
      ...v,
      checks: (v.checks as Record<string, unknown>[]).map((c) =>
        c.id === "props" ? { ...c, atLeast: 2 } : c,
      ),
    }),
  },
} as const;

const KIND_NAMES = Object.keys(FILES) as (keyof typeof FILES)[];
const IDS: Record<keyof typeof FILES, string> = {
  material: "ice",
  "game-settings": "settings",
  "data-table": "cards",
  "input-script": "far-script",
  checks: "yard-checks",
};

const projectFile: ProjectFile = {
  kind: "project",
  v: 1,
  id: "demo",
  name: "Demo",
  game: null,
  assets: ["**"],
};

let root: string;
let dir: string;
let cacheDir: string;
let project: FileProject;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "project-files-"));
  dir = join(root, "demo");
  cacheDir = join(root, "cache");
  for (const { path, text } of Object.values(FILES)) await put(path, text);
  await put("jams.project.json", `${JSON.stringify(projectFile)}\n`);
  await put("notes.txt", "not an asset\n");
  project = { dir, file: projectFile, registry, kinds, cacheDir };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), text, "utf8");
}
const read = (path: string) => readFile(join(dir, path), "utf8");
const gone = (path: string) =>
  readFile(join(dir, path)).then(
    () => false,
    () => true,
  );

async function walk(base: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(base, rel), { withFileTypes: true })) {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(base, path)));
    else out.push(path);
  }
  return out.sort();
}

type Session = {
  adapter: ProjectFileAdapter;
  project: Y.Doc;
  docs: Map<string, Y.Doc>;
  lookup: (name: string) => Y.Doc | undefined;
  open(key: string): Promise<Y.Doc>;
  entry(key: string): AssetEntry | undefined;
  apply(ops: ProjectOp[]): void;
};

async function session(adapter = createProjectFileAdapter(project)): Promise<Session> {
  const doc = new Y.Doc();
  await adapter.loadProject(doc);
  const docs = new Map<string, Y.Doc>();
  return {
    adapter,
    project: doc,
    docs,
    lookup: (name) => docs.get(name),
    async open(key) {
      const entry = readProject(doc).assets[key]!;
      const name = adapter.docNameOf(entry);
      const asset = new Y.Doc();
      await adapter.loadDoc(name, asset);
      docs.set(name, asset);
      return asset;
    },
    entry: (key) => readProject(doc).assets[key],
    apply(ops) {
      const result = applyRegistryBatch(doc, { v: 1, ops }, user, { registry, kinds });
      if (!result.ok) throw new Error(result.issue.message);
    },
  };
}

const kindOf = (name: string) => kinds.get(name) as DocKindDef;
const layoutOf = (name: string) => kindOf(name).layout as DocLayout;
const textOf = (name: string, doc: Y.Doc) =>
  formatAssetDoc(kindOf(name), layoutFromDoc(doc, layoutOf(name)));

/** Transactions on `doc` while `run` runs, by origin. */
async function transactions(doc: Y.Doc, run: () => Promise<unknown>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const on = (tr: Y.Transaction) => {
    if (tr.changed.size > 0) seen.push(tr.origin);
  };
  doc.on("afterTransaction", on);
  try {
    await run();
  } finally {
    doc.off("afterTransaction", on);
  }
  return seen;
}

describe("pairDiskEvents", () => {
  const ev = (e: Partial<DiskEvent> & Pick<DiskEvent, "type" | "path">): DiskEvent => ({
    at: 0,
    ...e,
  });

  it("pairs an unlink and an add that share a sidecar key, before ids", () => {
    const changes = pairDiskEvents(
      [
        ev({ type: "unlink", path: "a/x.json", key: "k1", id: "x" }),
        ev({ type: "add", path: "b/x.json", id: "x", at: 10 }),
        ev({ type: "add", path: "b/renamed.json", key: "k1", id: "renamed", at: 20 }),
      ],
      100,
    );
    expect(changes).toEqual([
      {
        type: "move",
        from: ev({ type: "unlink", path: "a/x.json", key: "k1", id: "x" }),
        to: ev({ type: "add", path: "b/renamed.json", key: "k1", id: "renamed", at: 20 }),
      },
      { type: "add", event: ev({ type: "add", path: "b/x.json", id: "x", at: 10 }) },
    ]);
  });

  it("pairs by id with no sidecar, only inside the settle window", () => {
    const unlink = ev({ type: "unlink", path: "x.json", key: "x", id: "x", at: 1000 });
    const near = ev({ type: "add", path: "sub/x.json", id: "x", at: 1100 });
    const far = ev({ type: "add", path: "sub/x.json", id: "x", at: 1500 });
    expect(pairDiskEvents([unlink, near], 300)).toEqual([{ type: "move", from: unlink, to: near }]);
    expect(pairDiskEvents([unlink, far], 300)).toEqual([
      { type: "unlink", event: unlink },
      { type: "add", event: far },
    ]);
  });

  it("orders unlinks, then moves, then adds, and pairs each event once", () => {
    const a = ev({ type: "unlink", path: "a.json", key: "a", id: "a" });
    const b = ev({ type: "unlink", path: "b.json", key: "b", id: "a" });
    const add = ev({ type: "add", path: "c/a.json", id: "a", at: 5 });
    const other = ev({ type: "add", path: "d.json", id: "d", at: 1 });
    expect(pairDiskEvents([other, a, b, add], 50).map((c) => c.type)).toEqual([
      "unlink",
      "move",
      "add",
    ]);
    expect(pairDiskEvents([a, b, add], 50)[1]).toEqual({ type: "move", from: a, to: add });
  });
});

describe("scan", () => {
  const ENGINE_HOME = fileURLToPath(new URL("../../scenes/", import.meta.url));
  const PLATFORMER_HOME = fileURLToPath(new URL("../../../games/platformer/", import.meta.url));

  async function home(path: string) {
    const parsed = parseProjectFile(await readFile(join(path, "jams.project.json"), "utf8"));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return createProjectFileAdapter({
      dir: path,
      file: parsed.file,
      registry: createRegistry(),
      kinds: createKindRegistry(),
      cacheDir: join(root, "home-cache"),
    });
  }

  it("of the engine's home gives keys equal to ids, no sidecars and no problems", async () => {
    const { state, problems } = await (await home(ENGINE_HOME)).scan();
    expect(problems).toEqual([]);
    expect(state.meta).toEqual({ projectId: "engine", layout: 1, name: "Engine" });
    const entries = Object.values(state.assets);
    const files = await walk(ENGINE_HOME);
    expect(files.filter((p) => p.endsWith(".asset.json"))).toEqual([]);
    expect(entries.map((e) => e.path).sort()).toEqual(
      files.filter((p) => p !== "jams.project.json"),
    );
    for (const e of entries) expect(e.key).toBe(e.id);
    expect(entries.map((e) => [e.id, e.kind, e.path])).toEqual(
      expect.arrayContaining([
        ["engine-yard", "scene", "engine-yard.json"],
        ["engine-yard-checks", "checks", "engine-yard.checks.json"],
        ["gate", "prefab", "prefabs/gate.json"],
        ["kitchen-sink", "scene", "kitchen-sink.json"],
        ["kitchen-sink-checks", "checks", "kitchen-sink.checks.json"],
        ["post", "prefab", "prefabs/post.json"],
      ]),
    );
  });

  it("of the platformer's home lists its scenes only, keyed by id, with no sidecars", async () => {
    const { state } = await (await home(PLATFORMER_HOME)).scan();
    const entries = Object.values(state.assets);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.key).toBe(e.id);
      expect(e.path.startsWith("scenes/")).toBe(true);
      expect(e.created).toEqual({ at: 0, by: "disk" });
    }
    expect(entries.map((e) => e.id)).toContain("test-yard");
    const files = await walk(join(PLATFORMER_HOME, "scenes"));
    expect(files.filter((p) => p.endsWith(".asset.json"))).toEqual([]);
  });

  it("is deterministic, skips what isn't an asset and reports broken files", async () => {
    await put("tables/__tests__/rows.json", FILES["data-table"].text);
    await put("broken.json", "{ nope");
    await put("orphan.png.asset.json", '{ "kind": "asset-sidecar", "v": 1, "id": "orphan" }\n');
    const adapter = createProjectFileAdapter(project);
    const first = await adapter.scan();
    expect(await adapter.scan()).toEqual(first);
    expect(Object.keys(first.state.assets)).toEqual([...Object.values(IDS)].sort());
    expect(first.problems.map((p) => [p.path, p.issues[0]!.code])).toEqual([
      ["broken.json", "schema"],
      ["orphan.png.asset.json", "ref-not-found"],
    ]);
  });

  it("judges scenes by the project's material assets: one naming a material file parses, and stops when the file goes", async () => {
    const yard = (material: string) =>
      lines(
        "{",
        '  "v": 2,',
        '  "name": "yard",',
        '  "bounds": [0, 0, 100, 100],',
        '  "entities": [',
        `    { "id": "floor", "type": "solid", "shape": ["box", 50, 90, 50, 10], "material": "${material}" }`,
        "  ]",
        "}",
      );
    await put("yard.json", yard("ice"));
    expect((await createProjectFileAdapter(project).scan()).problems).toEqual([]);

    const s = await session();
    const scene = await s.open("yard");
    expect(docToScene(scene).entities![0]).toMatchObject({ material: "ice" });
    const unloaded = new Y.Doc();
    await createProjectFileAdapter(project).loadDoc("scene:demo.yard", unloaded);
    expect(docToScene(unloaded).entities![0]).toMatchObject({ material: "ice" });

    await rm(join(dir, "materials/ice.json"));
    const { problems } = await createProjectFileAdapter(project).scan();
    expect(problems.map((p) => [p.path, p.issues[0]!.path])).toEqual([
      ["yard.json", "/entities/0/material"],
    ]);
  });

  it("takes the key, id, name and licence from a sidecar", async () => {
    await put(
      "materials/ice.json.asset.json",
      lines(
        "{",
        '  "kind": "asset-sidecar",',
        '  "v": 1,',
        '  "key": "k-ice",',
        '  "id": "frost",',
        '  "name": "Frost",',
        '  "licence": { "spdx": "CC0-1.0" }',
        "}",
      ),
    );
    const { state, problems } = await createProjectFileAdapter(project).scan();
    expect(problems).toEqual([]);
    expect(state.assets["k-ice"]).toMatchObject({
      id: "frost",
      name: "Frost",
      licence: { spdx: "CC0-1.0" },
      path: "materials/ice.json",
    });
    expect(state.assets.ice).toBeUndefined();
  });
});

describe("write-back: edits, for every declarative kind", () => {
  for (const name of KIND_NAMES) {
    const { path, text, edit } = FILES[name];
    const key = IDS[name];

    it(`${name}: a doc edit writes canonical text once, with no sidecar`, async () => {
      const s = await session();
      const doc = await s.open(key);
      expect(textOf(name, doc)).toBe(text);
      expect(await s.adapter.storeDoc(s.adapter.docNameOf(s.entry(key)!), doc)).toBe(false);

      const next = edit(layoutFromDoc(doc, layoutOf(name)));
      layoutPatch(doc, layoutOf(name), next, user);
      const docName = s.adapter.docNameOf(s.entry(key)!);
      expect(await s.adapter.storeDoc(docName, doc)).toBe(true);
      expect(await read(path)).toBe(formatAssetDoc(kindOf(name), next));
      expect(await s.adapter.storeDoc(docName, doc)).toBe(false);
      expect(await gone(`${path}.asset.json`)).toBe(true);
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "unchanged" });
    });

    it(`${name}: a disk edit is one disk transaction on the open doc`, async () => {
      const s = await session();
      const doc = await s.open(key);
      const next = edit(JSON.parse(text) as Record<string, unknown>);
      const after = formatAssetDoc(kindOf(name), next);
      await put(path, after);
      const origins = await transactions(doc, async () => {
        expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({
          kind: "applied",
          ops: 1,
        });
      });
      expect(origins).toEqual([{ kind: "disk" }]);
      expect(textOf(name, doc)).toBe(after);
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "unchanged" });
      expect(await s.adapter.storeDoc(s.adapter.docNameOf(s.entry(key)!), doc)).toBe(false);
    });
  }

  it("refuses a disk edit that doesn't parse and keeps the doc", async () => {
    const s = await session();
    const doc = await s.open("ice");
    await put(FILES.material.path, '{ "kind": "material", "v": 1 }\n');
    const result = await s.adapter.syncPath(FILES.material.path, s.lookup, s.project);
    expect(result.kind).toBe("refused");
    expect(textOf("material", doc)).toBe(FILES.material.text);
  });

  it("keeps keyed rows' keys through a disk edit", async () => {
    const s = await session();
    const doc = await s.open("cards");
    const rows = contentMap(doc).get("rows") as Y.Map<unknown>;
    const before = [...rows.keys()].sort();
    const value = JSON.parse(FILES["data-table"].text) as { rows: Record<string, unknown>[] };
    value.rows[0]!.cost = 9;
    await put(FILES["data-table"].path, formatAssetDoc(kindOf("data-table"), value));
    await s.adapter.syncPath(FILES["data-table"].path, s.lookup, s.project);
    expect([...rows.keys()].sort()).toEqual(before);
  });
});

describe("write-back: data-table moves", () => {
  it("a disk move pairs into one move, keeping the key and the open doc", async () => {
    const s = await session();
    const doc = await s.open("cards");
    await mkdir(join(dir, "decks"));
    await rename(join(dir, "tables/cards.json"), join(dir, "decks/cards.json"));
    expect(await s.adapter.syncPath("tables/cards.json", s.lookup, s.project)).toEqual({
      kind: "pending",
    });
    expect(await s.adapter.syncPath("decks/cards.json", s.lookup, s.project)).toEqual({
      kind: "pending",
    });
    const origins = await transactions(s.project, async () => {
      expect(await s.adapter.settle(s.lookup, s.project)).toEqual([{ kind: "applied", ops: 1 }]);
    });
    expect(origins).toEqual([{ kind: "disk" }]);
    const entry = s.entry("cards")!;
    expect(entry).toMatchObject({ id: "cards", path: "decks/cards.json" });
    expect(entry.deleted).toBeUndefined();
    expect(Object.keys(readProject(s.project).assets)).toHaveLength(KIND_NAMES.length);
    expect(await gone("tables")).toBe(true);

    const value = layoutFromDoc(doc, layoutOf("data-table"));
    layoutPatch(
      doc,
      layoutOf("data-table"),
      { ...value, rows: (value.rows as unknown[]).slice(1) },
      user,
    );
    expect(await s.adapter.storeDoc(s.adapter.docNameOf(entry), doc)).toBe(true);
    expect(await read("decks/cards.json")).toBe(textOf("data-table", doc));
    expect(await gone("tables/cards.json")).toBe(true);
  });

  it("two assets swapping paths in one batch swap files", async () => {
    const s = await session();
    for (const [key, path] of [
      ["cards", "settings.json"],
      ["settings", "tables/cards.json"],
    ] as const)
      s.project.transact(() => {
        (s.project.getMap("assets").get(key) as Y.Map<unknown>).set("path", path);
      }, user);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await read("settings.json")).toBe(FILES["data-table"].text);
    expect(await read("tables/cards.json")).toBe(FILES["game-settings"].text);
  });

  it("a disk rename with its sidecar pairs by the sidecar's key", async () => {
    await put(
      "tables/cards.json.asset.json",
      lines(
        "{",
        '  "kind": "asset-sidecar",',
        '  "v": 1,',
        '  "key": "deck",',
        '  "id": "cards"',
        "}",
      ),
    );
    const s = await session();
    expect(s.entry("deck")).toMatchObject({ id: "cards" });
    await rename(join(dir, "tables/cards.json"), join(dir, "tables/red.json"));
    await rename(
      join(dir, "tables/cards.json.asset.json"),
      join(dir, "tables/red.json.asset.json"),
    );
    for (const path of ["tables/cards.json", "tables/red.json", "tables/red.json.asset.json"])
      await s.adapter.syncPath(path, s.lookup, s.project);
    expect(await s.adapter.settle(s.lookup, s.project)).toEqual([{ kind: "applied", ops: 1 }]);
    expect(s.entry("deck")).toMatchObject({ id: "cards", path: "tables/red.json" });
    expect(await s.adapter.storeProject(s.project)).toBe(false);
  });

  it("a registry move renames the file, prunes the empty folder and its own events are no-ops", async () => {
    const s = await session();
    s.apply([{ op: "moveAsset", ids: ["cards"], to: "decks/" }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await read("decks/cards.json")).toBe(FILES["data-table"].text);
    expect(await gone("tables")).toBe(true);
    for (const path of ["tables/cards.json", "decks/cards.json"])
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "unchanged" });
    expect(await s.adapter.storeProject(s.project)).toBe(false);
  });

  it("a rename in place with no sidecar keeps the id in a new sidecar", async () => {
    const s = await session();
    s.apply([{ op: "renameAsset", id: "cards", file: "deck.json" }]);
    await s.adapter.storeProject(s.project);
    expect(await gone("tables/cards.json")).toBe(true);
    expect(JSON.parse(await read("tables/deck.json.asset.json"))).toEqual({
      kind: "asset-sidecar",
      v: 1,
      id: "cards",
    });
    const rescan = await createProjectFileAdapter(project).scan();
    expect(rescan.state.assets.cards).toMatchObject({ id: "cards", path: "tables/deck.json" });
  });
});

describe("write-back: the registry", () => {
  it("create: the creator's first edit writes the file, and a sidecar for its random key", async () => {
    const s = await session();
    const content = { kind: "material", v: 1, description: "Rubber." };
    const result = applyRegistryBatch(
      s.project,
      {
        v: 1,
        ops: [{ op: "createAsset", kind: "material", path: "materials/rubber.json", content }],
      },
      user,
      { registry, kinds, newKey: () => "k0rubber" },
    );
    expect(result.ok).toBe(true);
    expect(await s.adapter.storeProject(s.project)).toBe(false);
    expect(await gone("materials/rubber.json")).toBe(true);

    const doc = await s.open("k0rubber");
    expect(contentMap(doc).size).toBe(0);
    expect(doc.getMap("meta").toJSON()).toEqual({
      kind: "material",
      schemaVersion: 1,
      layout: COLLAB_LAYOUT_VERSION,
      project: "demo",
      key: "k0rubber",
    });
    layoutPatch(doc, layoutOf("material"), content, user);
    expect(await s.adapter.storeDoc("asset:demo.k0rubber", doc)).toBe(true);
    expect(await read("materials/rubber.json")).toBe(formatAssetDoc(kindOf("material"), content));
    expect(JSON.parse(await read("materials/rubber.json.asset.json"))).toEqual({
      kind: "asset-sidecar",
      v: 1,
      key: "k0rubber",
      id: "rubber",
    });
    expect(await s.adapter.storeProject(s.project)).toBe(false);
    for (const path of ["materials/rubber.json", "materials/rubber.json.asset.json"])
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "unchanged" });

    const rescan = await createProjectFileAdapter(project).scan();
    expect(rescan.state.assets.k0rubber).toMatchObject({ id: "rubber", kind: "material" });
  });

  it("move: a licence travels in the sidecar with the file", async () => {
    const s = await session();
    s.apply([
      { op: "setLicence", id: "ice", licence: { spdx: "CC0-1.0", author: "Ana" } },
      { op: "moveAsset", ids: ["ice"], to: "" },
    ]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await read("ice.json")).toBe(FILES.material.text);
    expect(await read("ice.json.asset.json")).toBe(
      lines(
        "{",
        '  "kind": "asset-sidecar",',
        '  "v": 1,',
        '  "id": "ice",',
        '  "licence": { "spdx": "CC0-1.0", "author": "Ana" }',
        "}",
      ),
    );
    expect(await gone("materials")).toBe(true);
    s.apply([{ op: "setLicence", id: "ice", licence: null }]);
    await s.adapter.storeProject(s.project);
    expect(await gone("ice.json.asset.json")).toBe(true);
  });

  it("delete trashes the file and its sidecar; restore rewrites them from the cache", async () => {
    const s = await session();
    s.apply([{ op: "setLicence", id: "far-script", licence: { spdx: "MIT" } }]);
    await s.adapter.storeProject(s.project);
    expect(await gone("far.script.json.asset.json")).toBe(false);

    s.apply([{ op: "deleteAsset", id: "far-script", force: true }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await gone("far.script.json")).toBe(true);
    expect(await gone("far.script.json.asset.json")).toBe(true);
    expect(await s.adapter.syncPath("far.script.json", s.lookup, s.project)).toEqual({
      kind: "unchanged",
    });

    s.apply([{ op: "restoreAsset", id: "far-script" }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await read("far.script.json")).toBe(FILES["input-script"].text);
    expect(JSON.parse(await read("far.script.json.asset.json"))).toMatchObject({
      licence: { spdx: "MIT" },
    });
  });

  it("restore after a restart reads the trash from the cache dir", async () => {
    const s = await session();
    s.apply([{ op: "deleteAsset", id: "settings", force: true }]);
    await s.adapter.storeProject(s.project);
    expect(await gone("settings.json")).toBe(true);

    const restarted = await session(createProjectFileAdapter(project));
    expect(restarted.entry("settings")?.deleted).toBeDefined();
    const doc = await restarted.open("settings");
    expect(textOf("game-settings", doc)).toBe(FILES["game-settings"].text);
    restarted.apply([{ op: "restoreAsset", id: "settings" }]);
    expect(await restarted.adapter.storeProject(restarted.project)).toBe(true);
    expect(await read("settings.json")).toBe(FILES["game-settings"].text);
  });

  it("a disk unlink alone is a deleteAsset with the disk origin; a disk add is an entry keyed by its id", async () => {
    const s = await session();
    await rm(join(dir, "yard.checks.json"));
    await put("more.checks.json", FILES.checks.text);
    expect(await s.adapter.syncPath("yard.checks.json", s.lookup, s.project)).toEqual({
      kind: "pending",
    });
    expect(await s.adapter.syncPath("more.checks.json", s.lookup, s.project)).toEqual({
      kind: "pending",
    });
    const origins = await transactions(s.project, () => s.adapter.settle(s.lookup, s.project));
    expect(origins).toEqual([{ kind: "disk" }, { kind: "disk" }]);
    expect(s.entry("yard-checks")?.deleted?.by).toBe("disk");
    expect(s.entry("more-checks")).toMatchObject({
      id: "more-checks",
      kind: "checks",
      path: "more.checks.json",
      created: { by: "disk" },
    });
    const log = s.project.getArray("log").toArray() as { actor: unknown; label: string }[];
    expect(log.map((e) => [e.actor, e.label])).toEqual([[{ kind: "disk" }, "Changed on disk"]]);

    await put("yard.checks.json", FILES.checks.text);
    await s.adapter.syncPath("yard.checks.json", s.lookup, s.project);
    await s.adapter.settle(s.lookup, s.project);
    expect(s.entry("yard-checks")?.deleted).toBeUndefined();
  });

  it("files changed while the server was down reconcile into the persisted registry", async () => {
    const s = await session();
    s.apply([{ op: "setLicence", id: "ice", licence: { spdx: "CC0-1.0" } }]);
    await s.adapter.storeProject(s.project);
    await rm(join(dir, "far.script.json"));
    await put("extra.json", FILES.material.text);

    const restarted = await session(createProjectFileAdapter(project));
    expect(restarted.entry("ice")?.licence).toEqual({ spdx: "CC0-1.0" });
    expect(restarted.entry("far-script")?.deleted?.by).toBe("disk");
    expect(restarted.entry("extra")).toMatchObject({ kind: "material", path: "extra.json" });
  });

  it("a persisted doc reloads with its keys and takes a file edited meanwhile as one disk transaction", async () => {
    const s = await session();
    const doc = await s.open("cards");
    const name = s.adapter.docNameOf(s.entry("cards")!);
    await s.adapter.persist(name, doc);
    const keys = [...(contentMap(doc).get("rows") as Y.Map<unknown>).keys()].sort();

    const value = JSON.parse(FILES["data-table"].text) as { rows: Record<string, unknown>[] };
    value.rows[1]!.damage = 7;
    await put(FILES["data-table"].path, formatAssetDoc(kindOf("data-table"), value));
    const restarted = createProjectFileAdapter(project);
    await restarted.loadProject(new Y.Doc());
    const again = new Y.Doc();
    const origins = await transactions(again, () => restarted.loadDoc(name, again));
    expect(origins).toEqual([PERSISTED_ORIGIN, { kind: "disk" }]);
    expect([...(contentMap(again).get("rows") as Y.Map<unknown>).keys()].sort()).toEqual(keys);
    expect(textOf("data-table", again)).toBe(formatAssetDoc(kindOf("data-table"), value));
  });

  it("refuses docs it doesn't hold", async () => {
    const s = await session();
    const doc = new Y.Doc();
    await expect(s.adapter.loadDoc("asset:other.ice", doc)).rejects.toThrow(/project "demo"/);
    await expect(s.adapter.loadDoc("asset:demo.nope", doc)).rejects.toThrow(/no asset/);
    expect(s.adapter.watches("notes.txt")).toBe(true);
    expect(s.adapter.watches("a.schema.json")).toBe(false);
    expect(s.adapter.watches("x/__tests__/a.json")).toBe(false);
  });
});

const FIXTURES = fileURLToPath(new URL("../../project/__tests__/fixtures/", import.meta.url));
const fixture = (name: string) => readFile(join(FIXTURES, name));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytesAt = (path: string) => readFile(join(dir, path));
const sidecarAt = async (path: string) =>
  JSON.parse(await read(`${path}.asset.json`)) as Record<string, unknown>;

async function putBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), bytes);
}

describe("write-back: binaries", () => {
  let png: Buffer;
  let other: Buffer;

  beforeEach(async () => {
    png = await fixture("texture.png");
    other = await fixture("hero.png");
    await putBytes("art/crate.png", png);
  });

  it("scan hashes a binary, copies its bytes into the content store and inspects it", async () => {
    const { state, problems } = await createProjectFileAdapter(project).scan();
    expect(problems).toEqual([]);
    expect(state.assets.crate).toEqual({
      key: "crate",
      id: "crate",
      kind: "texture",
      path: "art/crate.png",
      sha256: sha(png),
      bytes: png.byteLength,
      meta: { format: "png", width: 12, height: 10 },
      created: { at: 0, by: "disk" },
    });
    expect(await fileContentStore(cacheDir).get(sha(png))).toEqual(new Uint8Array(png));
  });

  it("a binary with no sidecar gets one on store, carrying its hash and meta", async () => {
    const s = await session();
    expect(s.project.getMap("history").has("crate")).toBe(true);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await read("art/crate.png.asset.json")).toBe(
      lines(
        "{",
        '  "kind": "asset-sidecar",',
        '  "v": 1,',
        '  "id": "crate",',
        `  "sha256": "${sha(png)}",`,
        `  "bytes": ${png.byteLength},`,
        '  "meta": { "format": "png", "height": 10, "width": 12 }',
        "}",
      ),
    );
    expect(await s.adapter.storeProject(s.project)).toBe(false);
    for (const path of ["art/crate.png", "art/crate.png.asset.json"])
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "unchanged" });
    const rescan = await createProjectFileAdapter(project).scan();
    expect(rescan.problems).toEqual([]);
    expect(rescan.state.assets.crate).toEqual(s.entry("crate"));
  });

  it("a disk rehash stamps the outgoing hash with the replacement, so a swap back keeps it in grace", async () => {
    let clock = 1000;
    const s = await session(createProjectFileAdapter(project, { now: () => clock }));
    await s.adapter.storeProject(s.project);
    await putBytes("art/crate.png", other);
    await s.adapter.syncPath("art/crate.png", s.lookup, s.project);
    clock = 50_000;
    await putBytes("art/crate.png", png);
    await s.adapter.syncPath("art/crate.png", s.lookup, s.project);
    expect(readProject(s.project).history.crate!.map((h) => [h.sha256, h.at])).toEqual([
      [sha(png), 1000],
      [sha(other), 1000],
      [sha(other), 50_000],
    ]);
  });

  it("replacing the bytes on disk rehashes: one disk replaceContent with new meta and a change to broadcast", async () => {
    const s = await session();
    await s.adapter.storeProject(s.project);
    await putBytes("art/crate.png", other);
    let result: unknown;
    const origins = await transactions(s.project, async () => {
      result = await s.adapter.syncPath("art/crate.png", s.lookup, s.project);
    });
    expect(origins).toEqual([{ kind: "disk" }]);
    expect(result).toEqual({
      kind: "applied",
      ops: 1,
      changed: {
        key: "crate",
        id: "crate",
        kind: "texture",
        path: "art/crate.png",
        sha256: sha(other),
        bytes: other.byteLength,
        previous: sha(png),
      },
    });
    expect(s.entry("crate")).toMatchObject({
      sha256: sha(other),
      bytes: other.byteLength,
      meta: { format: "png", width: 32, height: 8 },
    });
    expect(readProject(s.project).history.crate!.map((h) => [h.sha256, h.by])).toEqual([
      [sha(png), "disk"],
      [sha(other), "disk"],
    ]);
    const log = s.project.getArray("log").toArray() as { actor: unknown; label: string }[];
    expect(log.map((e) => [e.actor, e.label])).toEqual([[{ kind: "disk" }, "Changed on disk"]]);
    expect(await fileContentStore(cacheDir).has(sha(other))).toBe(true);

    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await sidecarAt("art/crate.png")).toMatchObject({
      sha256: sha(other),
      meta: { width: 32, height: 8 },
    });
    expect(await bytesAt("art/crate.png")).toEqual(other);
    for (const path of ["art/crate.png", "art/crate.png.asset.json"])
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "unchanged" });
  });

  it("a replaceContent whose bytes are in the content store writes the file and its sidecar", async () => {
    const s = await session();
    await s.adapter.storeProject(s.project);
    const hash = await fileContentStore(cacheDir).put(new Uint8Array(other));
    s.apply([{ op: "replaceContent", id: "crate", sha256: hash, bytes: other.byteLength }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await bytesAt("art/crate.png")).toEqual(other);
    expect(await sidecarAt("art/crate.png")).toMatchObject({ sha256: hash });
    expect(await s.adapter.syncPath("art/crate.png", s.lookup, s.project)).toEqual({
      kind: "unchanged",
    });
  });

  it("a registry move carries the sidecar with the file", async () => {
    const s = await session();
    s.apply([{ op: "setLicence", id: "crate", licence: { spdx: "CC0-1.0" } }]);
    await s.adapter.storeProject(s.project);
    const before = await read("art/crate.png.asset.json");
    s.apply([{ op: "moveAsset", ids: ["crate"], to: "sprites/" }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await bytesAt("sprites/crate.png")).toEqual(png);
    expect(await read("sprites/crate.png.asset.json")).toBe(before);
    expect(await gone("art")).toBe(true);
    for (const path of ["art/crate.png", "sprites/crate.png", "sprites/crate.png.asset.json"])
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "unchanged" });
    const rescan = await createProjectFileAdapter(project).scan();
    expect(rescan.state.assets.crate).toEqual({
      ...s.entry("crate"),
      created: rescan.state.assets.crate!.created,
    });
  });

  it("a disk move with the sidecar pairs by its key; without it, the stale sidecar goes and a new one is written", async () => {
    await putBytes(
      "art/crate.png.asset.json",
      new TextEncoder().encode(
        lines(
          "{",
          '  "kind": "asset-sidecar",',
          '  "v": 1,',
          '  "key": "k-crate",',
          '  "id": "crate"',
          "}",
        ),
      ),
    );
    const s = await session();
    await s.adapter.storeProject(s.project);
    const sidecar = await read("art/crate.png.asset.json");
    await mkdir(join(dir, "sprites"));
    await rename(join(dir, "art/crate.png"), join(dir, "sprites/box.png"));
    await rename(join(dir, "art/crate.png.asset.json"), join(dir, "sprites/box.png.asset.json"));
    for (const path of ["art/crate.png", "sprites/box.png", "sprites/box.png.asset.json"])
      await s.adapter.syncPath(path, s.lookup, s.project);
    expect(await s.adapter.settle(s.lookup, s.project)).toEqual([{ kind: "applied", ops: 2 }]);
    expect(s.entry("k-crate")).toMatchObject({
      id: "crate",
      path: "sprites/box.png",
      sha256: sha(png),
    });
    expect(await s.adapter.storeProject(s.project)).toBe(false);
    expect(await read("sprites/box.png.asset.json")).toBe(sidecar);

    await rename(join(dir, "sprites/box.png"), join(dir, "sprites/crate.png"));
    for (const path of ["sprites/box.png", "sprites/crate.png"])
      await s.adapter.syncPath(path, s.lookup, s.project);
    expect(await s.adapter.settle(s.lookup, s.project)).toEqual([{ kind: "applied", ops: 1 }]);
    expect(await gone("sprites/box.png.asset.json")).toBe(true);
    expect(s.entry("k-crate")).toMatchObject({ id: "crate", path: "sprites/crate.png" });
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await sidecarAt("sprites/crate.png")).toMatchObject({
      key: "k-crate",
      sha256: sha(png),
    });
  });

  it("delete trashes the file and its sidecar; restore rewrites both from the cache, after a restart too", async () => {
    const s = await session();
    s.apply([{ op: "setImport", id: "crate", set: { filter: "linear" } }]);
    await s.adapter.storeProject(s.project);
    const sidecar = await read("art/crate.png.asset.json");
    expect(JSON.parse(sidecar)).toMatchObject({ import: { filter: "linear" } });

    s.apply([{ op: "deleteAsset", id: "crate", force: true }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await gone("art/crate.png")).toBe(true);
    expect(await gone("art/crate.png.asset.json")).toBe(true);
    expect(await gone("art")).toBe(true);
    expect(await s.adapter.syncPath("art/crate.png", s.lookup, s.project)).toEqual({
      kind: "unchanged",
    });

    const restarted = await session(createProjectFileAdapter(project));
    expect(restarted.entry("crate")?.deleted).toBeDefined();
    restarted.apply([{ op: "restoreAsset", id: "crate" }]);
    expect(await restarted.adapter.storeProject(restarted.project)).toBe(true);
    expect(await bytesAt("art/crate.png")).toEqual(png);
    expect(await read("art/crate.png.asset.json")).toBe(sidecar);
    expect(
      await restarted.adapter.syncPath("art/crate.png", restarted.lookup, restarted.project),
    ).toEqual({
      kind: "unchanged",
    });
  });

  it("a disk add of a binary is an entry with its hash and a history; a disk unlink trashes it", async () => {
    const s = await session();
    await putBytes("art/hero.png", other);
    await rm(join(dir, "art/crate.png"));
    for (const path of ["art/hero.png", "art/crate.png"])
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "pending" });
    await s.adapter.settle(s.lookup, s.project);
    expect(s.entry("hero")).toMatchObject({
      kind: "texture",
      sha256: sha(other),
      meta: { width: 32, height: 8 },
      created: { by: "disk" },
    });
    expect(readProject(s.project).history.hero).toEqual([]);
    expect(s.entry("crate")?.deleted?.by).toBe("disk");
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await sidecarAt("art/hero.png")).toMatchObject({ id: "hero", sha256: sha(other) });
  });

  it("a hand edit of the sidecar's settings re-inspects the asset", async () => {
    await putBytes("art/hero.atlas.json", await fixture("hero.json"));
    await putBytes("art/hero.png", other);
    const s = await session();
    expect(s.entry("hero-atlas")).toMatchObject({
      kind: "atlas",
      import: { texture: "hero" },
      meta: { tool: "aseprite" },
    });
    await s.adapter.storeProject(s.project);
    const frames = (s.entry("hero-atlas")!.meta as { frames: Record<string, unknown> }).frames;
    const sidecar = await sidecarAt("art/hero.atlas.json");
    await putBytes(
      "art/hero.atlas.json.asset.json",
      new TextEncoder().encode(
        JSON.stringify({ ...sidecar, import: { texture: "hero", pivotDefault: [0, 1] } }),
      ),
    );
    expect(await s.adapter.syncPath("art/hero.atlas.json.asset.json", s.lookup, s.project)).toEqual(
      { kind: "applied", ops: 1 },
    );
    const entry = s.entry("hero-atlas")!;
    expect(entry.import).toEqual({ texture: "hero", pivotDefault: [0, 1] });
    expect((entry.meta as { frames: Record<string, unknown> }).frames).not.toEqual(frames);
  });

  it("a recording replaced by hand still takes the file's bytes, with both hashes in its history", async () => {
    const recording = await fixture("run.recording.json");
    await putBytes("runs/run.recording.json", recording);
    const s = await session();
    const value = JSON.parse(recording.toString("utf8")) as { ticks: number };
    const edited = Buffer.from(`${JSON.stringify({ ...value, ticks: value.ticks + 1 })}\n`);
    await putBytes("runs/run.recording.json", edited);
    const result = await s.adapter.syncPath("runs/run.recording.json", s.lookup, s.project);
    expect(result).toMatchObject({ kind: "applied", changed: { sha256: sha(edited) } });
    expect(s.entry("run-recording")).toMatchObject({
      sha256: sha(edited),
      meta: { ticks: value.ticks + 1 },
    });
    expect(readProject(s.project).history["run-recording"]!.map((h) => h.sha256)).toEqual([
      sha(recording),
      sha(edited),
    ]);
  });

  it("two replaces merged from two clients write the winner's bytes, its sidecar, and keep every blob", async () => {
    const s = await session();
    await s.adapter.storeProject(s.project);
    const resaved = Buffer.concat([png, Buffer.from([0])]);
    const store = fileContentStore(cacheDir);
    for (const bytes of [other, resaved]) await store.put(new Uint8Array(bytes));
    const clients = [new Y.Doc(), new Y.Doc()];
    for (const c of clients) Y.applyUpdate(c, Y.encodeStateAsUpdate(s.project));
    for (const [i, bytes] of [resaved, other].entries()) {
      const result = applyRegistryBatch(
        clients[i]!,
        {
          v: 1,
          ops: [{ op: "replaceContent", id: "crate", sha256: sha(bytes), bytes: bytes.byteLength }],
        },
        { kind: "user", userId: i === 0 ? "ada" : "bo" },
        {
          registry,
          kinds,
          inspect: (def, entry) => inspectEntry(def, entry, new Uint8Array(bytes), () => undefined),
        },
      );
      expect(result.ok).toBe(true);
    }
    for (const c of clients) Y.applyUpdate(s.project, Y.encodeStateAsUpdate(c));
    const crate = s.entry("crate")!;
    const winner = crate.sha256 === sha(other) ? other : resaved;
    expect(crate).toMatchObject({
      sha256: sha(winner),
      bytes: winner.byteLength,
      meta: { width: winner === other ? 32 : 12 },
    });
    expect(new Set(readProject(s.project).history.crate!.map((h) => h.sha256))).toEqual(
      new Set([sha(png), sha(resaved), sha(other)]),
    );

    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await bytesAt("art/crate.png")).toEqual(winner);
    expect(await sidecarAt("art/crate.png")).toMatchObject({
      sha256: sha(winner),
      bytes: winner.byteLength,
    });
    for (const bytes of [png, resaved, other]) expect(await store.has(sha(bytes))).toBe(true);
    expect(await s.adapter.syncPath("art/crate.png", s.lookup, s.project)).toEqual({
      kind: "unchanged",
    });
  });

  it("a replace naming bytes the cache lacks is pointed back at the file's, and the file stays", async () => {
    const s = await session();
    await s.adapter.storeProject(s.project);
    const missing = "ab".repeat(32);
    s.apply([{ op: "replaceContent", id: "crate", sha256: missing, bytes: 3 }]);
    const origin = { kind: "repair", reason: "hash-mismatch" } as const;
    expect(await s.adapter.repairBlobs(s.project, origin)).toEqual([
      { key: "crate", id: "crate", from: missing, to: sha(png) },
    ]);
    expect(s.entry("crate")).toMatchObject({
      sha256: sha(png),
      bytes: png.byteLength,
      meta: { format: "png", width: 12, height: 10 },
    });
    expect(new Set(readProject(s.project).history.crate!.map((h) => h.sha256))).toEqual(
      new Set([sha(png), missing]),
    );
    expect(await s.adapter.storeProject(s.project)).toBe(false);
    expect(await bytesAt("art/crate.png")).toEqual(png);
    expect(await s.adapter.repairBlobs(s.project, origin)).toEqual([]);
  });

  it("bytes that don't inspect are listed without meta and reported", async () => {
    await putBytes("art/broken.png", new TextEncoder().encode("not a png"));
    const { state, problems } = await createProjectFileAdapter(project).scan();
    expect(problems.map((p) => [p.path, p.issues[0]!.code])).toEqual([
      ["art/broken.png", "import-failed"],
    ]);
    expect(state.assets.broken).toMatchObject({ kind: "texture", bytes: 9 });
    expect(state.assets.broken!.meta).toBeUndefined();
  });
});

describe("dev persistence", () => {
  const docName = "asset:demo.cards";

  it("persists to <cacheDir>/docs/<prefix>/<project>.<key>.bin on store", async () => {
    const s = await session();
    const doc = await s.open("cards");
    await s.adapter.storeDoc(docName, doc);
    await s.adapter.storeProject(s.project);
    expect((await walk(join(cacheDir, "docs"))).filter((p) => p.endsWith(".bin"))).toEqual([
      "asset/demo.cards.bin",
      "project/demo.bin",
    ]);
  });

  it("a persisted doc whose text equals the file's loads as is, with no disk transaction", async () => {
    const s = await session();
    const doc = await s.open("cards");
    await s.adapter.persist(docName, doc);
    const restarted = createProjectFileAdapter(project);
    await restarted.loadProject(new Y.Doc());
    const again = new Y.Doc();
    const origins = await transactions(again, () => restarted.loadDoc(docName, again));
    expect(origins).toEqual([PERSISTED_ORIGIN]);
    expect(Y.encodeStateVector(again)).toEqual(Y.encodeStateVector(doc));
  });

  it("a reconnecting client's undo stack still applies to the reloaded doc", async () => {
    const s = await session();
    const server = await s.open("cards");
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    const undo = new Y.UndoManager(contentMap(client), { trackedOrigins: new Set([user]) });
    const value = layoutFromDoc(client, layoutOf("data-table"));
    layoutPatch(client, layoutOf("data-table"), FILES["data-table"].edit(value), user);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));
    expect(await s.adapter.storeDoc(docName, server)).toBe(true);
    const edited = await read(FILES["data-table"].path);

    const restarted = createProjectFileAdapter(project);
    await restarted.loadProject(new Y.Doc());
    const again = new Y.Doc();
    await restarted.loadDoc(docName, again);
    Y.applyUpdate(client, Y.encodeStateAsUpdate(again, Y.encodeStateVector(client)));
    Y.applyUpdate(again, Y.encodeStateAsUpdate(client, Y.encodeStateVector(again)));
    expect(textOf("data-table", again)).toBe(edited);

    undo.undo();
    Y.applyUpdate(again, Y.encodeStateAsUpdate(client, Y.encodeStateVector(again)));
    expect(textOf("data-table", again)).toBe(FILES["data-table"].text);
    expect(await restarted.storeDoc(docName, again)).toBe(true);
    expect(await read(FILES["data-table"].path)).toBe(FILES["data-table"].text);
  });

  it("a persisted project equal to the files loads as is; files changed meanwhile are one disk transaction", async () => {
    const s = await session();
    await s.adapter.storeProject(s.project);

    const same = new Y.Doc();
    const quiet = await transactions(same, () =>
      createProjectFileAdapter(project).loadProject(same),
    );
    expect(quiet).toEqual([PERSISTED_ORIGIN]);
    expect(readProject(same)).toEqual(readProject(s.project));

    await rm(join(dir, "far.script.json"));
    await put("materials/mud.json", FILES.material.text);
    const changed = new Y.Doc();
    const origins = await transactions(changed, () =>
      createProjectFileAdapter(project).loadProject(changed),
    );
    expect(origins).toEqual([PERSISTED_ORIGIN, { kind: "disk" }]);
    expect(readProject(changed).assets["far-script"]?.deleted?.by).toBe("disk");
    expect(readProject(changed).assets.mud).toMatchObject({ kind: "material" });
  });

  it("a binary replaced while the server was down reconciles with both hashes in its history", async () => {
    const png = await fixture("texture.png");
    const other = await fixture("hero.png");
    await putBytes("crate.png", png);
    const s = await session();
    await s.adapter.storeProject(s.project);
    await putBytes("crate.png", other);

    const restarted = await session(createProjectFileAdapter(project));
    expect(restarted.entry("crate")).toMatchObject({
      sha256: sha(other),
      meta: { width: 32, height: 8 },
    });
    expect(readProject(restarted.project).history.crate!.map((h) => h.sha256)).toEqual([
      sha(png),
      sha(other),
    ]);
    expect(await restarted.adapter.storeProject(restarted.project)).toBe(true);
    expect(await sidecarAt("crate.png")).toMatchObject({ sha256: sha(other) });
  });

  it("forget drops an unloaded doc: a later store doesn't write it", async () => {
    const s = await session();
    const doc = await s.open("cards");
    await s.adapter.persist(docName, doc);
    s.adapter.forget(docName);
    const value = layoutFromDoc(doc, layoutOf("data-table"));
    layoutPatch(doc, layoutOf("data-table"), FILES["data-table"].edit(value), user);
    s.apply([{ op: "deleteAsset", id: "cards", force: true }]);
    await s.adapter.storeProject(s.project);
    s.apply([{ op: "restoreAsset", id: "cards" }]);
    await s.adapter.storeProject(s.project);
    expect(await read(FILES["data-table"].path)).toBe(FILES["data-table"].text);
  });
});

describe("write-back: scenes and prefabs", () => {
  let copy: ProjectCopy;
  const YARD = "scene:engine.engine-yard";
  const SINK = "scene:engine.kitchen-sink";
  const POST = "asset:engine.post";
  const engine = createRegistry();
  const sceneText = (doc: Y.Doc) => formatScene(docToScene(doc)).text;

  beforeEach(async () => {
    copy = await engineProjectCopy([
      "engine-yard.json",
      "kitchen-sink.json",
      "prefabs/post.json",
      "prefabs/gate.json",
    ]);
    ({ dir, cacheDir, project } = copy);
  });

  afterEach(() => copy.remove());

  it("scene: seeds layout 2 from the file with no log, and a doc edit writes canonical text once", async () => {
    const s = await session();
    const doc = await s.open("engine-yard");
    expect(sceneText(doc)).toBe(await read("engine-yard.json"));
    expect(readLog(doc)).toEqual([]);
    expect(docMeta(doc)).toMatchObject({
      layout: COLLAB_LAYOUT_VERSION,
      project: "engine",
      key: "engine-yard",
    });
    expect(await s.adapter.storeDoc(YARD, doc)).toBe(false);

    applyOpsToDoc(doc, { ops: [{ op: "setScene", set: { name: "moved" } }] }, user, engine);
    expect(await s.adapter.storeDoc(YARD, doc)).toBe(true);
    expect(await read("engine-yard.json")).toBe(sceneText(doc));
    expect(await s.adapter.storeDoc(YARD, doc)).toBe(false);
    expect(await gone("engine-yard.json.asset.json")).toBe(true);
    expect(await s.adapter.syncPath("engine-yard.json", s.lookup, s.project)).toEqual({
      kind: "unchanged",
    });
  });

  it("scene: a disk edit is diffed into one disk transaction; a reformat or a broken file changes nothing", async () => {
    const s = await session();
    const doc = await s.open("engine-yard");
    const def = parseSceneOrThrow(await read("engine-yard.json"), engine);
    def.entities = def.entities!.filter((e) => e.id !== "readme");
    await put("engine-yard.json", JSON.stringify(def));
    const origins = await transactions(doc, async () => {
      expect(await s.adapter.syncPath("engine-yard.json", s.lookup, s.project)).toEqual({
        kind: "applied",
        ops: 1,
      });
    });
    expect(origins).toEqual([{ kind: "disk" }]);
    expect(readLog(doc).map((e) => [e.actor, e.label])).toEqual([
      [{ kind: "disk" }, "Changed on disk"],
    ]);
    expect(sceneText(doc)).toBe(formatScene(def).text);
    expect(await s.adapter.storeDoc(YARD, doc)).toBe(true);
    expect(await read("engine-yard.json")).toBe(formatScene(def).text);

    const before = sceneText(doc);
    await put("engine-yard.json", JSON.stringify(JSON.parse(before)));
    expect(await s.adapter.syncPath("engine-yard.json", s.lookup, s.project)).toEqual({
      kind: "unchanged",
    });
    await put("engine-yard.json", "{ half an edit");
    expect((await s.adapter.syncPath("engine-yard.json", s.lookup, s.project)).kind).toBe(
      "refused",
    );
    await put("engine-yard.json", JSON.stringify({ ...JSON.parse(before), v: 3 }));
    expect((await s.adapter.syncPath("engine-yard.json", s.lookup, s.project)).kind).toBe(
      "refused",
    );
    expect(sceneText(doc)).toBe(before);
    expect(readLog(doc)).toHaveLength(1);
  });

  it("scene: a registry move moves the file; a disk move pairs into a moveAsset keeping the key", async () => {
    const s = await session();
    await s.open("engine-yard");
    s.apply([{ op: "moveAsset", ids: ["engine-yard"], to: "levels/" }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await gone("engine-yard.json")).toBe(true);
    expect(await read("levels/engine-yard.json")).toContain('"v"');
    for (const path of ["engine-yard.json", "levels/engine-yard.json"])
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "unchanged" });

    await rename(join(dir, "levels/engine-yard.json"), join(dir, "engine-yard.json"));
    for (const path of ["levels/engine-yard.json", "engine-yard.json"])
      expect(await s.adapter.syncPath(path, s.lookup, s.project)).toEqual({ kind: "pending" });
    const origins = await transactions(s.project, async () => {
      expect(await s.adapter.settle(s.lookup, s.project)).toEqual([{ kind: "applied", ops: 1 }]);
    });
    expect(origins).toEqual([{ kind: "disk" }]);
    expect(s.entry("engine-yard")).toMatchObject({ path: "engine-yard.json", id: "engine-yard" });
  });

  it("scene: delete trashes the file, restore rewrites it from the cache, a disk unlink is a deleteAsset", async () => {
    const s = await session();
    const doc = await s.open("engine-yard");
    const text = sceneText(doc);
    s.apply([{ op: "deleteAsset", id: "engine-yard" }]);
    await s.adapter.storeProject(s.project);
    expect(await gone("engine-yard.json")).toBe(true);
    s.apply([{ op: "restoreAsset", id: "engine-yard" }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await read("engine-yard.json")).toBe(text);

    await rm(join(dir, "engine-yard.json"));
    expect(await s.adapter.syncPath("engine-yard.json", s.lookup, s.project)).toEqual({
      kind: "pending",
    });
    expect(await s.adapter.settle(s.lookup, s.project)).toEqual([{ kind: "applied", ops: 1 }]);
    expect(s.entry("engine-yard")!.deleted?.by).toBe("disk");
  });

  it("prefab: a prefab doc edit writes the prefab file; the scene's file stays and its instances follow", async () => {
    const s = await session();
    const sink = await s.open("kitchen-sink");
    const post = await s.open("post");
    const sinkText = await read("kitchen-sink.json");
    const prefab = docToPrefab(post);
    const moved = {
      ...prefab,
      entities: prefab.entities.map((e, i) => (i === 0 ? { ...e, at: [0, -77] } : e)),
    } as Prefab;
    expect(prefabPatch(post, moved, user)).not.toBeNull();
    expect(await s.adapter.storeDoc(POST, post)).toBe(true);
    expect(await read("prefabs/post.json")).toBe(formatPrefab(moved));
    expect(await s.adapter.storeDoc(POST, post)).toBe(false);
    expect(await s.adapter.storeDoc(SINK, sink)).toBe(false);
    expect(await read("kitchen-sink.json")).toBe(sinkText);
    expect(await s.adapter.syncPath("prefabs/post.json", s.lookup, s.project)).toEqual({
      kind: "unchanged",
    });

    // A disk edit adding an instance resolves it against the edited prefab.
    const def = JSON.parse(sinkText) as SceneDefinition;
    def.instances = [...def.instances!, { id: "post-3", prefab: "post", at: [100, 100] }];
    await put("kitchen-sink.json", formatScene(def).text);
    expect(await s.adapter.syncPath("kitchen-sink.json", s.lookup, s.project)).toEqual({
      kind: "applied",
      ops: 1,
    });
    expect(docToScene(sink).instances!.map((i) => i.id)).toContain("post-3");
  });

  it("prefab: a disk edit of its file is one disk transaction on the open prefab doc", async () => {
    const s = await session();
    const post = await s.open("post");
    const prefab = JSON.parse(await read("prefabs/post.json")) as Prefab;
    const next = { ...prefab, entities: [...prefab.entities].reverse().slice(1) };
    await put("prefabs/post.json", formatPrefab(next));
    const origins = await transactions(post, async () => {
      expect(await s.adapter.syncPath("prefabs/post.json", s.lookup, s.project)).toEqual({
        kind: "applied",
        ops: 1,
      });
    });
    expect(origins).toEqual([{ kind: "disk" }]);
    expect(formatPrefab(docToPrefab(post))).toBe(formatPrefab(next));
    expect(readLog(post).map((e) => e.label)).toEqual(["Changed on disk"]);
  });

  it("prefab: a registry move moves its file and a scene still names it by id; delete and restore round-trip", async () => {
    const s = await session();
    await s.open("kitchen-sink");
    const text = await read("prefabs/post.json");
    s.apply([{ op: "moveAsset", ids: ["post"], to: "parts/" }]);
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await read("parts/post.json")).toBe(text);
    expect(await gone("prefabs/post.json")).toBe(true);
    expect(JSON.parse(await read("kitchen-sink.json")).instances[0].prefab).toBe("post");

    s.apply([{ op: "deleteAsset", id: "post", force: true }]);
    await s.adapter.storeProject(s.project);
    expect(await gone("parts/post.json")).toBe(true);
    s.apply([{ op: "restoreAsset", id: "post" }]);
    await s.adapter.storeProject(s.project);
    expect(await read("parts/post.json")).toBe(text);
  });

  it("a persisted layout-1 scene migrates at load: its prefabs become assets with files", async () => {
    const lamp: Prefab = {
      kind: "prefab",
      v: 2,
      id: "lamp",
      entities: [{ id: "top", type: "marker", at: [0, -40] }],
    };
    const old = sceneToDoc(parseSceneOrThrow(await read("engine-yard.json"), engine));
    old.transact(() => {
      metaMap(old).delete("layout");
      prefabsMap(old).set("lamp", lamp);
    });
    const state = join(cacheDir, "docs", "scene", "engine.engine-yard.bin");
    await mkdir(dirname(state), { recursive: true });
    await writeFile(state, Y.encodeStateAsUpdate(old));

    const s = await session();
    const doc = await s.open("engine-yard");
    expect(docLayout(doc)).toBe(COLLAB_LAYOUT_VERSION);
    expect(prefabsMap(doc).size).toBe(0);
    expect(s.entry("lamp")).toMatchObject({ kind: "prefab", path: "prefabs/lamp.json" });
    expect(await s.adapter.storeProject(s.project)).toBe(true);
    expect(await read("prefabs/lamp.json")).toBe(formatPrefab(lamp));
  });
});

describe("write-back: replacing and moving every binary kind", () => {
  const variants = async (): Promise<
    Record<string, { path: string; a: Uint8Array; b: Uint8Array }>
  > => {
    const wav = await fixture("tone.wav");
    const louder = Buffer.from(wav);
    louder[louder.length - 1] = (louder[louder.length - 1]! + 1) % 256;
    const font = (await fixture("font.fnt")).toString("utf8");
    const recording = (await fixture("run.recording.json")).toString("utf8");
    return {
      texture: {
        path: "art/crate.png",
        a: await fixture("texture.png"),
        b: await fixture("hero.png"),
      },
      atlas: {
        path: "art/sheet.atlas.json",
        a: await fixture("hero.json"),
        b: await fixture("items.json"),
      },
      font: {
        path: "fonts/font.fnt",
        a: Buffer.from(font),
        b: Buffer.from(font.replace("lineHeight=9", "lineHeight=11")),
      },
      audio: { path: "sfx/tone.wav", a: wav, b: louder },
      recording: {
        path: "runs/run.recording.json",
        a: Buffer.from(recording),
        b: Buffer.from(recording.replace('"ticks": 120', '"ticks": 121')),
      },
    };
  };

  for (const kind of ["texture", "atlas", "font", "audio", "recording"]) {
    it(`${kind}: new bytes on disk are rehashed, and a registry move carries the sidecar`, async () => {
      const { path, a, b } = (await variants())[kind]!;
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
      await putBytes(path, a);
      const s = await session();
      const key = Object.keys(readProject(s.project).assets).find(
        (k) => s.entry(k)!.path === path,
      )!;
      expect(s.entry(key)).toMatchObject({ kind, sha256: sha(a), bytes: a.byteLength });
      await s.adapter.storeProject(s.project);

      await putBytes(path, b);
      const result = await s.adapter.syncPath(path, s.lookup, s.project);
      expect(result).toMatchObject({
        kind: "applied",
        changed: { sha256: sha(b), previous: sha(a) },
      });
      expect(s.entry(key)).toMatchObject({ sha256: sha(b), bytes: b.byteLength });
      await s.adapter.storeProject(s.project);
      expect(await sidecarAt(path)).toMatchObject({ sha256: sha(b), bytes: b.byteLength });

      const sidecar = await read(`${path}.asset.json`);
      const id = s.entry(key)!.id;
      s.apply([{ op: "moveAsset", ids: [id], to: "moved/" }]);
      expect(await s.adapter.storeProject(s.project)).toBe(true);
      const moved = `moved/${path.split("/").pop()}`;
      expect(await bytesAt(moved)).toEqual(Buffer.from(b));
      expect(await read(`${moved}.asset.json`)).toBe(sidecar);
      expect(await gone(path)).toBe(true);
      for (const p of [path, moved, `${moved}.asset.json`])
        expect(await s.adapter.syncPath(p, s.lookup, s.project)).toEqual({ kind: "unchanged" });
    });
  }
});
