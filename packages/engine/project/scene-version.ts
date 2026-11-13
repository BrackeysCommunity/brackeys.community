import { z } from "zod";

import { createRegistry } from "../game/define";
import { ID_PATTERN } from "../game/fields";
import type { GameDefinition, Registry } from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { expandScene, scenePhysics } from "../scene/expand";
import { jsonPointer, lineAt, liveIssue, makeIssue, type LiveIssueInput } from "../scene/issues";
import { SCHEMA_ID_BASE, toJsonSchema } from "../scene/json-schema";
import { parseScene, pointerLines } from "../scene/parse";
import { parsePrefab, prefabsUsedBy, sceneHashWith } from "../scene/prefab";
import {
  PREFAB_KIND,
  type ExpandedScene,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneHash,
  type SceneIssue,
} from "../scene/types";
import { validateScene } from "../scene/validate";
import { ENGINE_VERSION } from "../version";
import { blobContent, namedPrefabs, sceneBundle, unsizedIds } from "./bundle";
import { stableJson } from "./canonical";
import { sha256, SHA256_PATTERN } from "./hash";
import { createKindRegistry, type KindRegistry } from "./kinds";
import { byCodeUnit } from "./kinds/define";
import { sceneKind } from "./kinds/scene";
import { readJsonDocument, zodSceneIssues } from "./project-file";
import { buildRefIndex } from "./refs";
import {
  canonicalWithAssets,
  ENGINE_FORMATS,
  orderedLayout,
  RELEASE_SCENE_LAYOUT,
  releaseAssetSchema,
  releaseId,
  releaseSceneSchema,
  snapshotAssetsOf,
  type ReleaseAsset,
  type ReleaseManifest,
  type ReleaseScene,
} from "./release";
import { runtimeView } from "./runtime-view";
import {
  jsonValues,
  PROJECT_SNAPSHOT_VERSION,
  snapshotHash,
  snapshotView,
  type ProjectSnapshot,
} from "./snapshot";
import type { AssetEntry, AssetId, AssetKindName, ProjectId, ProjectView, Sha256 } from "./types";

/** The scene version record's format, the `v` every one carries. */
export const SCENE_VERSION_VERSION = 1;

/** `urn:jams-engine:scene-version:v1`. */
export const SCENE_VERSION_SCHEMA_ID = `${SCHEMA_ID_BASE}scene-version:v${SCENE_VERSION_VERSION}`;

/** What a release must match for a scene version to go live on it. */
export type LiveCompat = {
  /** From `engine.formats`. */
  formats: { scene: number; prefab: number };
  /** The per-kind schema hashes of the code that checked the version: `project.build`. */
  build: Readonly<Record<AssetKindName, Sha256>>;
  game: { id: string; configHash: string | null };
};

/**
 * One published version of one scene: the data that replaces the release's
 * scene, never code. Holds no wall clock, author, note or timing, so the
 * same level published twice is the same version.
 */
export type SceneVersion = {
  $schema?: string;
  kind: "scene-version";
  v: 1;
  project: ProjectId;
  /** The scene asset this version replaces; must be listed in the release's flow. */
  scene: AssetId;
  compat: LiveCompat;
  /** ENGINE_VERSION of the code that built it; shown, never compared. */
  engine: string;
  /** The release it was checked against when it was built; provenance only. */
  base: Sha256 | null;
  /** Its `flow.scenes` entry as a release would write it: title, sublevel, physics, prefabs, bundle. */
  entry: ReleaseScene;
  /** `sceneHash` of the canonical scene text: what the editor and replays display. */
  sceneHash: SceneHash;
  /**
   * Every asset the version needs: the scene doc, each prefab in
   * `entry.prefabs`, every blob in `entry.bundle` and the assets those refer
   * to. `file` is always `live/<sha256>.json` (docs) or `live/<sha256><ext>`
   * (blobs); the frame uses the release's own path when the release ships
   * that hash. Sorted by id.
   */
  assets: Readonly<Record<AssetId, ReleaseAsset>>;
};

/** What `buildSceneVersion` reads. */
export type BuildSceneVersionOptions = {
  view: ProjectView;
  /**
   * Canonical texts by asset id (from docs or files): the scene, every doc
   * it reaches (its prefabs, materials, tables), and the game settings and
   * scene list it is read with.
   */
  texts: ReadonlyMap<AssetId, string>;
  /** `project.build` for the code doing the build. */
  build: Readonly<Record<AssetKindName, Sha256>>;
  game: GameDefinition;
  registry: Registry;
  scene: AssetId;
  /** The release it will go live on; when given, `checkSceneVersion` runs and its issues are returned. */
  release?: ReleaseManifest;
};

