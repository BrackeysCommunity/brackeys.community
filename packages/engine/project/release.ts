import { z } from "zod";

import { SAVE_VERSION } from "../game/save-file";
import type { TimeKind } from "../game/time";
import type { Registry } from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { INPUT_SCRIPT_VERSION } from "../scene/input-script";
import { jsonPointer, makeIssue } from "../scene/issues";
import { SCHEMA_ID_BASE, toJsonSchema } from "../scene/json-schema";
import { withIssueLines } from "../scene/parse";
import { RECORDING_VERSION, type RunRecording } from "../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneIssue } from "../scene/types";
import { COLLAB_LAYOUT_VERSION } from "../version";
import { canonicalJson, ownValue, stableJson } from "./canonical";
import { sha256 } from "./hash";
import { createKindRegistry, parseAssetDoc, type DocLayout, type KindRegistry } from "./kinds";
import { byCodeUnit, type KindEnv } from "./kinds/define";
import { ENGINE_ASSET_KINDS } from "./kinds/index";
import { readJsonDocument, zodSceneIssues } from "./project-file";
import type { RefSite } from "./refs";
import { assetEntryOf } from "./release-assets";
import { sidecarSchema } from "./sidecar";
import {
  parseProjectSnapshot,
  PROJECT_SNAPSHOT_VERSION,
  type ProjectSnapshot,
  type SnapshotAsset,
} from "./snapshot";
import type {
  AssetId,
  AssetKey,
  AssetKindName,
  AssetPath,
  Licence,
  ProjectId,
  Sha256,
} from "./types";
import { assetPathProblem } from "./view";
import { formatField, idField, kindNameField, sha256Field } from "./zod-fields";

/** The release manifest format version, the `v` every `release.json` carries. */
export const RELEASE_VERSION = 1;
/** `urn:jams-engine:release:v1`. */
export const RELEASE_SCHEMA_ID = `${SCHEMA_ID_BASE}release:v${RELEASE_VERSION}`;
/** The manifest's file name, at the root of every build. */
export const RELEASE_FILE = "release.json";
/** The page every build opens at. */
export const INDEX_HTML_FILE = "index.html";

/** The format versions this engine writes and reads: what a build records in `engine.formats`, and the newest a page boots. */
export const ENGINE_FORMATS: Readonly<ReleaseManifest["engine"]["formats"]> = Object.freeze({
  scene: SCENE_FORMAT_VERSION,
  prefab: SCENE_FORMAT_VERSION,
  recording: RECORDING_VERSION,
  inputScript: INPUT_SCRIPT_VERSION,
  save: SAVE_VERSION,
  collabLayout: COLLAB_LAYOUT_VERSION,
});
/** The credits page every build ships, next to its `index.html`. */
export const CREDITS_FILE = "credits.html";
/** The service worker a PWA build registers, next to its page. */
export const SERVICE_WORKER_FILE = "sw.js";
/** The web app manifest a PWA build links from its page. */
export const WEB_MANIFEST_FILE = "app.webmanifest";

/** All four are valid in a manifest; this engine builds the targets `EXPORT_TARGETS` has a row for. */
export type ReleaseTarget = "web" | "itch" | "desktop" | "mobile";

/** One file of the build. `release.json` itself is never listed. */
export type ReleaseFile = {
  /** Relative to release.json; "/" separated, no "..". */
  path: string;
  sha256: Sha256;
  bytes: number;
  role: "code" | "style" | "wasm" | "shell" | "worker" | "icon" | "asset" | "data";
};

/** A snapshot entry plus where its bytes are in the build. */
export type ReleaseAsset = {
  key: AssetKey;
  kind: AssetKindName;
  path: AssetPath;
  /** Docs: SHA-256 of the canonical text; blobs: the content hash. */
  sha256: Sha256;
  bytes: number;
  storage: "doc" | "blob";
  /** `data/<sha256>.json` for docs, `assets/<sha256><ext>` for blobs. */
  file: string;
  name?: string;
  /** Blobs: what the kind's inspect derived (an atlas's frames, a texture's size): the loader and headless read it. */
  meta?: Record<string, unknown>;
  import?: Record<string, unknown>;
  licence?: Licence;
};

export type ReleaseScene = {
  id: AssetId;
  title?: string;
  /** Listed as a sublevel in the scene list. */
  sublevel?: true;
  /** `scenePhysics` of the scene: whether it needs Rapier. */
  physics: "rapier" | "none";
  /** Prefabs its expansion uses, by id, sorted. */
  prefabs: readonly AssetId[];
  /** `sceneBundle`: the blobs to fetch before its first frame, sorted, and their bytes. */
  bundle: { entries: readonly AssetId[]; bytes: number };
};

export type ReleaseCredit = {
  /** Assets sharing this exact licence, sorted. */
  assets: readonly AssetId[];
  spdx?: string;
  author?: string;
  source?: string;
  attribution?: string;
};

export type ThirdPartyLicence = {
  package: string;
  version: string;
  /** The package.json `license` field, an SPDX expression. */
  licence: string;
  /** Its LICENSE file's text, printed on the credits page; null when the package ships none. */
  notice: string | null;
};

export type ExportBudget = {
  /** JS and CSS, without wasm. */
  codeBytes: number;
  /** Code, wasm when needed, the project bundle and the start scene's bundle: what the first frame waits for. */
  firstLoadBytes: number;
  totalBytes: number;
  fileBytes: number;
};

