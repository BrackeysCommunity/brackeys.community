import { access, readFile, rename, writeFile } from "node:fs/promises";

import type * as Y from "yjs";

import { applyOpsToDoc } from "../collab/apply";
import { docPrefabs, docToScene, sceneToDoc } from "../collab/convert";
import type { SceneOrigin } from "../collab/types";
import type { Registry } from "../game/types";
import { diffToOps } from "../scene/diff-to-ops";
import { formatScene } from "../scene/format";
import { parseScene } from "../scene/parse";
import { prefabBody } from "../scene/prefab";
import type { PrefabLibrary, SceneIssue, SceneOp } from "../scene/types";
import { createFileSceneStore } from "./handler";
import { readPrefabFiles, writePrefabFiles, type PrefabFiles } from "./prefab-files";
import { resolveScenePath, SCENE_NAME_PATTERN, ScenePathError } from "./scene-paths";

/** A scenes directory and the registry its scenes are judged by. */
export type SceneHome = { dir: string; registry: Registry };

/** The origin of every write the file adapter makes: seeding a doc and outside file changes. */
export const DISK_ORIGIN: SceneOrigin = { kind: "disk" };

/** Documents named `scene:<name>` hold the scene in `<dir>/<name>.json`. */
export const SCENE_DOC_PREFIX = "scene:";

export const sceneDocName = (name: string) => `${SCENE_DOC_PREFIX}${name}`;

/** The scene name a document name holds, or null when it isn't a scene document. */
export function sceneOfDocName(docName: string): string | null {
  if (!docName.startsWith(SCENE_DOC_PREFIX)) return null;
  const name = docName.slice(SCENE_DOC_PREFIX.length);
  return SCENE_NAME_PATTERN.test(name) ? name : null;
}

/** What a file change did to a doc. */
export type DiskSync =
  | { kind: "unchanged" }
  | { kind: "applied"; ops: number }
  | { kind: "refused"; reason: string; issues?: SceneIssue[] };

export type SceneFileAdapter = {
  list(): Promise<string[]>;
  /** Fills an empty doc from the scene's file. Throws when there is no such scene or it doesn't parse. */
  load(name: string, doc: Y.Doc): Promise<void>;
  /** Writes the doc's canonical text when it differs from the file; true when it wrote. */
  store(name: string, doc: Y.Doc): Promise<boolean>;
  /** Brings a file change into the doc as one `disk` transaction; the adapter's own writes are `unchanged`. */
  sync(name: string, doc: Y.Doc): Promise<DiskSync>;
  /** Drops what the adapter knows about a doc that was unloaded. */
  forget(name: string): void;
  /** The home a loaded scene lives in. */
  homeOf(name: string): SceneHome | undefined;
};

type Loaded = {
  file: string;
  home: SceneHome;
  text: string;
  /** The home's prefab files as last read or written, by id. */
  prefabs: Map<string, string>;
};

const canonical = (doc: Y.Doc) => formatScene(docToScene(doc)).text;

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
}

const sameTexts = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>) =>
  a.size === b.size && [...a].every(([id, text]) => b.get(id) === text);

/**
 * `definePrefab` ops for the prefab files that changed on disk since they
 * were last read or written (`before`): another doc's write-back, or an
 * edit by hand. A file that doesn't parse leaves the doc's copy alone.
 */
function prefabChanges(
  before: ReadonlyMap<string, string>,
  disk: PrefabFiles,
  held: PrefabLibrary,
): SceneOp[] {
  const ops: SceneOp[] = [];
  for (const [id, text] of disk.texts) {
    if (before.get(id) === text) continue;
    ops.push({ op: "definePrefab", id, prefab: prefabBody(disk.prefabs.get(id)!) });
  }
  const broken = new Set(disk.problems.map((p) => p.id));
  for (const id of before.keys())
    if (!disk.texts.has(id) && !broken.has(id) && held.has(id))
      ops.push({ op: "definePrefab", id, prefab: null });
  return ops;
}

