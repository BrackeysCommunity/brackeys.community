import { z } from "zod";

import { withProject } from "../game/define";
import type { Registry } from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { isErrorIssue, makeIssue } from "../scene/issues";
import { SCHEMA_ID_BASE, toJsonSchema } from "../scene/json-schema";
import { parseScene } from "../scene/parse";
import { parsePrefab, prefabsUsedBy, reachPrefabs } from "../scene/prefab";
import {
  PREFAB_KIND,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneIssue,
} from "../scene/types";
import { ENGINE_VERSION } from "../version";
import { ownValue, stableJson } from "./canonical";
import type { ContentStore } from "./content-store";
import { isSha256, sha256 } from "./hash";
import { parseAssetDoc, type DocKindDef, type KindEnv, type KindRegistry } from "./kinds";
import { byCodeUnit } from "./kinds/define";
import { MATERIAL_KIND } from "./kinds/material";
import {
  formatJsonDocument,
  orderKeys,
  readJsonDocument,
  sortKeysDeep,
  zodSceneIssues,
} from "./project-file";
import { buildRefIndex } from "./refs";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  AssetKindName,
  AssetPath,
  ProjectFile,
  ProjectId,
  ProjectState,
  ProjectView,
  Sha256,
} from "./types";
import { assetPathProblem, projectView } from "./view";
import { idField, kindNameField, sha256Field } from "./zod-fields";

/** The snapshot format version, the `v` every snapshot carries. */
export const PROJECT_SNAPSHOT_VERSION = 1;

/** `urn:jams-engine:project-snapshot:v1`. */
export const PROJECT_SNAPSHOT_SCHEMA_ID = `${SCHEMA_ID_BASE}project-snapshot:v${PROJECT_SNAPSHOT_VERSION}`;

/** One asset as a snapshot pins it. */
export type SnapshotAsset = {
  key: AssetKey;
  kind: AssetKindName;
  path: AssetPath;
  sha256: Sha256;
  /** A blob's size in bytes, when its entry records one. */
  bytes?: number;
  /** A blob's import settings, when it has any: with its bytes they give its meta, and they hold its references (an atlas's texture). */
  import?: Readonly<Record<string, unknown>>;
  /** What a blob's kind inspected from its bytes and import (a texture's pixel size, an atlas's frames), when it has any. */
  meta?: Readonly<Record<string, unknown>>;
};

/** A project pinned by content: reproducible from files, since it holds hashes of canonical texts and blobs, never doc states. */
export type ProjectSnapshot = {
  $schema?: string;
  kind: "project-snapshot";
  v: 1;
  project: ProjectId;
  /** ENGINE_VERSION of the writer. */
  engine: string;
  /** Wall clock; not part of `hash`. */
  at: number;
  build: Readonly<Record<AssetKindName, Sha256>>;
  /** Every live asset: docs by the SHA-256 of their canonical text, blobs by their content hash, size, import settings and meta. */
  assets: Readonly<Record<AssetId, SnapshotAsset>>;
  /** sha256(stableJson(everything above except `at` and `$schema`)). */
  hash: Sha256;
};

/** A snapshot that can't give what was asked of it, with the issues why. */
export class SnapshotError extends Error {
  constructor(readonly issues: SceneIssue[]) {
    super(
      issues.length === 1
        ? issues[0]!.message
        : `${issues.length} snapshot issues; first: ${issues[0]?.message ?? "unknown"}`,
    );
    this.name = "SnapshotError";
  }
}

const snapshotAssetSchema = z
  .strictObject({
    key: z.string().min(1).describe("The asset's registry key, which never changes."),
    kind: kindNameField,
    path: z
      .string()
      .refine((p) => assetPathProblem(p) === null, { message: "not a project-relative path" })
      .describe("The asset's project-relative POSIX path."),
    sha256: sha256Field(
      "A doc's SHA-256 of its canonical UTF-8 text, a blob's SHA-256 of its bytes.",
    ),
    bytes: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("A blob's size in bytes, when its entry records one."),
    import: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "A blob's import settings, when it has any: with its bytes they give its meta, and they hold its references.",
      ),
    meta: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "What a blob's kind inspected from its bytes and import (a texture's pixel size, an atlas's frames), when it has any.",
      ),
  })
  .describe("One live asset, pinned by its content hash.");