export type ExportBudgetReport = {
  limits: ExportBudget;
  measured: {
    codeBytes: number;
    wasmBytes: number;
    firstLoadBytes: number;
    assetBytes: number;
    dataBytes: number;
    totalBytes: number;
    largestFile: { path: string; bytes: number };
  };
  /** The budgets exceeded, in `ExportBudget`'s order; empty when within all. */
  over: readonly (keyof ExportBudget)[];
};

export type ReleaseManifest = {
  $schema?: string;
  kind: "release";
  v: 1;
  engine: {
    /** ENGINE_VERSION of the build. */
    version: string;
    agentSurface: number;
    /** The format versions a reader of this build's files must accept. */
    formats: {
      scene: number;
      prefab: number;
      recording: number;
      inputScript: number;
      save: number;
      collabLayout: number;
    };
  };
  game: {
    id: string;
    /** GameDefinition.configHash, when the game declares one. */
    configHash: string | null;
    /** GameDefinition.saves.version; null when the game has no saves. */
    saveVersion: number | null;
  };
  project: {
    id: ProjectId;
    name: string;
    /** The project snapshot's hash: `releaseSnapshot(manifest).hash` must equal it. Recording v2's `project.snapshot`. */
    snapshot: Sha256;
    /** The snapshot's own `engine` (the engine that took it). */
    snapshotEngine: string;
    /** The snapshot's per-kind schema hashes: a map, not one string. */
    build: Readonly<Record<AssetKindName, Sha256>>;
  };
  build: {
    /** SHA-256 of stableJson of the code, style and wasm files as [path, sha256] pairs, sorted by path. */
    hash: Sha256;
    target: ReleaseTarget;
    /** null when no listed scene resolves to Rapier: the build holds no wasm. */
    rapier: {
      package: "@dimforge/rapier2d" | "@dimforge/rapier2d-compat";
      version: string;
      /** The wasm file; null for -compat (inlined). */
      file: string | null;
      bytes: number;
    } | null;
    /** The entry script index.html loads. */
    entry: string;
    files: readonly ReleaseFile[];
  };
  /** The game's resolved time model, without the derived tickMs. */
  time: {
    kind: TimeKind;
    rate: number;
    catchUp: { maxMs: number } | null;
    wakeOnPointerMove: boolean;
  };
  replay: {
    /** REPLAY_ACROSS_PLATFORMS of this build. Physics-free builds replay everywhere whatever it says. */
    acrossPlatforms: boolean;
  };
  /** The scene list: only listed scenes ship. */
  flow: { start: AssetId; scenes: readonly ReleaseScene[] };
  /** `projectBundle`: blobs resident for the whole run. */
  projectBundle: { entries: readonly AssetId[]; bytes: number };
  /** Every shipped asset by id (docs and blobs), sorted by id. */
  assets: Readonly<Record<AssetId, ReleaseAsset>>;
  credits: {
    assets: readonly ReleaseCredit[];
    /** Shipped assets with no licence recorded (licence-missing). */
    missing: readonly AssetId[];
    code: readonly ThirdPartyLicence[];
  };
  budget: ExportBudgetReport;
  /** The web app manifest's inputs; null for every target whose `EXPORT_TARGETS` row has `pwa: false`. */
  pwa: {
    name: string;
    shortName: string;
    display: "fullscreen" | "standalone" | "minimal-ui";
    orientation: "any" | "landscape" | "portrait";
    themeColor: string;
    background: string;
    icons: readonly { file: string; size: 192 | 512 }[];
  } | null;
};

export type ParseReleaseManifestResult =
  | { ok: true; manifest: ReleaseManifest }
  | { ok: false; issues: SceneIssue[] };

/** What `findRelease` reads of a recording. */
export type ReleaseRecordingRef = Pick<RunRecording, "project" | "engine"> & {
  /** The release id the run was played from, when it was. */
  release?: Sha256;
};

// ─── Schema ──────────────────────────────────────────────

const count = (description: string) => z.number().int().nonnegative().describe(description);
const buildPath = (description: string) => z.string().min(1).describe(description);
const idList = (description: string) => z.array(idField("An asset id.")).describe(description);
const bundleSchema = (description: string) =>
  z
    .strictObject({
      entries: idList("The blobs, by asset id, sorted."),
      bytes: count("Their total size in bytes."),
    })
    .describe(description);

const FILE_ROLES = ["code", "style", "wasm", "shell", "worker", "icon", "asset", "data"] as const;
const BUDGET_KEYS = ["codeBytes", "firstLoadBytes", "totalBytes", "fileBytes"] as const;

const fileSchema = z
  .strictObject({
    path: buildPath('Relative to release.json; "/" separated, no "..".'),
    sha256: sha256Field("SHA-256 of the file's bytes."),
    bytes: count("The file's size in bytes."),
    role: z.enum(FILE_ROLES).describe("What the file is: what budgets and caches count it as."),
  })
  .describe("One file of the build; release.json itself is never listed.");