export type BuildSceneVersionResult =
  | {
      ok: true;
      version: SceneVersion;
      id: Sha256;
      /** The canonical texts it carries, by hash. */
      texts: ReadonlyMap<Sha256, string>;
      issues: SceneIssue[];
    }
  | { ok: false; issues: SceneIssue[] };

/** A version read for play: its scene parsed, validated and expanded, and the prefabs it expanded from. */
export type SceneVersionRead =
  | {
      ok: true;
      def: SceneDefinition;
      scene: ExpandedScene;
      prefabs: PrefabLibrary;
      /** Warnings and infos; an error stops the read. */
      issues: SceneIssue[];
    }
  | { ok: false; issues: SceneIssue[] };

/** How the messages name the version and the release; a host passes its numbers (`level-1@4`, `v7`). */
export type SceneVersionNames = {
  /** Default: the scene's id. */
  version?: string;
  /** Default: "the release". */
  release?: string;
};

export type CheckSceneVersionOptions = {
  /**
   * The game's registry, for finding the references in the carried scene and
   * prefabs (rule 7). Without it only what the engine's own types name is
   * found: the `assets` header, prefab instances and blobs' references.
   */
  registry?: Registry;
  names?: SceneVersionNames;
};

// ─── Schema ──────────────────────────────────────────────

const sha256Field = (description: string) => z.string().regex(SHA256_PATTERN).describe(description);
const idField = (description: string) => z.string().regex(ID_PATTERN).describe(description);
const format = (description: string) => z.number().int().positive().describe(description);

/** `live/<sha256>.json` for a doc, `live/<sha256><ext>` for a blob. */
const LIVE_FILE_PATTERN = /^live\/[0-9a-f]{64}(\.[A-Za-z0-9]+)*$/;

const liveFileProblem = (a: { sha256: string; storage: string; file: string }): string | null => {
  if (!a.file.startsWith(`live/${a.sha256}`)) return "isn't named by the asset's sha256";
  if (a.storage === "doc" && a.file !== `live/${a.sha256}.json`) return "a doc's file is .json";
  return null;
};

const versionAssetSchema = releaseAssetSchema
  .extend({
    file: z
      .string()
      .regex(LIVE_FILE_PATTERN)
      .describe("Its file under the version: `live/<sha256>.json` or `live/<sha256><ext>`."),
  })
  .superRefine((a, ctx) => {
    const problem = liveFileProblem(a);
    if (problem !== null) ctx.addIssue({ code: "custom", path: ["file"], message: problem });
  })
  .describe("An asset the version needs: its snapshot entry plus its file under `live/`.");

const versionSchema = z
  .strictObject({
    $schema: z.string().optional().describe("The scene version JSON Schema this file follows."),
    kind: z.literal("scene-version").describe('Always "scene-version".'),
    v: z.literal(SCENE_VERSION_VERSION).describe("Scene version format version."),
    project: idField("The project's id."),
    scene: idField("The scene asset this version replaces; listed in the release's flow."),
    compat: z
      .strictObject({
        formats: z
          .strictObject({
            scene: format("The scene format version."),
            prefab: format("The prefab format version."),
          })
          .describe("The formats of the code that checked the version."),
        build: z
          .record(
            z
              .string()
              .min(1)
              .describe("An asset kind: an engine kind's name, or `<game>/<kind>` for a game's."),
            sha256Field("The kind's schema hash."),
          )
          .describe("The per-kind schema hashes of the code that checked the version."),
        game: z
          .strictObject({
            id: idField("The game's id."),
            configHash: z
              .string()
              .min(1)
              .nullable()
              .describe("The game's configHash; null when it declares none."),
          })
          .describe("The game the version was made for."),
      })
      .describe("What a release must match for the version to go live on it."),
    engine: z.string().min(1).describe("ENGINE_VERSION of the code that built it; never compared."),
    base: sha256Field("The release it was checked against when built; provenance only.")
      .nullable()
      .describe("The release it was checked against when built; null when none."),
    entry: releaseSceneSchema,
    sceneHash: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .describe("sceneHash of the canonical scene text: what the editor and replays display."),
    assets: z
      .record(idField("An asset id."), versionAssetSchema)
      .describe("Every asset the version needs, by id."),
  })
  .describe(
    "One published version of one scene (scene-version.json): the scene, its prefabs and the assets they need, and what a release must match for it to go live.",
  );

/** The zod schema `scene-version.schema.json` is generated from; `parseSceneVersion` checks with it. */
export const sceneVersionSchema: z.ZodType<SceneVersion> = versionSchema;