/** The zod schema `project-snapshot.schema.json` is generated from; `parseProjectSnapshot` checks with it. */
export const projectSnapshotSchema = z
  .strictObject({
    $schema: z.string().optional().describe("The project snapshot JSON Schema this file follows."),
    kind: z.literal("project-snapshot").describe('Always "project-snapshot".'),
    v: z.literal(PROJECT_SNAPSHOT_VERSION).describe("Snapshot format version."),
    project: idField("The id of the project it pins."),
    engine: z.string().min(1).describe("The engine version that wrote it."),
    at: z
      .number()
      .int()
      .nonnegative()
      .describe("When it was taken, in ms since the epoch; not part of `hash`."),
    build: z
      .record(kindNameField, sha256Field("The kind's schema hash."))
      .describe("Each kind's schema hash in the newest build that wrote the project."),
    assets: z
      .record(idField("An asset id."), snapshotAssetSchema)
      .describe("Every live asset by id."),
    hash: sha256Field(
      "SHA-256 of the key-sorted JSON of every field but `at` and `$schema`: equal content gives an equal hash.",
    ),
  })
  .describe(
    "A project pinned by content: each live asset's id, kind, path and content hash. What releases and live levels pin.",
  );

/** The draft 2020-12 JSON Schema of a project snapshot. */
export function projectSnapshotJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(projectSnapshotSchema);
  return {
    $schema,
    $id: PROJECT_SNAPSHOT_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine project snapshot, format v${PROJECT_SNAPSHOT_VERSION}`,
    ...rest,
  };
}

/** The hash a snapshot's content gives: every field but `at`, `$schema` and `hash` itself. */
export function snapshotHash(
  snapshot: Omit<ProjectSnapshot, "hash" | "at" | "$schema">,
): Promise<Sha256> {
  const { kind, v, project, engine, build, assets } = snapshot;
  return sha256(stableJson({ kind, v, project, engine, build, assets }));
}

/**
 * Pins every live asset of `view`: a doc by the SHA-256 of its canonical
 * text in `texts` (by id), a blob by its entry's `sha256`. Throws when a
 * live doc has no text. `at` is the wall clock; nothing else depends on
 * when it runs.
 */
export async function snapshotProject(
  view: ProjectView,
  texts: ReadonlyMap<AssetId, string>,
  build: ProjectState["build"],
): Promise<ProjectSnapshot> {
  const assets: Record<AssetId, SnapshotAsset> = {};
  for (const id of [...view.byId.keys()].sort(byCodeUnit)) {
    const entry = view.byId.get(id)!;
    let hash = entry.sha256;
    if (hash === undefined) {
      const text = texts.get(id);
      if (text === undefined)
        throw new Error(`snapshotProject: no canonical text for doc asset "${id}" (${entry.path})`);
      hash = await sha256(text);
    }
    const pinned: SnapshotAsset = {
      key: entry.key,
      kind: entry.kind,
      path: entry.path,
      sha256: hash,
    };
    if (entry.sha256 !== undefined) {
      if (entry.bytes !== undefined) pinned.bytes = entry.bytes;
      if (entry.import && Object.keys(entry.import).length > 0)
        pinned.import = structuredClone(entry.import);
      if (entry.meta && Object.keys(entry.meta).length > 0)
        pinned.meta = structuredClone(entry.meta);
    }
    assets[id] = pinned;
  }
  const stamps: Record<AssetKindName, Sha256> = {};
  for (const kind of Object.keys(build).sort(byCodeUnit)) stamps[kind] = build[kind]!.hash;
  const body: Omit<ProjectSnapshot, "hash" | "at" | "$schema"> = {
    kind: "project-snapshot",
    v: PROJECT_SNAPSHOT_VERSION,
    project: view.state.meta.projectId,
    engine: ENGINE_VERSION,
    build: stamps,
    assets,
  };
  return { ...body, at: Date.now(), hash: await snapshotHash(body) };
}

export type ParseProjectSnapshotResult =
  | { ok: true; snapshot: ProjectSnapshot }
  | { ok: false; issues: SceneIssue[] };

/** Reads a snapshot from text or a parsed value; a `hash` its content doesn't give is `hash-mismatch`. Never throws. */
export async function parseProjectSnapshot(input: unknown): Promise<ParseProjectSnapshotResult> {
  const read = readJsonDocument(
    input,
    "project-snapshot",
    PROJECT_SNAPSHOT_VERSION,
    "the project snapshot",
  );
  if (!read.ok) return read;
  const parsed = projectSnapshotSchema.safeParse(read.raw);
  if (!parsed.success) return { ok: false, issues: zodSceneIssues(parsed.error, ["project"]) };
  const snapshot = parsed.data as ProjectSnapshot;
  const issue = await hashIssue(snapshot);
  return issue ? { ok: false, issues: [issue] } : { ok: true, snapshot };
}

const SNAPSHOT_KEYS = [
  "$schema",
  "kind",
  "v",
  "project",
  "engine",
  "at",
  "hash",
  "build",
  "assets",
];

/** A snapshot's file text: header keys first, `build` and `assets` sorted, a trailing newline. */
export function formatProjectSnapshot(snapshot: ProjectSnapshot): string {
  const value = orderKeys(snapshot as Record<string, unknown>, SNAPSHOT_KEYS);
  value.build = sortKeysDeep(snapshot.build);
  value.assets = Object.fromEntries(
    Object.keys(snapshot.assets)
      .sort(byCodeUnit)
      .map((id) => {
        const { key, kind, path, sha256, bytes, import: settings, meta } = snapshot.assets[id]!;
        return [
          id,
          {
            key,
            kind,
            path,
            sha256,
            ...(bytes !== undefined ? { bytes } : {}),
            ...(settings ? { import: sortKeysDeep(settings) } : {}),
            ...(meta ? { meta: sortKeysDeep(meta) } : {}),
          },
        ];
      }),
  );
  return formatJsonDocument(value);
}

async function hashIssue(snapshot: ProjectSnapshot): Promise<SceneIssue | null> {
  const hash = await snapshotHash(snapshot);
  if (hash === snapshot.hash) return null;
  return makeIssue("hash-mismatch", {
    message: `the snapshot's content hashes to ${hash}, not its recorded ${snapshot.hash}`,
    path: "/hash",
    expected: snapshot.hash,
    got: hash,
  });
}