const assetSchema = z
  .strictObject({
    key: z.string().min(1).describe("The asset's registry key, which never changes."),
    kind: kindNameField,
    path: z
      .string()
      .refine((p) => assetPathProblem(p) === null, { message: "not a project-relative path" })
      .describe("The asset's project-relative POSIX path in the project the build was made from."),
    sha256: sha256Field("A doc's SHA-256 of its canonical text, a blob's of its bytes."),
    bytes: count("The size of the asset's file in the build."),
    storage: z.enum(["doc", "blob"]).describe("Whether the asset is a doc or a blob."),
    file: buildPath("Its file in the build: `data/<sha256>.json` or `assets/<sha256><ext>`."),
    name: z.string().min(1).optional().describe("Display name; absent means the path's stem."),
    meta: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("A blob's inspected facts (an atlas's frames, a texture's size)."),
    import: z.record(z.string(), z.unknown()).optional().describe("A blob's import settings."),
    licence: sidecarSchema.shape.licence,
  })
  .describe("A shipped asset: its snapshot entry plus where its bytes are in the build.");

const sceneSchema = z
  .strictObject({
    id: idField("The scene's asset id."),
    title: z.string().min(1).optional().describe("Its title in the scene list."),
    sublevel: z.literal(true).optional().describe("Listed as a sublevel in the scene list."),
    physics: z.enum(["rapier", "none"]).describe("Whether the scene needs Rapier."),
    prefabs: idList("Prefabs its expansion uses, by id, sorted."),
    bundle: bundleSchema("The blobs to fetch before its first frame."),
  })
  .describe("A listed scene.");

const creditSchema = z
  .strictObject({
    assets: idList("Assets sharing this exact licence, sorted."),
    spdx: z.string().min(1).optional().describe('An SPDX id ("CC-BY-4.0") or "proprietary".'),
    author: z.string().min(1).optional().describe("Who made them."),
    source: z.string().min(1).optional().describe("Where they came from."),
    attribution: z
      .string()
      .min(1)
      .optional()
      .describe("The exact credit line the licence asks for."),
  })
  .describe("One licence and the shipped assets that carry it.");

const thirdPartySchema = z
  .strictObject({
    package: z.string().min(1).describe("The npm package name."),
    version: z.string().min(1).describe("Its version in the build."),
    licence: z.string().min(1).describe("Its package.json `license` field, an SPDX expression."),
    notice: z
      .string()
      .nullable()
      .describe("Its LICENSE file's text; null when the package ships none."),
  })
  .describe("A package bundled into the code.");

const budgetSchema = z
  .strictObject(
    Object.fromEntries(BUDGET_KEYS.map((k) => [k, count(`The ${k} limit.`)])) as Record<
      (typeof BUDGET_KEYS)[number],
      z.ZodNumber
    >,
  )
  .describe("The size budgets the build was held to, in bytes.");

const manifestSchema = z
  .strictObject({
    $schema: z.string().optional().describe("The release manifest JSON Schema this file follows."),
    kind: z.literal("release").describe('Always "release".'),
    v: z.literal(RELEASE_VERSION).describe("Release manifest format version."),
    engine: z
      .strictObject({
        version: z.string().min(1).describe("ENGINE_VERSION of the build."),
        agentSurface: count("AGENT_SURFACE_VERSION of the build."),
        formats: z
          .strictObject({
            scene: formatField("The scene format version."),
            prefab: formatField("The prefab format version."),
            recording: formatField("The recording format version."),
            inputScript: formatField("The input script format version."),
            save: formatField("The save file format version."),
            collabLayout: formatField("The collab layout version."),
          })
          .describe("The format versions a reader of this build's files must accept."),
      })
      .describe("The engine that built it."),
    game: z
      .strictObject({
        id: idField("The game's id."),
        configHash: z
          .string()
          .min(1)
          .nullable()
          .describe("The game's configHash; null when it declares none."),
        saveVersion: formatField("The game's save version.")
          .nullable()
          .describe("The game's save version; null when it has no saves."),
      })
      .describe("The game the build plays."),
    project: z
      .strictObject({
        id: idField("The project's id."),
        name: z.string().min(1).describe("The project's name."),
        snapshot: sha256Field("The project snapshot's hash; releaseSnapshot rebuilds it."),
        snapshotEngine: z.string().min(1).describe("The engine version that took the snapshot."),
        build: z
          .record(kindNameField, sha256Field("The kind's schema hash."))
          .describe("The snapshot's per-kind schema hashes."),
      })
      .describe("The project the build was made from."),
    build: z
      .strictObject({
        hash: sha256Field(
          "SHA-256 of the stable JSON of the code, style and wasm files as [path, sha256] pairs, sorted by path.",
        ),
        target: z
          .enum(["web", "itch", "desktop", "mobile"])
          .describe("The target the build was made for."),
        rapier: z
          .strictObject({
            package: z
              .enum(["@dimforge/rapier2d", "@dimforge/rapier2d-compat"])
              .describe("The Rapier package bundled."),
            version: z.string().min(1).describe("Its version."),
            file: buildPath("The wasm file.")
              .nullable()
              .describe("The wasm file; null for -compat, which inlines it."),
            bytes: count("The wasm's size in bytes."),
          })
          .nullable()
          .describe("Rapier as built; null when no listed scene needs it."),
        entry: buildPath("The entry script index.html loads."),
        files: z.array(fileSchema).describe("Every file of the build, sorted by path."),
      })
      .describe("The program and the files of the build."),
    time: z
      .strictObject({
        kind: z.enum(["fixed", "turns", "event"]).describe("The game's time model."),
        rate: formatField("Ticks per second."),
        catchUp: z
          .strictObject({ maxMs: count("The longest time caught up, in ms.") })
          .nullable()
          .describe("How far the clock catches up after a pause; null for none."),
        wakeOnPointerMove: z.boolean().describe("Whether a pointer move wakes an event clock."),
      })
      .describe("The game's resolved time model, without the derived tickMs."),
    replay: z
      .strictObject({
        acrossPlatforms: z.boolean().describe("REPLAY_ACROSS_PLATFORMS of the build."),
      })
      .describe("What replays of this build may assume."),
    flow: z
      .strictObject({
        start: idField("The scene the game starts in; one of `scenes`."),
        scenes: z.array(sceneSchema).describe("The listed scenes, in list order."),
      })
      .describe("The scene list: only listed scenes ship."),
    projectBundle: bundleSchema("The blobs resident for the whole run."),
    assets: z
      .record(idField("An asset id."), assetSchema)
      .describe("Every shipped asset by id, docs and blobs."),
    credits: z
      .strictObject({
        assets: z.array(creditSchema).describe("The shipped assets grouped by identical licence."),
        missing: idList("Shipped assets with no licence recorded."),
        code: z.array(thirdPartySchema).describe("The packages bundled into the code."),
      })
      .describe("What the credits page prints."),
    budget: z
      .strictObject({
        limits: budgetSchema,
        measured: z
          .strictObject({
            codeBytes: count("JS and CSS, without wasm."),
            wasmBytes: count("The wasm files."),
            firstLoadBytes: count("What the first frame waits for."),
            assetBytes: count("The blob files."),
            dataBytes: count("The doc texts."),
            totalBytes: count("Every listed file."),
            largestFile: z
              .strictObject({
                path: z.string().describe("The largest file's path."),
                bytes: count("Its size."),
              })
              .describe("The largest file of the build."),
          })
          .describe("The build's sizes by role, in bytes."),
        over: z
          .array(z.enum(BUDGET_KEYS))
          .describe("The budgets exceeded, in the order of `limits`; empty when within all."),
      })
      .describe("The build's sizes against its budgets."),
    pwa: z
      .strictObject({
        name: z.string().min(1).describe("The installed app's name."),
        shortName: z.string().min(1).describe("Its short name."),
        display: z
          .enum(["fullscreen", "standalone", "minimal-ui"])
          .describe("The web app manifest's display mode."),
        orientation: z
          .enum(["any", "landscape", "portrait"])
          .describe("The web app manifest's orientation."),
        themeColor: z.string().min(1).describe("The theme colour, a CSS colour."),
        background: z.string().min(1).describe("The background colour, a CSS colour."),
        icons: z
          .array(
            z
              .strictObject({
                file: buildPath("The icon's file."),
                size: z.union([z.literal(192), z.literal(512)]).describe("Its size in pixels."),
              })
              .describe("One icon."),
          )
          .describe("The app's icons."),
      })
      .nullable()
      .describe("The web app manifest's inputs; null for targets that install no web app."),
  })
  .describe(
    "A build's manifest (release.json): what it ships, which engine and game built it, the project snapshot it pins and its sizes.",
  );