/** The draft 2020-12 JSON Schema of `scene-version.json`. */
export function sceneVersionJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(versionSchema);
  return {
    $schema,
    $id: SCENE_VERSION_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine scene version, format v${SCENE_VERSION_VERSION}`,
    ...rest,
  };
}

/** Lines from `text` for issues that point into it; none when it isn't JSON. */
function withLines(text: string, issues: SceneIssue[]): SceneIssue[] {
  let lines: Map<string, number>;
  try {
    lines = pointerLines(text);
  } catch {
    return issues;
  }
  return issues.map((issue) => {
    if (issue.path === undefined || issue.line !== undefined) return issue;
    const line = lineAt(lines, issue.path);
    return line === undefined ? issue : { ...issue, line };
  });
}

/** Reads a scene version's text: bad JSON, a wrong `kind`, a newer `v` or a shape the schema refuses are issues. Never throws. */
export function parseSceneVersion(
  text: string,
): { ok: true; version: SceneVersion } | { ok: false; issues: SceneIssue[] } {
  const read = readJsonDocument(text, "scene-version", SCENE_VERSION_VERSION, "the scene version");
  if (!read.ok) return read;
  const parsed = versionSchema.safeParse(read.raw);
  if (!parsed.success)
    return { ok: false, issues: withLines(text, zodSceneIssues(parsed.error, ["project"])) };
  return { ok: true, version: parsed.data as SceneVersion };
}

// ─── Canonical text ──────────────────────────────────────

const VERSION_LAYOUT = orderedLayout(
  ["project", "scene", "compat", "engine", "base", "entry", "sceneHash", "assets"],
  {
    compat: orderedLayout(["formats", "build", "game"], {
      formats: orderedLayout(["scene", "prefab"]),
      build: { as: "map", rest: { as: "atomic" } },
      game: orderedLayout(["id", "configHash"]),
    }),
    entry: RELEASE_SCENE_LAYOUT,
    assets: { as: "map", rest: { as: "atomic" } },
  },
);

/**
 * Canonical text, by `formatReleaseManifest`'s writer: the key order of
 * `SceneVersion`, `assets` by id with each item on one line, two-space
 * indent, trailing newline.
 */
export function formatSceneVersion(version: SceneVersion): string {
  return canonicalWithAssets(version, VERSION_LAYOUT);
}

/** SHA-256 of `formatSceneVersion`'s text: the version's id. */
export function sceneVersionId(version: SceneVersion): Promise<Sha256> {
  return sha256(formatSceneVersion(version));
}

// ─── Compatibility ───────────────────────────────────────

const sortedRecord = <V>(record: Readonly<Record<string, V>>): Record<string, V> =>
  Object.fromEntries(
    Object.keys(record)
      .sort(byCodeUnit)
      .map((k) => [k, record[k]!]),
  );

/** What `manifest` asks of a version that goes live on it. */
export function liveCompat(manifest: ReleaseManifest): LiveCompat {
  return {
    formats: { scene: manifest.engine.formats.scene, prefab: manifest.engine.formats.prefab },
    build: sortedRecord(manifest.project.build),
    game: { id: manifest.game.id, configHash: manifest.game.configHash },
  };
}

/** One hash of `compat`: two releases a version fits equally have the same key. */
export function liveCompatKey(compat: LiveCompat): Promise<Sha256> {
  const { formats, build, game } = compat;
  return sha256(
    stableJson({
      formats: { scene: formats.scene, prefab: formats.prefab },
      build,
      game: { id: game.id, configHash: game.configHash },
    }),
  );
}

const DEFAULT_RELEASE_NAME = "the release";

/** The default release name leads some messages, where it starts the sentence. */
const sentence = (issue: SceneIssue): SceneIssue =>
  issue.message.startsWith(DEFAULT_RELEASE_NAME)
    ? { ...issue, message: `T${issue.message.slice(1)}` }
    : issue;

const named = (input: LiveIssueInput, path: string, extra: Partial<SceneIssue> = {}) =>
  sentence({ ...liveIssue(input), path, ...extra });

const pointer = (...segments: (string | number)[]) => jsonPointer(segments);

const own = <V>(record: Readonly<Record<string, V>>, key: string): V | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** Rule 1's game half: the version was made for `want`'s game and configuration. */
function gameIssue(
  version: SceneVersion,
  want: LiveCompat["game"],
  name: string,
): SceneIssue | null {
  const got = version.compat.game;
  if (got.id === want.id && got.configHash === want.configHash) return null;
  return named(
    { code: "live-incompatible", rule: "game", version: name },
    pointer("compat", "game"),
    {
      expected: `${want.id} (${want.configHash ?? "no configHash"})`,
      got: `${got.id} (${got.configHash ?? "no configHash"})`,
    },
  );
}

/** Rules 1–3: the facts `liveCompatKey` covers. */
function compatIssues(m: ReleaseManifest, v: SceneVersion, names: Required<SceneVersionNames>) {
  const issues: SceneIssue[] = [];
  const want = liveCompat(m);
  const game = { code: "live-incompatible", rule: "game", version: names.version } as const;
  if (v.project !== m.project.id)
    issues.push(named(game, pointer("project"), { expected: m.project.id, got: v.project }));
  else {
    const issue = gameIssue(v, want.game, names.version);
    if (issue) issues.push(issue);
  }
  const { formats } = v.compat;
  if (formats.scene !== want.formats.scene || formats.prefab !== want.formats.prefab) {
    const which = formats.scene !== want.formats.scene ? "scene" : "prefab";
    issues.push(
      named(
        {
          code: "live-incompatible",
          rule: "formats",
          version: names.version,
          release: names.release,
          format: formats[which],
          reads: want.formats[which],
        },
        pointer("compat", "formats", which),
        { expected: String(want.formats[which]), got: String(formats[which]) },
      ),
    );
  }
  if (stableJson(v.compat.build) !== stableJson(want.build)) {
    const kinds = [...new Set([...Object.keys(v.compat.build), ...Object.keys(want.build)])]
      .filter((k) => own(v.compat.build, k) !== own(want.build, k))
      .sort(byCodeUnit);
    issues.push(
      named(
        {
          code: "live-incompatible",
          rule: "build",
          version: names.version,
          release: names.release,
        },
        pointer("compat", "build", ...(kinds.length === 1 ? kinds : [])),
        { got: kinds.join(", ") },
      ),
    );
  }
  return issues;
}

/** Rules 4–6: what the release lists and ships. */
function contentIssues(m: ReleaseManifest, v: SceneVersion, names: Required<SceneVersionNames>) {
  const issues: SceneIssue[] = [];
  const unlisted = { code: "live-scene-unlisted", release: names.release, scene: v.scene } as const;
  const listed = m.flow.scenes.find((s) => s.id === v.scene);
  if (!listed) issues.push(named(unlisted, pointer("scene"), { got: v.scene }));
  else if ((listed.sublevel === true) !== (v.entry.sublevel === true))
    issues.push(
      named(unlisted, pointer("entry", "sublevel"), {
        message: `${names.release} lists the scene ${v.scene} ${listed.sublevel ? "as a sublevel" : "as a level, not a sublevel"}, so it can't be updated live.`,
        expected: listed.sublevel ? "sublevel" : "level",
        got: v.entry.sublevel ? "sublevel" : "level",
      }),
    );

  if (v.entry.physics === "rapier" && m.build.rapier === null)
    issues.push(
      named(
        { code: "live-physics", release: names.release, scene: v.scene },
        pointer("entry", "physics"),
        { expected: "none", got: "rapier" },
      ),
    );

  const replaced = new Set([v.scene, ...v.entry.prefabs]);
  for (const id of Object.keys(v.assets).sort(byCodeUnit)) {
    if (replaced.has(id)) continue;
    const carried = v.assets[id]!;
    const shipped = own(m.assets, id);
    if (!shipped || (shipped.sha256 === carried.sha256 && shipped.kind === carried.kind)) continue;
    issues.push(
      named(
        {
          code: "live-asset-conflict",
          scene: v.scene,
          asset: carried.path.split("/").pop() ?? id,
        },
        pointer("assets", id, "sha256"),
        { entityIds: [v.scene, id], expected: shipped.sha256, got: carried.sha256 },
      ),
    );
  }
  return issues;
}