/** A doc asset's canonical text from the store, or the issue that stops reading it. */
async function readText(
  store: ContentStore,
  id: AssetId,
  asset: SnapshotAsset,
): Promise<{ ok: true; text: string } | { ok: false; issue: SceneIssue }> {
  const bytes = isSha256(asset.sha256) ? await store.get(asset.sha256) : null;
  if (bytes === null)
    return {
      ok: false,
      issue: makeIssue("asset-missing", {
        message: `the content store has no text for "${id}" (${asset.path}, ${asset.sha256})`,
        entityIds: [id],
        got: asset.sha256,
      }),
    };
  const got = await sha256(bytes);
  if (got !== asset.sha256)
    return {
      ok: false,
      issue: makeIssue("hash-mismatch", {
        message: `the content store's text for "${id}" hashes to ${got}, not ${asset.sha256}`,
        entityIds: [id],
        expected: asset.sha256,
        got,
      }),
    };
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

/** The snapshot as a project view: its assets live, nothing in the trash, blobs carrying their hash, size, import and meta. */
export function snapshotView(snapshot: ProjectSnapshot, kinds: KindRegistry): ProjectView {
  const assets: Record<AssetKey, AssetEntry> = {};
  for (const [id, a] of Object.entries(snapshot.assets)) {
    const blob = kinds.get(a.kind)?.storage === "blob";
    assets[a.key] = {
      key: a.key,
      id,
      kind: a.kind,
      path: a.path,
      ...(blob ? { sha256: a.sha256 } : {}),
      ...(blob && a.bytes !== undefined ? { bytes: a.bytes } : {}),
      ...(blob && a.import ? { import: { ...a.import } } : {}),
      ...(blob && a.meta ? { meta: structuredClone(a.meta) as Record<string, unknown> } : {}),
      created: { at: 0, by: "" },
    };
  }
  return projectView(
    {
      meta: { projectId: snapshot.project, layout: 1, name: snapshot.project },
      assets,
      history: {},
      code: {},
      build: {},
    },
    kinds,
  );
}

/** `issues` under asset `id`: each one's `entityIds` starting with it, unless it already does. */
export const withId = (id: AssetId, issues: readonly SceneIssue[]): SceneIssue[] =>
  issues.map((i) => (i.entityIds[0] === id ? i : { ...i, entityIds: [id, ...i.entityIds] }));

/** Each text parsed as JSON, by id; a text that isn't JSON is left out. */
export function jsonValues(texts: ReadonlyMap<AssetId, string>): Map<AssetId, unknown> {
  const values = new Map<AssetId, unknown>();
  for (const [id, text] of texts) {
    try {
      values.set(id, JSON.parse(text));
    } catch {
      // Left out.
    }
  }
  return values;
}

/** `registry`'s game with `view`'s material assets overlaid from their texts, in place of any overlay `registry` had. */
function pinnedRegistry(
  registry: Registry,
  view: ProjectView,
  texts: ReadonlyMap<AssetId, string>,
): Registry {
  const materials = new Map<AssetId, string>();
  for (const [id, text] of texts)
    if (view.byId.get(id)?.kind === MATERIAL_KIND) materials.set(id, text);
  return withProject(registry, view, jsonValues(materials));
}

/**
 * Every reference in the snapshot's docs and blob import settings resolves
 * to an asset in it of a kind the reference accepts; else `asset-missing`.
 * Each doc is read from its canonical text in `store` (missing text is
 * `asset-missing`, bytes that don't hash to the pin `hash-mismatch`) and
 * parsed by its kind, whose errors are returned with the doc's id. An
 * unregistered kind is `asset-kind`; a `hash` the content doesn't give is
 * `hash-mismatch`. Kinds see the snapshot as `env.project`, and
 * `env.registry` with the snapshot's own materials in place of any overlay
 * it had. Blobs aren't fetched.
 */
export async function checkSnapshot(
  snapshot: ProjectSnapshot,
  store: ContentStore,
  kinds: KindRegistry,
  env: KindEnv,
): Promise<SceneIssue[]> {
  const issues: SceneIssue[] = [];
  const hash = await hashIssue(snapshot);
  if (hash) issues.push(hash);
  const view = snapshotView(snapshot, kinds);
  issues.push(...view.issues);
  const texts = new Map<AssetId, string>();
  const docs: [AssetId, DocKindDef][] = [];
  for (const id of Object.keys(snapshot.assets).sort(byCodeUnit)) {
    const asset = snapshot.assets[id]!;
    const def = kinds.get(asset.kind);
    if (def?.storage !== "doc") continue;
    const read = await readText(store, id, asset);
    if (!read.ok) {
      issues.push(read.issue);
      continue;
    }
    texts.set(id, read.text);
    docs.push([id, def]);
  }
  const docEnv: KindEnv = { registry: pinnedRegistry(env.registry, view, texts), project: view };
  const values = new Map<AssetId, unknown>();
  for (const [id, def] of docs) {
    const parsed = parseAssetDoc(def, texts.get(id)!, docEnv);
    issues.push(...withId(id, parsed.issues.filter(isErrorIssue)));
    if (parsed.ok) values.set(id, parsed.value);
  }
  issues.push(...buildRefIndex(view, values, kinds, docEnv).dangling());
  return issues;
}

function assetOf(
  snapshot: ProjectSnapshot,
  id: AssetId,
  kind: AssetKindName,
  from: string,
): SnapshotAsset {
  const asset = ownValue(snapshot.assets, id);
  if (!asset)
    throw new SnapshotError([
      makeIssue("asset-missing", {
        message: `${from} "${id}", but snapshot ${snapshot.hash} has no asset "${id}"`,
        entityIds: [id],
        got: id,
        expected: kind,
      }),
    ]);
  if (asset.kind !== kind)
    throw new SnapshotError([
      makeIssue("asset-kind", {
        message: `${from} "${id}", but in snapshot ${snapshot.hash} it is a ${asset.kind}, not a ${kind}`,
        entityIds: [id],
        got: asset.kind,
        expected: kind,
      }),
    ]);
  return asset;
}

async function textOf(store: ContentStore, id: AssetId, asset: SnapshotAsset): Promise<string> {
  const read = await readText(store, id, asset);
  if (!read.ok) throw new SnapshotError([read.issue]);
  return read.text;
}

/**
 * The snapshot's live assets of `kinds` as a project view, with their
 * canonical texts from `store` by id. Throws a `SnapshotError` when one has
 * no text there or bytes that don't hash to its pin.
 */
export async function pinnedDocs(
  snapshot: ProjectSnapshot,
  store: ContentStore,
  kinds: readonly AssetKindName[],
): Promise<{ view: ProjectView; texts: Map<AssetId, string> }> {
  const assets: Record<AssetKey, AssetEntry> = {};
  const texts = new Map<AssetId, string>();
  for (const id of Object.keys(snapshot.assets).sort(byCodeUnit)) {
    const a = snapshot.assets[id]!;
    if (!kinds.includes(a.kind)) continue;
    assets[a.key] = { key: a.key, id, kind: a.kind, path: a.path, created: { at: 0, by: "" } };
    texts.set(id, await textOf(store, id, a));
  }
  const view = projectView({
    meta: { projectId: snapshot.project, layout: 1, name: snapshot.project },
    assets,
    history: {},
    code: {},
    build: {},
  });
  return { view, texts };
}

/**
 * A scene and the prefabs its instances name, read from their canonical
 * texts in `store`, and the registry they parse and run by: `registry`'s
 * game with the snapshot's own material assets in place of any overlay it
 * had, so a material edited after the snapshot never reaches it. What a
 * loader or a live level pins. The library is keyed by asset id. Throws a
 * `SnapshotError` when the scene or a prefab it names isn't in the
 * snapshot, is another kind, or doesn't parse, or when it or a material
 * has no text in the store.
 */
export async function snapshotScene(
  snapshot: ProjectSnapshot,
  sceneId: AssetId,
  store: ContentStore,
  registry: Registry,
): Promise<{ def: SceneDefinition; prefabs: PrefabLibrary; registry: Registry }> {
  const sceneAsset = assetOf(snapshot, sceneId, "scene", "asked for scene");
  const text = await textOf(store, sceneId, sceneAsset);
  const materials = await pinnedDocs(snapshot, store, [MATERIAL_KIND]);
  const pinned = pinnedRegistry(registry, materials.view, materials.texts);
  const parsed = parseScene(text, pinned);
  if (!parsed.ok) throw new SnapshotError(withId(sceneId, parsed.issues));
  const def = parsed.def;
  const prefabs = new Map<string, Prefab>();
  const texts = new Map<AssetId, string>();
  // The store is async and the walk isn't: each round fetches what the last one reached.
  for (let roots = prefabsUsedBy(def); roots.length > 0; ) {
    for (const id of roots) {
      if (texts.has(id)) continue;
      const asset = assetOf(snapshot, id, PREFAB_KIND, `scene "${sceneId}" reaches prefab`);
      texts.set(id, await textOf(store, id, asset));
    }
    const next: AssetId[] = [];
    reachPrefabs(
      roots,
      (id) => {
        const text = texts.get(id);
        if (text === undefined) {
          next.push(id);
          return undefined;
        }
        const read = parsePrefab(text, pinned);
        if (!read.ok) throw new SnapshotError(withId(id, read.issues));
        return read.prefab;
      },
      prefabs,
    );
    roots = next;
  }
  return { def, prefabs, registry: pinned };
}

/** Files and their bytes: what push uploads and pull writes. */
export type ProjectBundle = {
  project: ProjectFile;
  /** Text files by path, canonical text. */
  texts: Readonly<Record<AssetPath, string>>;
  /** Binary files by path, as content hashes; bytes travel through the content store. */
  blobs: Readonly<Record<AssetPath, Sha256>>;
  /** Sidecars by the path of their asset. */
  sidecars: Readonly<Record<AssetPath, string>>;
};