/** A shipped asset's and a listed scene's schemas, which a scene version's `assets` and `entry` share. */
export { assetSchema as releaseAssetSchema, sceneSchema as releaseSceneSchema };

/** The manifest's zod schema; `parseReleaseManifest` checks with it. */
export const releaseManifestSchema: z.ZodType<ReleaseManifest> = manifestSchema;

/** The draft 2020-12 JSON Schema of `release.json`. */
export function releaseJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(manifestSchema);
  return {
    $schema,
    $id: RELEASE_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine release manifest, format v${RELEASE_VERSION}`,
    ...rest,
  };
}

/** Reads `release.json`'s text: bad JSON, a wrong `kind`, a newer `v` or a shape the schema refuses are issues. Never throws. */
export function parseReleaseManifest(text: string): ParseReleaseManifestResult {
  const read = readJsonDocument(text, "release", RELEASE_VERSION, "the release manifest");
  if (!read.ok) return read;
  const parsed = manifestSchema.safeParse(read.raw);
  if (!parsed.success)
    return { ok: false, issues: withIssueLines(text, zodSceneIssues(parsed.error)) };
  return { ok: true, manifest: parsed.data as ReleaseManifest };
}

// ─── Canonical text ──────────────────────────────────────

const ATOMIC: DocLayout = { as: "atomic" };

/** A map whose keys print in `keys`' order; a key `nested` doesn't name is one line. */
function ordered(
  keys: readonly string[],
  nested: Readonly<Record<string, DocLayout>> = {},
): Extract<DocLayout, { as: "map" }> {
  return { as: "map", fields: Object.fromEntries(keys.map((k) => [k, nested[k] ?? ATOMIC])) };
}

export { ordered as orderedLayout };

const lines = (item: Extract<DocLayout, { as: "map" }>): DocLayout => ({ as: "list", item });

const BUNDLE_LAYOUT = ordered(["entries", "bytes"]);

const ASSET_LAYOUT = ordered(
  [
    "key",
    "kind",
    "path",
    "sha256",
    "bytes",
    "storage",
    "file",
    "name",
    "meta",
    "import",
    "licence",
  ],
  { licence: ordered(["spdx", "author", "source", "attribution"]) },
);

/** `ReleaseScene`'s key order. */
export const RELEASE_SCENE_LAYOUT = ordered(
  ["id", "title", "sublevel", "physics", "prefabs", "bundle"],
  { bundle: BUNDLE_LAYOUT },
);

/** The key order of `ReleaseManifest`, with each `files`, `assets`, `scenes` and credits item on one line. */
const MANIFEST_LAYOUT = ordered(
  [
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
  ],
  {
    engine: ordered(["version", "agentSurface", "formats"], {
      formats: ordered(["scene", "prefab", "recording", "inputScript", "save", "collabLayout"]),
    }),
    game: ordered(["id", "configHash", "saveVersion"]),
    project: ordered(["id", "name", "snapshot", "snapshotEngine", "build"], {
      build: { as: "map", rest: ATOMIC },
    }),
    build: ordered(["hash", "target", "rapier", "entry", "files"], {
      rapier: ordered(["package", "version", "file", "bytes"]),
      files: lines(ordered(["path", "sha256", "bytes", "role"])),
    }),
    time: ordered(["kind", "rate", "catchUp", "wakeOnPointerMove"]),
    replay: ordered(["acrossPlatforms"]),
    flow: ordered(["start", "scenes"], {
      scenes: lines(RELEASE_SCENE_LAYOUT),
    }),
    projectBundle: BUNDLE_LAYOUT,
    assets: { as: "map", rest: ATOMIC },
    credits: ordered(["assets", "missing", "code"], {
      assets: lines(ordered(["assets", "spdx", "author", "source", "attribution"])),
      code: lines(ordered(["package", "version", "licence", "notice"])),
    }),
    budget: ordered(["limits", "measured", "over"], {
      limits: ordered(BUDGET_KEYS),
      measured: ordered(
        [
          "codeBytes",
          "wasmBytes",
          "firstLoadBytes",
          "assetBytes",
          "dataBytes",
          "totalBytes",
          "largestFile",
        ],
        { largestFile: ordered(["path", "bytes"]) },
      ),
    }),
    pwa: ordered(
      ["name", "shortName", "display", "orientation", "themeColor", "background", "icons"],
      {
        icons: lines(ordered(["file", "size"])),
      },
    ),
  },
);

const byPath = (a: ReleaseFile, b: ReleaseFile) => byCodeUnit(a.path, b.path);

/** Where the top-level `assets` sits in the canonical text before its items are written in. */
const ASSETS_SLOT = '\n  "assets": {}';

/** `assets` sorted by id, each item on one line in `ReleaseAsset`'s key order. */
function assetsBlock(assets: ReleaseManifest["assets"]): string {
  const ids = Object.keys(assets).sort(byCodeUnit);
  if (ids.length === 0) return "{}";
  // canonicalJson writes a list's items on one line in their layout's order; a map's items it nests.
  const rows = canonicalJson(
    ids.map((id) => assets[id]),
    lines(ASSET_LAYOUT),
  )
    .split("\n")
    .slice(1, ids.length + 1)
    .map((row, i) => `    ${JSON.stringify(ids[i])}: ${row.trim().replace(/,$/, "")}`);
  return `{\n${rows.join(",\n")}\n  }`;
}

/**
 * Canonical text: canonicalJson with the key order of `ReleaseManifest`,
 * `assets` by id, `files` by path, each item of a list or of `assets` on
 * one line; trailing newline.
 */
export function formatReleaseManifest(manifest: ReleaseManifest): string {
  return canonicalWithAssets(
    { ...manifest, build: { ...manifest.build, files: [...manifest.build.files].sort(byPath) } },
    MANIFEST_LAYOUT,
  );
}

/**
 * canonicalJson of `value` in `layout`, with its top-level `assets` sorted
 * by id and each item on one line in `ReleaseAsset`'s key order: the one
 * writer of every format that lists assets as a release does.
 */
export function canonicalWithAssets<V extends { assets: Readonly<Record<AssetId, ReleaseAsset>> }>(
  value: V,
  layout: Extract<DocLayout, { as: "map" }>,
): string {
  const text = canonicalJson({ ...value, assets: {} }, layout);
  const at = text.indexOf(ASSETS_SLOT);
  const end = at + ASSETS_SLOT.length;
  return `${text.slice(0, at)}\n  "assets": ${assetsBlock(value.assets)}${text.slice(end)}`;
}

/** The release id: sha256 of `formatReleaseManifest`'s text. */
export function releaseId(manifest: ReleaseManifest): Promise<Sha256> {
  return sha256(formatReleaseManifest(manifest));
}

/** `build.hash`: SHA-256 of the stable JSON of the code, style and wasm files as [path, sha256] pairs, sorted by path. */
export function releaseBuildHash(files: readonly ReleaseFile[]): Promise<Sha256> {
  const program = files
    .filter((f) => f.role === "code" || f.role === "style" || f.role === "wasm")
    .sort(byPath)
    .map((f) => [f.path, f.sha256]);
  return sha256(stableJson(program));
}

const hasEntries = (value: Record<string, unknown> | undefined): value is Record<string, unknown> =>
  value !== undefined && Object.keys(value).length > 0;

/** Shipped assets as a snapshot pins them, sorted by id: a blob keeps its size, import settings and meta. */
export function snapshotAssetsOf(
  shipped: Readonly<Record<AssetId, ReleaseAsset>>,
): Record<AssetId, SnapshotAsset> {
  const assets: Record<AssetId, SnapshotAsset> = {};
  for (const id of Object.keys(shipped).sort(byCodeUnit)) {
    const a = shipped[id]!;
    const pinned: SnapshotAsset = { key: a.key, kind: a.kind, path: a.path, sha256: a.sha256 };
    if (a.storage === "blob") {
      pinned.bytes = a.bytes;
      if (hasEntries(a.import)) pinned.import = structuredClone(a.import);
      if (hasEntries(a.meta)) pinned.meta = structuredClone(a.meta);
    }
    assets[id] = pinned;
  }
  return assets;
}

/** The project snapshot the manifest pins (`at: 0`), rebuilt from `project` and `assets`; its `hash` is `project.snapshot`. */
export function releaseSnapshot(manifest: ReleaseManifest): ProjectSnapshot {
  const assets = snapshotAssetsOf(manifest.assets);
  const build: Record<AssetKindName, Sha256> = {};
  for (const kind of Object.keys(manifest.project.build).sort(byCodeUnit))
    build[kind] = manifest.project.build[kind]!;
  return {
    kind: "project-snapshot",
    v: PROJECT_SNAPSHOT_VERSION,
    project: manifest.project.id,
    engine: manifest.project.snapshotEngine,
    at: 0,
    build,
    assets,
    hash: manifest.project.snapshot,
  };
}

// ─── The check ───────────────────────────────────────────

/** What a budget is measured over: a manifest's `flow` and bundles, or an export's content plan. */
export type ReleaseBudgetContent = {
  start: AssetId;
  scenes: readonly ReleaseScene[];
  projectBundle: ReleaseManifest["projectBundle"];
  assets: ReleaseManifest["assets"];
};

export type CheckReleaseOptions = {
  /**
   * `measureBudget` from `./export`. Given, `budget` must be what it
   * measures of `build.files` against `budget.limits`; a host without
   * `./export` leaves it out and the budget is taken as written.
   */
  measureBudget?: (
    files: readonly ReleaseFile[],
    content: ReleaseBudgetContent,
    limits: ExportBudget,
  ) => ExportBudgetReport;
  /**
   * The references of a shipped doc, for a host that holds the texts
   * (`manifestDocRefs`); every target must ship. Left out, only blobs'
   * references (an atlas's texture, a font's pages) are checked, from what
   * the manifest records of them.
   */
  docRefs?: (id: AssetId, asset: ReleaseAsset) => readonly RefSite[];
};

/**
 * `CheckReleaseOptions.docRefs` over the shipped docs' texts by id: each
 * doc's references as its kind's `refs` reads it, parsed with `registry`
 * and no project, so a check that reads other assets (an animation's atlas)
 * can't hide a reference to one that doesn't ship. A doc of a kind `kinds`
 * doesn't have (a game's, on a host without the game), with no text in
 * `texts`, or that doesn't parse names nothing: reading it reports that.
 */
export function manifestDocRefs(
  texts: ReadonlyMap<AssetId, string>,
  registry: Registry,
  kinds: KindRegistry = createKindRegistry(registry.game),
): NonNullable<CheckReleaseOptions["docRefs"]> {
  const env: KindEnv = { registry, project: null };
  return (id, asset) => {
    const def = kinds.get(asset.kind);
    const text = texts.get(id);
    if (def?.storage !== "doc" || !def.refs || text === undefined) return [];
    const read = parseAssetDoc(def, text, env);
    return read.ok ? def.refs(read.value, env) : [];
  };
}

const pointer = (...segments: (string | number)[]) => jsonPointer(segments);

/** Every build path the manifest names, with where it names it. */
function namedPaths(m: ReleaseManifest): [string, string][] {
  const out: [string, string][] = [];
  m.build.files.forEach((f, i) => out.push([f.path, pointer("build", "files", i, "path")]));
  out.push([m.build.entry, pointer("build", "entry")]);
  if (m.build.rapier?.file != null)
    out.push([m.build.rapier.file, pointer("build", "rapier", "file")]);
  for (const id of Object.keys(m.assets).sort(byCodeUnit))
    out.push([m.assets[id]!.file, pointer("assets", id, "file")]);
  m.pwa?.icons.forEach((icon, i) => out.push([icon.file, pointer("pwa", "icons", i, "file")]));
  return out;
}

function pathIssues(m: ReleaseManifest): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const [path, at] of namedPaths(m)) {
    const problem = assetPathProblem(path);
    if (problem !== null)
      issues.push(
        makeIssue("schema", {
          message: `${at} "${path}" isn't a path relative to release.json: ${problem}`,
          path: at,
          got: path,
        }),
      );
  }
  const seen = new Set<string>();
  m.build.files.forEach((f, i) => {
    if (seen.has(f.path))
      issues.push(
        makeIssue("schema", {
          message: `build.files lists "${f.path}" twice`,
          path: pointer("build", "files", i, "path"),
          got: f.path,
        }),
      );
    seen.add(f.path);
  });
  return issues;
}