/** Rule 8: `entry` names the scene, and its prefabs and bundle are carried, sorted and once each. */
function entryIssues(v: SceneVersion): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const schema = (message: string, path: string, entityIds: string[] = []) =>
    issues.push(makeIssue("schema", { message, path, entityIds }));
  if (v.entry.id !== v.scene)
    schema(
      `entry.id "${v.entry.id}" isn't the version's scene "${v.scene}"`,
      pointer("entry", "id"),
    );
  const carried = (
    ids: readonly AssetId[],
    at: string[],
    what: string,
    fits: (a: ReleaseAsset) => boolean,
    expected: string,
  ) => {
    ids.forEach((id, i) => {
      const asset = own(v.assets, id);
      if (!asset)
        schema(`${what} "${id}", which the version doesn't carry`, pointer(...at, i), [id]);
      else if (!fits(asset))
        schema(
          `${what} "${id}", which the version carries as a ${asset.kind} (${asset.storage}), not ${expected}`,
          pointer(...at, i),
          [id],
        );
      const prev = ids[i - 1];
      if (prev !== undefined && byCodeUnit(prev, id) >= 0)
        schema(
          `${at.join(".")} isn't sorted and once each: "${prev}" comes before "${id}"`,
          pointer(...at, i),
          [id],
        );
    });
  };
  carried([v.scene], ["scene"], "the version replaces scene", (a) => a.kind === "scene", "a scene");
  carried(
    v.entry.prefabs,
    ["entry", "prefabs"],
    "entry.prefabs names",
    (a) => a.kind === "prefab",
    "a prefab",
  );
  carried(
    v.entry.bundle.entries,
    ["entry", "bundle", "entries"],
    "entry.bundle names",
    (a) => a.storage === "blob",
    "a blob",
  );
  return issues;
}

