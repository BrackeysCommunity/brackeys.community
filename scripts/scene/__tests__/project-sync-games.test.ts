// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  contentMap,
  historyRows,
  layoutFromDoc,
  layoutPatch,
  readLog,
  readProjectLog,
  type DocOrigin,
  type SessionDoc,
} from "@jams/engine/collab";
import {
  formatAssetDoc,
  type AssetEntry,
  type DocKindDef,
  type DocLayout,
  type ProjectOpBatch,
} from "@jams/engine/project";
import {
  createProjectFileAdapter,
  listenSceneCollab,
  readFileProject,
  type ListeningSceneCollab,
  type ProjectFileAdapter,
} from "@jams/engine/vite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { tacticsGame } from "../../../src/games/tactics/index";
import type { ToolContext } from "../context";
import { GAME_PRESETS, type GamePreset } from "../game-templates";
import { agentOrigin, openProjectClient, type ProjectClient } from "../project-client";
import {
  DEFAULT_PROJECT_GLOBS,
  discoverProjects,
  openProject,
  type ProjectHandle,
} from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { GAME_NEW_STAGE, gameNew } from "../tools/game-new";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const TACTICS = join(REPO, "src", "games", "tactics");
const REPO_PROJECTS = ["engine", "platformer", "tactics"] as const;
const PRESET_ID: Record<GamePreset, string> = {
  "top-down": "sync-rover",
  "side-view": "sync-leaper",
  grid: "sync-crates",
  turns: "sync-steps",
};
const EMPTY = { projects: [], loadRapier: loadCompatRapier } satisfies ToolContext;

const UNIT_CLASSES = "unit-classes";
const SETTINGS = "tactics-settings";
const UNIT_CLASSES_FILE = "data/unit-classes.json";
const SETTINGS_FILE = "game-settings.json";

const ADA: DocOrigin = { kind: "user", userId: "ada", name: "Ada" };
const BO: DocOrigin = { kind: "user", userId: "bo", name: "Bo" };
const AGENT = agentOrigin({ agent: "claude", onBehalfOf: "ada" });

type Row = {
  id: string;
  attack: number;
  hp: number;
  move: number;
  range: number[];
  sight: boolean;
};
type Table = { rows: Row[] } & Record<string, unknown>;
type Settings = { game: Record<string, unknown> } & Record<string, unknown>;

/** Holds the temp caches and the tactics copies the write tests change; never the repo. */
let work: string;
/** Where the `game new` presets are generated: under the game-new stage, so their imports resolve. */
let stage: string;
let repoProjects: ProjectHandle[] = [];
let generated: ProjectHandle[] = [];

const cacheDirOf = (id: string) => join(work, "cache", id);

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 10_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A file's text, or "" while a write-back has it mid-move. */
async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** The changed transactions on `doc` while `run` runs, by origin. */
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

/** The dotted paths of every key `doc`'s content changes in while it's observed. */
function touchedKeys(doc: Y.Doc): string[] {
  const touched: string[] = [];
  contentMap(doc).observeDeep((events) => {
    for (const e of events)
      for (const key of e.changes.keys.keys()) touched.push([...e.path, key].join("."));
  });
  return touched;
}

/** The tactics project's files a sync test changes, copied to `dir`: no art, UI or code, which other suites own. */
async function copyTactics(dir: string): Promise<ProjectHandle> {
  await cp(TACTICS, dir, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      return !["art", "ui", "__tests__"].includes(name) && !name.endsWith(".ts");
    },
  });
  return openProject(dir, { game: tacticsGame, cacheDir: cacheDirOf(basename(dir)) });
}

const handleOf = (list: readonly ProjectHandle[], id: string): ProjectHandle => {
  const handle = list.find((p) => p.file.id === id);
  if (!handle) throw new Error(`no project ${id} among ${list.map((p) => p.file.id).join(", ")}`);
  return handle;
};

const docKind = (handle: ProjectHandle, kind: string): DocKindDef | null => {
  const def = handle.kinds.get(kind);
  return def?.storage === "doc" ? (def as DocKindDef) : null;
};

/**
 * Every live doc asset of the project, loaded through the adapter and copied
 * to a second client: both format back to the file's bytes. Returns the kinds covered.
 */