/** Each id `ids` names is a shipped asset, of `storage` when given. */
function shippedIssues(
  m: ReleaseManifest,
  ids: readonly AssetId[],
  at: string,
  what: string,
  want?: { storage?: ReleaseAsset["storage"]; kind?: AssetKindName },
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  ids.forEach((id, i) => {
    const asset = ownValue(m.assets, id);
    const fits =
      asset !== undefined &&
      (want?.storage === undefined || asset.storage === want.storage) &&
      (want?.kind === undefined || asset.kind === want.kind);
    if (fits) return;
    const expected = want?.kind ?? (want?.storage ? `a ${want.storage}` : "an asset");
    issues.push(
      makeIssue("asset-missing", {
        message: asset
          ? `${what} "${id}", which ships as a ${asset.kind} (${asset.storage}), not ${expected}`
          : `${what} "${id}", which isn't among the manifest's assets`,
        path: `${at}/${i}`,
        entityIds: [id],
        expected,
        got: id,
      }),
    );
  });
  return issues;
}

/** A shipped blob's references, through its engine kind's `refs` over the manifest's record of it. */
function blobRefs(id: AssetId, asset: ReleaseAsset): readonly RefSite[] {
  const def = ENGINE_ASSET_KINDS.find((k) => k.kind === asset.kind);
  if (def?.storage !== "blob" || !def.refs) return [];
  return def.refs(assetEntryOf(id, asset, { at: 0, by: "release" }));
}