/** The version's assets as a project view, the way a frame that has only them sees the project. */
function versionView(version: SceneVersion, kinds: KindRegistry): ProjectView {
  // The view reads the assets and the project id, never the hash.
  return snapshotView({ ...snapshotBody(version), at: 0, hash: "" }, kinds);
}

/** Rule 7: every reference out of a carried scene, prefab or blob is to a carried asset. */
function carriedRefIssues(
  version: SceneVersion,
  texts: ReadonlyMap<Sha256, string>,
  registry: Registry,
): SceneIssue[] {
  const kinds = createKindRegistry(registry.game);
  const view = versionView(version, kinds);
  const issues: SceneIssue[] = [];
  const docs = new Map<AssetId, string>();
  for (const id of Object.keys(version.assets).sort(byCodeUnit)) {
    const asset = version.assets[id]!;
    if (asset.storage !== "doc") continue;
    const text = texts.get(asset.sha256);
    if (text === undefined)
      issues.push(
        makeIssue("asset-missing", {
          message: `the version carries ${asset.kind} "${id}" (${asset.sha256}), but its text isn't among the texts given`,
          path: pointer("assets", id, "sha256"),
          entityIds: [id],
          got: asset.sha256,
        }),
      );
    else docs.set(id, text);
  }
  const index = buildRefIndex(view, jsonValues(docs), kinds, { registry, project: view });
  for (const issue of index.dangling()) {
    const from = issue.entityIds[0];
    const text = from === undefined ? undefined : docs.get(from);
    issues.push(text === undefined ? issue : (withLines(text, [issue])[0] ?? issue));
  }
  return issues;
}

/**
 * Every compatibility rule: the project, game and configuration (1),
 * formats (2) and per-kind schema hashes (3) are the release's; the scene
 * is listed with the same sublevel flag (4); physics only when the release
 * ships Rapier (5); every carried asset besides the scene and its prefabs
 * new to the release or with its hash (6); with `texts` (the carried
 * canonical texts, by hash), every reference out of a carried asset is to a
 * carried one (7); `entry`'s scene, prefabs and bundle carried and sorted
 * (8). `[]` when the version may go live on this release. Issues that
 * point into the version carry the line of its canonical text.
 */
export function checkSceneVersion(
  manifest: ReleaseManifest,
  version: SceneVersion,
  texts?: ReadonlyMap<Sha256, string>,
  opts: CheckSceneVersionOptions = {},
): SceneIssue[] {
  const names = {
    version: opts.names?.version ?? version.scene,
    release: opts.names?.release ?? DEFAULT_RELEASE_NAME,
  };
  const issues = withLines(formatSceneVersion(version), [
    ...compatIssues(manifest, version, names),
    ...contentIssues(manifest, version, names),
    ...entryIssues(version),
  ]);
  if (texts) issues.push(...carriedRefIssues(version, texts, opts.registry ?? createRegistry()));
  return issues;
}

// ─── Snapshot and lookup ─────────────────────────────────

function snapshotBody(version: SceneVersion): Omit<ProjectSnapshot, "hash" | "at" | "$schema"> {
  return {
    kind: "project-snapshot",
    v: PROJECT_SNAPSHOT_VERSION,
    project: version.project,
    engine: version.engine,
    build: sortedRecord(version.compat.build),
    assets: snapshotAssetsOf(version.assets),
  };
}

/** A `ProjectSnapshot` holding exactly the version's assets (`at: 0`), hashed as `snapshotProject` hashes: what a collector pins. */
export async function sceneVersionSnapshot(version: SceneVersion): Promise<ProjectSnapshot> {
  const body = snapshotBody(version);
  return { ...body, at: 0, hash: await snapshotHash(body) };
}

/** A recording's version by id; null when the host doesn't have it. */
export function findSceneVersion<V extends { id: Sha256; version: SceneVersion }>(
  id: Sha256,
  versions: readonly V[],
): V | null {
  return versions.find((v) => v.id === id) ?? null;
}