async function roundTrips(handle: ProjectHandle): Promise<string[]> {
  const adapter = createProjectFileAdapter(handle);
  const scan = await adapter.scan();
  expect(scan.problems, handle.file.id).toEqual([]);
  const covered = new Set<string>();
  for (const entry of Object.values(scan.state.assets)) {
    const kind = docKind(handle, entry.kind);
    if (!kind || entry.deleted !== undefined) continue;
    const file = await readFile(join(handle.dir, entry.path), "utf8");
    const name = adapter.docNameOf(entry);
    const doc = new Y.Doc();
    await adapter.loadDoc(name, doc);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    for (const d of [doc, remote])
      expect(
        formatAssetDoc(kind, adapter.valueOf(name, d)),
        `${handle.file.id}: ${entry.path}`,
      ).toBe(file);
    covered.add(entry.kind);
  }
  return [...covered].sort();
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "project-sync-games-"));
  repoProjects = await discoverProjects(REPO, DEFAULT_PROJECT_GLOBS, { cacheDirOf });

  await mkdir(GAME_NEW_STAGE, { recursive: true });
  stage = await mkdtemp(join(GAME_NEW_STAGE, "sync-"));
  const games = join(stage, "src", "games");
  await mkdir(games, { recursive: true });
  for (const preset of GAME_PRESETS) {
    const out = await gameNew({ id: PRESET_ID[preset], preset, dir: games }, EMPTY);
    expect(out.exitCode, out.text).toBe(0);
  }
  generated = await discoverProjects(stage, DEFAULT_PROJECT_GLOBS, { cacheDirOf });
}, 180_000);

afterAll(async () => {
  if (stage) await rm(stage, { recursive: true, force: true });
  if (work) await rm(work, { recursive: true, force: true });
});

describe("per kind: every doc file round-trips byte-identical through its kind's layout", () => {
  it("discovers the engine's, the platformer's and the tactics project", () => {
    expect(repoProjects.map((p) => p.file.id)).toEqual(expect.arrayContaining([...REPO_PROJECTS]));
    expect(generated.map((p) => p.file.id).sort()).toEqual(Object.values(PRESET_ID).sort());
  });

  for (const id of REPO_PROJECTS)
    it(`${id}: every doc asset, also across the wire`, { timeout: 60_000 }, async () => {
      const covered = await roundTrips(handleOf(repoProjects, id));
      expect(covered.length).toBeGreaterThan(0);
      if (id === "tactics")
        expect(covered).toEqual(
          expect.arrayContaining([
            "checks",
            "data-table",
            "game-settings",
            "input-map",
            "prefab",
            "scene",
          ]),
        );
    });

  for (const preset of GAME_PRESETS)
    it(
      `game new --preset ${preset}: every doc asset, also across the wire`,
      { timeout: 60_000 },
      async () => {
        const covered = await roundTrips(handleOf(generated, PRESET_ID[preset]));
        expect(covered).toEqual(expect.arrayContaining(["checks", "input-script", "scene"]));
      },
    );

  it(
    "two clients editing different rows of unit-classes converge, each row keeping its key",
    { timeout: 30_000 },
    async () => {
      const handle = handleOf(repoProjects, "tactics");
      const adapter = createProjectFileAdapter(handle);
      const scan = await adapter.scan();
      const entry = Object.values(scan.state.assets).find((e) => e.id === UNIT_CLASSES)!;
      const kind = docKind(handle, entry.kind)!;
      const layout = kind.layout as DocLayout;
      const name = adapter.docNameOf(entry);
      const seed = new Y.Doc();
      await adapter.loadDoc(name, seed);

      const [a, b] = [new Y.Doc(), new Y.Doc()];
      for (const d of [a, b]) Y.applyUpdate(d, Y.encodeStateAsUpdate(seed));
      const keys = [...(contentMap(a).get("rows") as Y.Map<unknown>).keys()].sort();

      const edit = (doc: Y.Doc, id: string, change: Partial<Row>, origin: DocOrigin) => {
        const value = layoutFromDoc(doc, layout) as Table;
        layoutPatch(
          doc,
          layout,
          { ...value, rows: value.rows.map((r) => (r.id === id ? { ...r, ...change } : r)) },
          origin,
        );
      };
      edit(a, "knight", { hp: 12 }, ADA);
      edit(b, "scout", { move: 6, sight: true }, BO);
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

      const merged = layoutFromDoc(a, layout) as Table;
      expect(layoutFromDoc(b, layout)).toEqual(merged);
      expect(merged.rows.find((r) => r.id === "knight")?.hp).toBe(12);
      expect(merged.rows.find((r) => r.id === "scout")).toMatchObject({ move: 6, sight: true });
      expect(merged.rows.map((r) => r.id)).toEqual(["knight", "archer", "scout"]);
      expect([...(contentMap(b).get("rows") as Y.Map<unknown>).keys()].sort()).toEqual(keys);
      expect(formatAssetDoc(kind, layoutFromDoc(b, layout))).toBe(formatAssetDoc(kind, merged));
    },
  );
});