/** `asset-missing` for each reference out of a shipped asset to one that doesn't ship as a kind it takes. */
function refIssues(m: ReleaseManifest, docRefs: CheckReleaseOptions["docRefs"]): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const id of Object.keys(m.assets).sort(byCodeUnit)) {
    const asset = ownValue(m.assets, id)!;
    const sites = asset.storage === "blob" ? blobRefs(id, asset) : (docRefs?.(id, asset) ?? []);
    for (const site of sites) {
      const target = ownValue(m.assets, site.id);
      if (target && (site.kinds.length === 0 || site.kinds.includes(target.kind))) continue;
      const expected = site.kinds.length > 0 ? site.kinds.join(" or ") : "an asset";
      issues.push(
        makeIssue("asset-missing", {
          message: target
            ? `${asset.kind} "${id}" names "${site.id}" at ${site.pointer}, which ships as a ${target.kind}, not ${expected}`
            : `${asset.kind} "${id}" names "${site.id}" at ${site.pointer}, which isn't among the manifest's assets`,
          path: pointer("assets", id),
          entityIds: [id, site.id],
          expected,
          got: site.id,
        }),
      );
    }
  }
  return issues;
}

function listingIssues(m: ReleaseManifest): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const scenes = m.flow.scenes;
  if (!scenes.some((s) => s.id === m.flow.start))
    issues.push(
      makeIssue("asset-missing", {
        message: `flow.start "${m.flow.start}" isn't one of the listed scenes`,
        path: pointer("flow", "start"),
        entityIds: [m.flow.start],
        expected: scenes.map((s) => s.id).join(", "),
        got: m.flow.start,
      }),
    );
  const seen = new Set<AssetId>();
  scenes.forEach((s, i) => {
    if (seen.has(s.id))
      issues.push(
        makeIssue("schema", {
          message: `flow.scenes lists "${s.id}" twice`,
          path: pointer("flow", "scenes", i, "id"),
          entityIds: [s.id],
        }),
      );
    seen.add(s.id);
  });
  issues.push(
    ...shippedIssues(
      m,
      scenes.map((s) => s.id),
      pointer("flow", "scenes"),
      "flow lists scene",
      { kind: "scene" },
    ),
  );
  scenes.forEach((s, i) => {
    issues.push(
      ...shippedIssues(
        m,
        s.prefabs,
        pointer("flow", "scenes", i, "prefabs"),
        `scene "${s.id}" expands prefab`,
        { kind: "prefab" },
      ),
      ...shippedIssues(
        m,
        s.bundle.entries,
        pointer("flow", "scenes", i, "bundle", "entries"),
        `scene "${s.id}"'s bundle names`,
        { storage: "blob" },
      ),
    );
  });
  issues.push(
    ...shippedIssues(
      m,
      m.projectBundle.entries,
      pointer("projectBundle", "entries"),
      "the project bundle names",
      { storage: "blob" },
    ),
    ...shippedIssues(m, m.credits.missing, pointer("credits", "missing"), "credits.missing names"),
  );
  m.credits.assets.forEach((c, i) =>
    issues.push(
      ...shippedIssues(m, c.assets, pointer("credits", "assets", i, "assets"), "a credit names"),
    ),
  );
  return issues;
}