// ─── Reading one for play ────────────────────────────────

const withId = (id: AssetId, issues: readonly SceneIssue[]): SceneIssue[] =>
  issues.map((i) => ({ ...i, entityIds: [id, ...i.entityIds] }));

const isError = (i: SceneIssue) => i.severity === "error";

/** Parses prefab `id` from `text` into `into`; its issues go to `issues`, under its id. */
function readPrefab(
  id: AssetId,
  text: string,
  registry: Registry,
  into: Map<string, Prefab>,
  issues: SceneIssue[],
): Prefab | undefined {
  const read = parsePrefab(text, registry);
  if (!read.ok) {
    issues.push(...withId(id, read.issues));
    return undefined;
  }
  into.set(id, read.prefab);
  return read.prefab;
}

/**
 * The last half of a read, shared by the build and `readSceneVersion`:
 * validates the parsed scene against `view` with `prefabs` and expands it,
 * as Play does. `issues` holds what the read found before; an error there
 * or in the validation stops it.
 */
function settleScene(
  id: AssetId,
  def: SceneDefinition,
  text: string,
  prefabs: PrefabLibrary,
  registry: Registry,
  view: ProjectView,
  engine: Readonly<Record<string, unknown>> | undefined,
  issues: SceneIssue[],
): SceneVersionRead {
  if (issues.some(isError)) return { ok: false, issues };
  const validated = validateScene(def, registry, {
    prefabs,
    engine,
    project: view,
    lines: pointerLines(text),
  });
  issues.push(...validated);
  if (validated.some(isError)) return { ok: false, issues };
  try {
    const scene = expandScene(def, registry, { prefabs, engine });
    return { ok: true, def, scene, prefabs, issues };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [makeIssue("schema", { message, entityIds: [id] }), ...issues],
    };
  }
}

/** Adds the prefabs the scene's fields name (a spawner's `prefab`) to a settled read's library. */
function withNamedPrefabs(
  read: Extract<SceneVersionRead, { ok: true }>,
  registry: Registry,
  get: (id: AssetId) => Prefab | undefined,
): SceneVersionRead {
  const named = namedPrefabs(read.scene.entities, registry, get);
  if (named.size === 0) return read;
  return { ...read, prefabs: new Map([...read.prefabs, ...named]) };
}

/**
 * The one reader of a version for play: parses its scene and prefabs from
 * `texts` (canonical texts by hash), validates the scene with `registry`
 * against the version's own assets, and expands it, as Play does. With
 * `game`, a version made for another game or configuration is refused
 * first. `opts.engine` is the project's `engine` block, which settings
 * resolve through.
 */
export function readSceneVersion(
  version: SceneVersion,
  texts: ReadonlyMap<Sha256, string>,
  registry: Registry,
  game: GameDefinition | null,
  opts: { engine?: Readonly<Record<string, unknown>> } = {},
): SceneVersionRead {
  if (game) {
    const issue = gameIssue(
      version,
      { id: game.id, configHash: game.configHash ?? null },
      version.scene,
    );
    if (issue) return { ok: false, issues: [issue] };
  }
  const issues: SceneIssue[] = [];
  const textOf = (id: AssetId, kind: AssetKindName, at: string): string | undefined => {
    const asset = own(version.assets, id);
    const text = asset?.kind === kind ? texts.get(asset.sha256) : undefined;
    if (text === undefined)
      issues.push(
        makeIssue("asset-missing", {
          message: asset
            ? asset.kind === kind
              ? `the version's ${kind} "${id}" (${asset.sha256}) has no text among the texts given`
              : `the version carries "${id}" as a ${asset.kind}, not a ${kind}`
            : `the version doesn't carry the ${kind} "${id}"`,
          path: at,
          entityIds: [id],
          got: asset?.sha256 ?? id,
        }),
      );
    return text;
  };

  const prefabs = new Map<string, Prefab>();
  version.entry.prefabs.forEach((id, i) => {
    const text = textOf(id, "prefab", pointer("entry", "prefabs", i));
    if (text !== undefined) readPrefab(id, text, registry, prefabs, issues);
  });
  const text = textOf(version.scene, "scene", pointer("scene"));
  const parsed = text === undefined ? null : parseScene(text, registry);
  if (parsed && !parsed.ok) issues.push(...withId(version.scene, parsed.issues));
  if (text === undefined || !parsed?.ok) return { ok: false, issues };
  const view = versionView(version, createKindRegistry(registry.game));
  const read = settleScene(
    version.scene,
    parsed.def,
    text,
    prefabs,
    registry,
    view,
    opts.engine,
    issues,
  );
  if (!read.ok) return read;
  const get = (pid: AssetId): Prefab | undefined => {
    if (prefabs.has(pid)) return prefabs.get(pid);
    const asset = own(version.assets, pid);
    const t = asset?.kind === "prefab" ? texts.get(asset.sha256) : undefined;
    return t === undefined ? undefined : readPrefab(pid, t, registry, prefabs, read.issues);
  };
  return withNamedPrefabs(read, registry, get);
}