/**
 * Files to docs and back, per scene. Each loaded scene remembers the text
 * last read from or written to its file, so a store writes only when the
 * canonical text changed, and a file event caused by that write is a no-op.
 * Calls for one scene must not overlap; the collab server queues them.
 */
export function createSceneFileAdapter(homes: readonly SceneHome[]): SceneFileAdapter {
  const loaded = new Map<string, Loaded>();
  const listing = createFileSceneStore(homes.map((h) => h.dir));

  async function locate(name: string): Promise<{ file: string; home: SceneHome }> {
    const hits: { file: string; home: SceneHome }[] = [];
    for (const home of homes) {
      const file = resolveScenePath(home.dir, name);
      if (await exists(file)) hits.push({ file, home });
    }
    if (hits.length === 0) throw new ScenePathError(`No scene named ${JSON.stringify(name)}.`);
    if (hits.length > 1)
      throw new ScenePathError(
        `Scene ${JSON.stringify(name)} is in more than one scenes directory: ${hits.map((h) => h.home.dir).join(", ")}.`,
      );
    return hits[0]!;
  }

  function parse(text: string, home: SceneHome) {
    return parseScene(text, home.registry);
  }

  return {
    list: () => listing.list(),

    async load(name, doc) {
      const { file, home } = await locate(name);
      const text = await readFile(file, "utf8");
      const parsed = parse(text, home);
      if (!parsed.ok) {
        const first = parsed.issues[0];
        throw new Error(`${name}.json doesn't parse${first ? `: ${first.message}` : "."}`);
      }
      const files = await readPrefabFiles(home.dir, home.registry);
      sceneToDoc(parsed.def, { doc, origin: DISK_ORIGIN, prefabs: files.prefabs });
      loaded.set(name, { file, home, text, prefabs: files.texts });
    },

    async store(name, doc) {
      const entry = loaded.get(name);
      if (!entry) return false;
      const prefabs = await writePrefabFiles(entry.home.dir, entry.prefabs, docPrefabs(doc));
      const prefabsWritten = !sameTexts(prefabs, entry.prefabs);
      entry.prefabs = prefabs;
      const text = canonical(doc);
      if (text === entry.text) return prefabsWritten;
      await writeAtomic(entry.file, text);
      entry.text = text;
      return true;
    },

    async sync(name, doc) {
      const entry = loaded.get(name);
      if (!entry) return { kind: "unchanged" };
      let text: string;
      try {
        text = await readFile(entry.file, "utf8");
      } catch (e) {
        if ((e as { code?: string }).code === "ENOENT")
          return { kind: "refused", reason: `${name}.json was removed; the doc keeps its state.` };
        throw e;
      }
      const files = await readPrefabFiles(entry.home.dir, entry.home.registry);
      const prefabOps = prefabChanges(entry.prefabs, files, docPrefabs(doc));
      if (text === entry.text && prefabOps.length === 0) {
        entry.prefabs = files.texts;
        return { kind: "unchanged" };
      }
      const parsed = parse(text, entry.home);
      if (!parsed.ok)
        return {
          kind: "refused",
          reason: `${name}.json changed on disk but doesn't parse.`,
          issues: parsed.issues,
        };
      const current = docToScene(doc);
      let batch;
      try {
        batch = diffToOps(current, parsed.def, entry.home.registry);
      } catch (e) {
        return { kind: "refused", reason: (e as Error).message };
      }
      batch = { ...batch, ops: [...prefabOps, ...batch.ops] };
      if (batch.ops.length === 0) {
        entry.text = text;
        entry.prefabs = files.texts;
        return { kind: "unchanged" };
      }
      const result = applyOpsToDoc(doc, batch, DISK_ORIGIN, entry.home.registry, {
        label: "Changed on disk",
        validate: "none",
      });
      if (!result.ok)
        return { kind: "refused", reason: result.issue.message, issues: [result.issue] };
      entry.text = text;
      entry.prefabs = files.texts;
      return { kind: "applied", ops: batch.ops.length };
    },

    forget(name) {
      loaded.delete(name);
    },

    homeOf: (name) => loaded.get(name)?.home,
  };
}