function rapierIssues(m: ReleaseManifest): SceneIssue[] {
  const rapierScenes = m.flow.scenes.filter((s) => s.physics === "rapier").map((s) => s.id);
  const built = m.build.rapier !== null;
  if (built === rapierScenes.length > 0) return [];
  return [
    makeIssue("schema", {
      message: built
        ? "build.rapier is set, but no listed scene needs Rapier: a physics-free build ships no wasm"
        : `build.rapier is null, but listed scenes need Rapier: ${rapierScenes.join(", ")}`,
      path: pointer("build", "rapier"),
      entityIds: rapierScenes,
      expected: built ? "null" : "the Rapier build",
      got: built ? m.build.rapier!.package : "null",
    }),
  ];
}

/** Every file the manifest names besides `build.files` is one of them, an asset's with its hash. */
function listedFileIssues(m: ReleaseManifest): SceneIssue[] {
  const listed = new Map(m.build.files.map((f) => [f.path, f]));
  const issues: SceneIssue[] = [];
  const missing = (path: string, at: string, what: string, entityIds: string[] = []) => {
    if (listed.has(path)) return;
    issues.push(
      makeIssue("export-asset-missing", {
        message: `${what} "${path}", which build.files doesn't list`,
        path: at,
        entityIds,
        got: path,
      }),
    );
  };
  missing(m.build.entry, pointer("build", "entry"), "build.entry is");
  if (m.build.rapier?.file != null)
    missing(m.build.rapier.file, pointer("build", "rapier", "file"), "build.rapier's wasm is");
  m.pwa?.icons.forEach((icon, i) =>
    missing(icon.file, pointer("pwa", "icons", i, "file"), `the ${icon.size} icon is`),
  );
  for (const id of Object.keys(m.assets).sort(byCodeUnit)) {
    const asset = m.assets[id]!;
    const at = pointer("assets", id, "file");
    const file = listed.get(asset.file);
    if (!file) missing(asset.file, at, `asset "${id}" is`, [id]);
    else if (file.sha256 !== asset.sha256)
      issues.push(
        makeIssue("hash-mismatch", {
          message: `asset "${id}" is ${asset.sha256}, but build.files lists its file "${asset.file}" as ${file.sha256}`,
          path: at,
          entityIds: [id],
          expected: asset.sha256,
          got: file.sha256,
        }),
      );
  }
  return issues;
}