// ─── Building one ────────────────────────────────────────

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** `live/<sha256><ext>`: a blob's file under a version, its extension the one its path ends in. */
function liveBlobFile(path: string, hash: Sha256): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return `live/${hash}${/^\.[a-z0-9]+$/.test(ext) ? ext : ""}`;
}

const missing = (message: string, id: AssetId): SceneIssue =>
  makeIssue("asset-missing", { message, entityIds: [id], got: id });

/** The scene `opts.scene` as Play reads it from the project, its prefabs read from `opts.texts` as instances reach them. */
function readProjectScene(
  opts: BuildSceneVersionOptions,
  text: string,
  engine: Readonly<Record<string, unknown>>,
): SceneVersionRead {
  const { registry, view, scene: id } = opts;
  const parsed = parseScene(text, registry);
  if (!parsed.ok) return { ok: false, issues: withId(id, parsed.issues) };
  const issues: SceneIssue[] = [];
  const prefabs = new Map<string, Prefab>();
  const pending = prefabsUsedBy(parsed.def);
  const seen = new Set<AssetId>();
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    if (seen.has(next)) continue;
    seen.add(next);
    // A prefab the project doesn't have is the validation's to name.
    if (view.byId.get(next)?.kind !== PREFAB_KIND) continue;
    const prefabText = opts.texts.get(next);
    if (prefabText === undefined) {
      issues.push(missing(`scene "${id}" reaches prefab "${next}", which has no text given`, next));
      continue;
    }
    const prefab = readPrefab(next, prefabText, registry, prefabs, issues);
    if (typeof prefab?.base === "string") pending.push(prefab.base);
    for (const nested of prefab?.instances ?? []) pending.push(nested.prefab);
  }
  const read = settleScene(id, parsed.def, text, prefabs, registry, view, engine, issues);
  if (!read.ok) return read;
  const get = (pid: AssetId): Prefab | undefined => {
    if (prefabs.has(pid)) return prefabs.get(pid);
    const t = view.byId.get(pid)?.kind === PREFAB_KIND ? opts.texts.get(pid) : undefined;
    return t === undefined ? undefined : readPrefab(pid, t, registry, prefabs, read.issues);
  };
  return withNamedPrefabs(read, registry, get);
}

/**
 * Every live asset `roots` reach through the project's references, the
 * roots included: docs and blobs only, and no scene but the version's own,
 * since the release lists the others. Sorted by id.
 */
function carriedIds(
  opts: BuildSceneVersionOptions,
  kinds: KindRegistry,
  values: ReadonlyMap<AssetId, unknown>,
  roots: readonly AssetId[],
): AssetId[] {
  const { view, registry, scene } = opts;
  const index = buildRefIndex(view, values, kinds, { registry, project: view });
  const seen = new Set<AssetId>();
  const pending = [...roots];
  for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
    const entry = view.byId.get(id);
    if (seen.has(id) || !entry) continue;
    const storage = kinds.get(entry.kind)?.storage;
    if (storage !== "doc" && storage !== "blob") continue;
    if (entry.kind === sceneKind.kind && id !== scene) continue;
    seen.add(id);
    for (const site of index.targets(id)) pending.push(site.id);
  }
  return [...seen].sort(byCodeUnit);
}