describe("write-back: tactics' disk edits over the file adapter", () => {
  let handle: ProjectHandle;
  let adapter: ProjectFileAdapter;
  let project: Y.Doc;
  const docs = new Map<string, Y.Doc>();
  const lookup = (name: string) => docs.get(name);

  let assets: AssetEntry[] = [];
  const entryOf = (id: string): AssetEntry => {
    const entry = assets.find((e) => e.id === id);
    if (!entry) throw new Error(`no asset ${id}`);
    return entry;
  };
  const kindOf = (id: string) => docKind(handle, entryOf(id).kind)!;
  const pathOf = (rel: string) => join(handle.dir, rel);

  async function open(id: string): Promise<Y.Doc> {
    const name = adapter.docNameOf(entryOf(id));
    const doc = new Y.Doc();
    await adapter.loadDoc(name, doc);
    docs.set(name, doc);
    return doc;
  }

  beforeAll(async () => {
    handle = await copyTactics(join(work, "tactics-disk"));
    adapter = createProjectFileAdapter(handle);
    project = new Y.Doc();
    expect(await adapter.loadProject(project)).toEqual([]);
    assets = Object.values((await adapter.scan()).state.assets);
  }, 60_000);

  it(
    "a hand edit of game-settings.json's game.critChance is one disk transaction; the next store writes canonical text",
    { timeout: 30_000 },
    async () => {
      const doc = await open(SETTINGS);
      const name = adapter.docNameOf(entryOf(SETTINGS));
      const kind = kindOf(SETTINGS);
      const touched = touchedKeys(doc);
      const value = JSON.parse(await readFile(pathOf(SETTINGS_FILE), "utf8")) as Settings;
      const next = { ...value, game: { ...value.game, critChance: 0.25 } };
      const hand = `${JSON.stringify(next, null, 4)}\n`;
      await writeFile(pathOf(SETTINGS_FILE), hand);

      const origins = await transactions(doc, async () => {
        expect(await adapter.syncPath(SETTINGS_FILE, lookup, project)).toEqual({
          kind: "applied",
          ops: 1,
        });
      });
      expect(origins).toEqual([{ kind: "disk" }]);
      expect(touched).toEqual(["game.critChance"]);
      expect((adapter.valueOf(name, doc) as Settings).game.critChance).toBe(0.25);
      expect(await readFile(pathOf(SETTINGS_FILE), "utf8")).toBe(hand);

      const canonical = formatAssetDoc(kind, next);
      expect(canonical).not.toBe(hand);
      expect(await adapter.storeDoc(name, doc)).toBe(true);
      expect(await readOrEmpty(pathOf(SETTINGS_FILE))).toBe(canonical);
      expect(await adapter.storeDoc(name, doc)).toBe(false);
      expect(await adapter.syncPath(SETTINGS_FILE, lookup, project)).toEqual({ kind: "unchanged" });
    },
  );

  it(
    "a hand edit of unit-classes.json is one disk transaction keeping every row's key; the next store writes canonical text",
    { timeout: 30_000 },
    async () => {
      const doc = await open(UNIT_CLASSES);
      const name = adapter.docNameOf(entryOf(UNIT_CLASSES));
      const kind = kindOf(UNIT_CLASSES);
      const rows = contentMap(doc).get("rows") as Y.Map<unknown>;
      const keys = [...rows.keys()].sort();
      const touched = touchedKeys(doc);
      const value = JSON.parse(await readFile(pathOf(UNIT_CLASSES_FILE), "utf8")) as Table;
      const next = {
        ...value,
        rows: value.rows.map((r) => (r.id === "archer" ? { ...r, range: [2, 4], hp: 7 } : r)),
      };
      const hand = `${JSON.stringify(next, null, 2)}\n`;
      await writeFile(pathOf(UNIT_CLASSES_FILE), hand);

      const origins = await transactions(doc, async () => {
        expect(await adapter.syncPath(UNIT_CLASSES_FILE, lookup, project)).toEqual({
          kind: "applied",
          ops: 1,
        });
      });
      expect(origins).toEqual([{ kind: "disk" }]);
      expect(touched.length).toBeGreaterThan(0);
      expect(touched.every((t) => t.startsWith("rows."))).toBe(true);
      expect([...rows.keys()].sort()).toEqual(keys);
      const archer = (adapter.valueOf(name, doc) as Table).rows.find((r) => r.id === "archer");
      expect(archer).toMatchObject({ range: [2, 4], hp: 7 });

      const canonical = formatAssetDoc(kind, next);
      expect(canonical).not.toBe(hand);
      expect(await adapter.storeDoc(name, doc)).toBe(true);
      expect(await readOrEmpty(pathOf(UNIT_CLASSES_FILE))).toBe(canonical);
      expect(await adapter.storeDoc(name, doc)).toBe(false);
      expect(await adapter.syncPath(UNIT_CLASSES_FILE, lookup, project)).toEqual({
        kind: "unchanged",
      });
    },
  );
});