function fileIssues(m: ReleaseManifest, files: ReadonlyMap<string, Sha256>): SceneIssue[] {
  const issues: SceneIssue[] = [];
  m.build.files.forEach((f, i) => {
    const got = files.get(f.path);
    const at = pointer("build", "files", i, "sha256");
    if (got === undefined)
      issues.push(
        makeIssue("export-asset-missing", {
          message: `the build has no file "${f.path}", which build.files lists`,
          path: at,
          expected: f.sha256,
          got: f.path,
        }),
      );
    else if (got !== f.sha256)
      issues.push(
        makeIssue("hash-mismatch", {
          message: `the build's "${f.path}" hashes to ${got}, not its listed ${f.sha256}`,
          path: at,
          expected: f.sha256,
          got,
        }),
      );
  });
  return issues;
}

async function buildHashIssues(m: ReleaseManifest): Promise<SceneIssue[]> {
  const hash = await releaseBuildHash(m.build.files);
  if (hash === m.build.hash) return [];
  return [
    makeIssue("hash-mismatch", {
      message: `build.files' code, style and wasm hash to ${hash}, not build.hash ${m.build.hash}`,
      path: pointer("build", "hash"),
      expected: m.build.hash,
      got: hash,
    }),
  ];
}

async function snapshotIssues(m: ReleaseManifest): Promise<SceneIssue[]> {
  const read = await parseProjectSnapshot(releaseSnapshot(m));
  if (read.ok) return [];
  return read.issues.map((issue) =>
    issue.code === "hash-mismatch"
      ? {
          ...issue,
          message: `project and assets rebuild a snapshot that hashes to ${issue.got}, not project.snapshot ${m.project.snapshot}`,
          path: pointer("project", "snapshot"),
        }
      : issue,
  );
}

function budgetIssues(
  m: ReleaseManifest,
  measure: NonNullable<CheckReleaseOptions["measureBudget"]>,
): SceneIssue[] {
  const content: ReleaseBudgetContent = {
    start: m.flow.start,
    scenes: m.flow.scenes,
    projectBundle: m.projectBundle,
    assets: m.assets,
  };
  const report = measure(m.build.files, content, m.budget.limits);
  const want = stableJson(report);
  const got = stableJson(m.budget);
  if (want === got) return [];
  return [
    makeIssue("schema", {
      message: "budget isn't what build.files measure against budget.limits",
      path: pointer("budget"),
      expected: want,
      got,
    }),
  ];
}

/**
 * Every check a host can make without game code: the shape; every path
 * relative with no ".."; the start listed; scenes, prefabs, bundle entries
 * and credits inside `assets`; every reference out of a shipped blob (and,
 * with `options.docRefs`, a shipped doc) to a shipped asset of a kind it
 * takes; `build.rapier` null exactly when no scene is "rapier"; every
 * named file in `build.files`, an asset's with its hash;
 * `build.hash` and the snapshot hash reproduced; the files present with
 * their hashes (when `files` is given, by path); the budget recomputed (when
 * `options.measureBudget` is given). Empty when the manifest holds together.
 */
export async function checkReleaseManifest(
  manifest: ReleaseManifest,
  files?: ReadonlyMap<string, Sha256>,
  options: CheckReleaseOptions = {},
): Promise<SceneIssue[]> {
  const parsed = manifestSchema.safeParse(manifest);
  if (!parsed.success) return zodSceneIssues(parsed.error);
  const m = parsed.data as ReleaseManifest;
  return [
    ...pathIssues(m),
    ...listingIssues(m),
    ...refIssues(m, options.docRefs),
    ...rapierIssues(m),
    ...listedFileIssues(m),
    ...(await buildHashIssues(m)),
    ...(await snapshotIssues(m)),
    ...(files ? fileIssues(m, files) : []),
    ...(options.measureBudget ? budgetIssues(m, options.measureBudget) : []),
  ];
}

/**
 * The release a recording was made on: the one whose id is its `release`;
 * else (no `release`, or none of `releases` has it) the first whose
 * `project.snapshot` and `engine.version` are the recording's. `releases`
 * come newest first; the caller judges a fallback by its `runHash`.
 */
export function findRelease<R extends { id: Sha256; manifest: ReleaseManifest }>(
  recording: ReleaseRecordingRef,
  releases: readonly R[],
): R | null {
  if (recording.release !== undefined) {
    const exact = releases.find((r) => r.id === recording.release);
    if (exact) return exact;
  }
  const snapshot = recording.project?.snapshot ?? null;
  if (snapshot === null) return null;
  return (
    releases.find(
      (r) =>
        r.manifest.project.snapshot === snapshot &&
        r.manifest.engine.version === recording.engine.version,
    ) ?? null
  );
}