/** `entry` as the version carries it: a doc by its text's hash, a blob by its content; null, with an issue, when it has neither. */
async function carriedAsset(
  entry: AssetEntry,
  kinds: KindRegistry,
  texts: ReadonlyMap<AssetId, string>,
  issues: SceneIssue[],
  unsized: ReadonlySet<AssetId>,
): Promise<{ asset: ReleaseAsset; text?: string } | null> {
  const common = {
    key: entry.key,
    kind: entry.kind,
    path: entry.path,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
  };
  const licence =
    entry.licence && Object.keys(entry.licence).length > 0
      ? { licence: structuredClone(entry.licence) }
      : {};
  if (kinds.get(entry.kind)?.storage === "doc") {
    const text = texts.get(entry.id);
    if (text === undefined) {
      issues.push(
        missing(`"${entry.id}" (${entry.path}) is carried, but no text was given for it`, entry.id),
      );
      return null;
    }
    const hash = await sha256(text);
    const asset: ReleaseAsset = {
      ...common,
      sha256: hash,
      bytes: utf8Bytes(text),
      storage: "doc",
      file: `live/${hash}.json`,
      ...licence,
    };
    return { asset, text };
  }
  const content = blobContent(entry);
  if (!content) {
    if (!unsized.has(entry.id))
      issues.push(
        missing(
          `"${entry.id}" (${entry.path}) is carried, but its entry records no ${entry.sha256 === undefined ? "content hash" : "size"}`,
          entry.id,
        ),
      );
    return null;
  }
  const asset: ReleaseAsset = {
    ...common,
    ...content,
    storage: "blob",
    file: liveBlobFile(entry.path, content.sha256),
    ...(entry.meta && Object.keys(entry.meta).length > 0
      ? { meta: structuredClone(entry.meta) }
      : {}),
    ...(entry.import && Object.keys(entry.import).length > 0
      ? { import: structuredClone(entry.import) }
      : {}),
    ...licence,
  };
  return { asset };
}

/**
 * Builds the version of `opts.scene`: reads the scene as Play does (any
 * error stops the build); takes its release entry (physics, the prefabs the
 * expansion used, the bundle, and the title and sublevel flag the scene
 * list gives); carries the scene, its prefabs, its bundle and everything
 * those reference, each under `live/`; stamps the compatibility of this
 * code; then hashes it. With `opts.release`, `base` is that release's id
 * and `checkSceneVersion`'s issues against it are returned. The same
 * content gives the same id, whether its texts came from files or docs.
 */
export async function buildSceneVersion(
  opts: BuildSceneVersionOptions,
): Promise<BuildSceneVersionResult> {
  const { view, registry, game, scene: id } = opts;
  const sceneEntry = view.byId.get(id);
  const text = sceneEntry?.kind === sceneKind.kind ? opts.texts.get(id) : undefined;
  if (text === undefined)
    return {
      ok: false,
      issues: [
        missing(
          sceneEntry?.kind === sceneKind.kind
            ? `scene "${id}" has no text given`
            : `the project has no live scene "${id}"${sceneEntry ? `; "${id}" is a ${sceneEntry.kind}` : ""}`,
          id,
        ),
      ],
    };

  const values = jsonValues(opts.texts);
  const projectData = runtimeView(view, values, registry);
  const read = readProjectScene(opts, text, projectData.engine);
  if (!read.ok) return read;
  const issues = [...read.issues];

  const kinds = createKindRegistry(registry.game);
  const bundle = sceneBundle(read.scene, read.def, read.prefabs, view, kinds, registry);
  issues.push(...withId(id, bundle.issues));
  const listed = projectData.flow?.scenes.find((s) => s.scene === id);
  const entry: ReleaseScene = {
    id,
    ...(listed?.title !== undefined ? { title: listed.title } : {}),
    ...(listed?.sublevel ? { sublevel: true as const } : {}),
    physics: scenePhysics(read.def, registry, projectData.engine),
    prefabs: prefabsUsedBy(read.def, read.prefabs),
    bundle: {
      entries: bundle.bundle.entries.map((e) => e.id),
      bytes: bundle.bundle.bytes,
    },
  };

  const roots = [id, ...entry.prefabs, ...entry.bundle.entries];
  const assets: Record<AssetId, ReleaseAsset> = {};
  const carriedTexts = new Map<Sha256, string>();
  const unsized = unsizedIds(issues);
  for (const carried of carriedIds(opts, kinds, values, roots)) {
    const made = await carriedAsset(view.byId.get(carried)!, kinds, opts.texts, issues, unsized);
    if (!made) continue;
    assets[carried] = made.asset;
    if (made.text !== undefined) carriedTexts.set(made.asset.sha256, made.text);
  }
  if (issues.some(isError)) return { ok: false, issues };

  const version: SceneVersion = {
    kind: "scene-version",
    v: SCENE_VERSION_VERSION,
    project: view.state.meta.projectId,
    scene: id,
    compat: {
      formats: { scene: ENGINE_FORMATS.scene, prefab: ENGINE_FORMATS.prefab },
      build: sortedRecord(opts.build),
      game: { id: game.id, configHash: game.configHash ?? null },
    },
    engine: ENGINE_VERSION,
    base: opts.release ? await releaseId(opts.release) : null,
    entry,
    sceneHash: sceneHashWith(read.def, read.prefabs),
    assets,
  };
  if (opts.release)
    issues.push(...checkSceneVersion(opts.release, version, carriedTexts, { registry }));
  return { ok: true, version, id: await sceneVersionId(version), texts: carriedTexts, issues };
}