describe("live: tactics on the dev collab server, a human and an agent", () => {
  let handle: ProjectHandle;
  let server: ListeningSceneCollab;
  let human: ProjectClient;
  let other: ProjectClient;
  let agent: ProjectClient;
  const held = new Map<string, SessionDoc>();

  const entryOf = (id: string): AssetEntry => {
    const entry = human.session.view().byId.get(id);
    if (!entry) throw new Error(`no asset ${id}`);
    return entry;
  };
  const heldDoc = (id: string): SessionDoc => {
    const doc = held.get(id);
    if (!doc) throw new Error(`the human doesn't hold ${id}`);
    return doc;
  };
  const valueOf = (id: string) => {
    const d = heldDoc(id);
    return layoutFromDoc(d.doc, d.layout!) as Record<string, unknown>;
  };
  const row = (id: string) => (valueOf(UNIT_CLASSES) as Table).rows.find((r) => r.id === id);
  const lastRow = (id: string) => {
    const d = heldDoc(id);
    return historyRows(readLog(d.doc), readProjectLog(human.session.projectDoc), d.name).at(-1);
  };
  const editAsset = (id: string, edits: unknown[]): ProjectOpBatch =>
    ({ v: 1, ops: [{ op: "editAsset", id, edits }] }) as ProjectOpBatch;
  const kindOf = (id: string) => docKind(handle, entryOf(id).kind)!;
  const fileOf = (rel: string) => join(handle.dir, rel);

  const client = (origin: DocOrigin) =>
    openProjectClient({
      project: "tactics",
      url: server.url,
      registry: handle.registry,
      kinds: handle.kinds,
      origin,
    });

  beforeAll(async () => {
    handle = await copyTactics(join(work, "tactics-live"));
    server = await listenSceneCollab({
      projects: [
        await readFileProject(handle.dir, { game: tacticsGame, cacheDir: handle.cacheDir }),
      ],
      debounceMs: 50,
      warn: () => undefined,
    });
    human = await client(ADA);
    other = await client(BO);
    agent = await client(AGENT);
    for (const id of [UNIT_CLASSES, SETTINGS]) {
      const name = human.session.docNameFor(entryOf(id));
      if (!name) throw new Error(`${id} has no doc`);
      held.set(id, await human.session.open(name));
    }
  }, 60_000);

  afterAll(async () => {
    for (const d of held.values()) human?.session.release(d.name);
    await Promise.all([human?.close(), other?.close(), agent?.close()]);
    await server?.close();
  });

  it(
    "two clients editing different rows of unit-classes at once converge, on disk too",
    { timeout: 30_000 },
    async () => {
      const [mine, theirs] = await Promise.all([
        human.apply(editAsset(UNIT_CLASSES, [{ set: "/rows/@knight/attack", value: 5 }])),
        other.apply(editAsset(UNIT_CLASSES, [{ set: "/rows/@scout/move", value: 6 }])),
      ]);
      expect(mine.ok, JSON.stringify(mine)).toBe(true);
      expect(theirs.ok, JSON.stringify(theirs)).toBe(true);
      await until(
        () => row("knight")?.attack === 5 && row("scout")?.move === 6,
        "both edits in the human's doc",
      );
      const otherDoc = await other.session.open(other.session.docNameFor(entryOf(UNIT_CLASSES))!);
      await until(
        () =>
          JSON.stringify(layoutFromDoc(otherDoc.doc, otherDoc.layout!)) ===
          JSON.stringify(valueOf(UNIT_CLASSES)),
        "the other client to converge",
      );
      other.session.release(otherDoc.name);
      const canonical = formatAssetDoc(kindOf(UNIT_CLASSES), valueOf(UNIT_CLASSES));
      await until(
        async () => (await readOrEmpty(fileOf(UNIT_CLASSES_FILE))) === canonical,
        "the merged table on disk",
      );
      human.session.undo();
      expect(row("knight")?.attack).toBe(4);
      expect(row("scout")?.move).toBe(6);
    },
  );

  it(
    "a hand edit of game-settings.json reaches the human's doc; the next store writes canonical text",
    { timeout: 30_000 },
    async () => {
      const path = fileOf(SETTINGS_FILE);
      const value = JSON.parse(await readFile(path, "utf8")) as Settings;
      const next = { ...value, game: { ...value.game, critChance: 0.3 } };
      await writeFile(path, `${JSON.stringify(next, null, 4)}\n`);
      await until(
        () => (valueOf(SETTINGS).game as Record<string, unknown>).critChance === 0.3,
        "the disk edit in the human's doc",
      );
      expect(human.session.canUndo()).toBe(false);

      const own = await human.apply(editAsset(SETTINGS, [{ set: "/game/aiStepTicks", value: 30 }]));
      expect(own.ok, JSON.stringify(own)).toBe(true);
      const canonical = formatAssetDoc(kindOf(SETTINGS), {
        ...next,
        game: { ...next.game, aiStepTicks: 30 },
      });
      await until(
        async () => (await readOrEmpty(path)) === canonical,
        "the canonical settings on disk",
      );
      human.session.undo();
      expect((valueOf(SETTINGS).game as Record<string, unknown>).aiStepTicks).toBe(20);
      expect((valueOf(SETTINGS).game as Record<string, unknown>).critChance).toBe(0.3);
      expect(human.session.canUndo()).toBe(false);
    },
  );

  it(
    "an agent's editAsset of /rows/@archer/range lands in the human's doc and history as the agent, off the human's undo stack",
    { timeout: 30_000 },
    async () => {
      expect(human.session.canUndo()).toBe(false);
      const result = await agent.apply(
        editAsset(UNIT_CLASSES, [{ set: "/rows/@archer/range", value: [2, 4] }]),
        { label: "Longer bows" },
      );
      if (!result.ok) throw new Error(`${result.issue.code}: ${result.issue.message}`);
      await until(
        () => JSON.stringify(row("archer")?.range) === "[2,4]",
        "the agent's edit in the human's doc",
      );
      expect(lastRow(UNIT_CLASSES)?.actor).toEqual(AGENT);
      expect(readLog(heldDoc(UNIT_CLASSES).doc).at(-1)).toMatchObject({
        label: "Longer bows",
        actor: AGENT,
      });
      expect(human.session.canUndo()).toBe(false);

      const own = await human.apply(
        editAsset(UNIT_CLASSES, [{ set: "/rows/@knight/hp", value: 12 }]),
      );
      expect(own.ok).toBe(true);
      expect(human.session.canUndo()).toBe(true);
      human.session.undo();
      expect(row("knight")?.hp).toBe(10);
      expect(row("archer")?.range).toEqual([2, 4]);
      expect(human.session.canUndo()).toBe(false);

      const canonical = formatAssetDoc(kindOf(UNIT_CLASSES), valueOf(UNIT_CLASSES));
      await until(
        async () => (await readOrEmpty(fileOf(UNIT_CLASSES_FILE))) === canonical,
        "the agent's edit on disk",
      );
    },
  );

  it(
    "an agent's range outside the row schema is refused with schema, and nothing changes",
    { timeout: 30_000 },
    async () => {
      const before = JSON.stringify(valueOf(UNIT_CLASSES));
      const logged = readLog(heldDoc(UNIT_CLASSES).doc).length;
      for (const value of [[0, 3], [2, 13], "far", [2]]) {
        const result = await agent.apply(
          editAsset(UNIT_CLASSES, [{ set: "/rows/@archer/range", value }]),
        );
        expect(result.ok, JSON.stringify(value)).toBe(false);
        if (!result.ok) expect(result.issue.code, JSON.stringify(value)).toBe("schema");
      }
      await agent.pushed();
      expect(JSON.stringify(valueOf(UNIT_CLASSES))).toBe(before);
      expect(readLog(heldDoc(UNIT_CLASSES).doc)).toHaveLength(logged);
      expect(human.session.canUndo()).toBe(false);
    },
  );
});
