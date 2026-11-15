import { z } from "zod";

import { ID_PATTERN } from "../game/fields";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { SCHEMA_ID_BASE, toJsonSchema } from "../scene/json-schema";
import type { SceneIssue } from "../scene/types";
import { stableJson } from "./canonical";
import { inspectEntry } from "./inspect/entry";
import type { FontDecompress } from "./inspect/font";
import type { BlobKindDef } from "./kinds/define";
import {
  formatJsonDocument,
  orderKeys,
  readJsonDocument,
  sortKeysDeep,
  zodSceneIssues,
} from "./project-file";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  AssetKindName,
  AssetPath,
  Licence,
  Sha256,
} from "./types";

/** The sidecar format version, the `v` every `<file>.asset.json` carries. */
export const SIDECAR_VERSION = 1;

/** `urn:jams-engine:asset-sidecar:v1`. */
export const SIDECAR_SCHEMA_ID = `${SCHEMA_ID_BASE}asset-sidecar:v${SIDECAR_VERSION}`;

/** A sidecar sits beside its file as `<file>.asset.json`. */
export const SIDECAR_SUFFIX = ".asset.json";

export const sidecarPathOf = (path: AssetPath): AssetPath => `${path}${SIDECAR_SUFFIX}`;

/** A parsed sidecar; `key` is filled with `id` when the file omits it. */
export type AssetSidecar = {
  $schema?: string;
  kind: "asset-sidecar";
  v: 1;
  key: AssetKey;
  id: AssetId;
  /** Absent when kind detection gives the kind. */
  assetKind?: AssetKindName;
  /** Display name; absent means the file's stem. */
  name?: string;
  sha256?: Sha256;
  bytes?: number;
  import?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  /** The kind's `metaVersion` that `meta` was inspected under; absent means 1. */
  metaVersion?: number;
  licence?: Licence;
};

const KIND_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}(?:\/[a-z0-9][a-z0-9-]{0,47})?$/;

const licenceSchema = z
  .strictObject({
    spdx: z.string().min(1).optional().describe('An SPDX id ("CC-BY-4.0") or "proprietary".'),
    author: z.string().min(1).optional().describe("Who made it."),
    source: z.string().min(1).optional().describe("Where it came from: a URL or a description."),
    attribution: z
      .string()
      .min(1)
      .optional()
      .describe("The exact credit line the licence asks for; the credits page prints it."),
  })
  .describe("The asset's licence and credit.");

/** The zod schema `asset-sidecar.schema.json` is generated from; `parseSidecar` checks with it. */
export const sidecarSchema = z
  .strictObject({
    $schema: z.string().optional().describe("The asset sidecar JSON Schema this file follows."),
    kind: z.literal("asset-sidecar").describe('Always "asset-sidecar".'),
    v: z.literal(SIDECAR_VERSION).describe("Sidecar format version."),
    key: z
      .string()
      .regex(ID_PATTERN)
      .optional()
      .describe("The asset's registry key, which never changes; omitted when it equals `id`."),
    id: z
      .string()
      .regex(ID_PATTERN)
      .describe("The asset's id, unique among the project's live assets."),
    assetKind: z
      .string()
      .regex(KIND_NAME_PATTERN)
      .optional()
      .describe(
        "The asset kind (`texture`, or `<game>/<kind>` for a game's); omitted when the file's suffix or content gives it.",
      ),
    name: z
      .string()
      .min(1)
      .optional()
      .describe("Display name; omitted when it is the file's stem."),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .describe("A binary asset's SHA-256, 64 lowercase hex characters."),
    bytes: z.number().int().min(0).optional().describe("A binary asset's size in bytes."),
    import: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Import settings the asset's kind defines (a texture's `filter`)."),
    meta: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("What the kind's inspector read from the file; never hand-edited."),
    metaVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "The version of the kind's inspector `meta` was read under; omitted for 1. An older one than the kind's is inspected again.",
      ),
    licence: licenceSchema.optional(),
  })
  .refine((s) => (s.sha256 === undefined) === (s.bytes === undefined), {
    message: "`sha256` and `bytes` come together",
    path: ["bytes"],
  })
  .describe(
    "The metadata of the asset in the file beside it (`<file>.asset.json`): its key, id, kind, content hash, import settings and licence.",
  );

/** The draft 2020-12 JSON Schema of `<file>.asset.json`. */
export function sidecarJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(sidecarSchema);
  return {
    $schema,
    $id: SIDECAR_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: `jams engine asset sidecar, format v${SIDECAR_VERSION}`,
    ...rest,
  };
}

export type ParseSidecarResult =
  | { ok: true; sidecar: AssetSidecar }
  | { ok: false; issues: SceneIssue[] };

/** Parses a sidecar from text or a parsed value. Never throws. */
export function parseSidecar(input: unknown): ParseSidecarResult {
  const read = readJsonDocument(input, "asset-sidecar", SIDECAR_VERSION, "the sidecar");
  if (!read.ok) return read;
  const parsed = sidecarSchema.safeParse(read.raw);
  if (!parsed.success) return { ok: false, issues: zodSceneIssues(parsed.error, ["id", "key"]) };
  const { key, ...rest } = parsed.data;
  return { ok: true, sidecar: { ...rest, key: key ?? rest.id } as AssetSidecar };
}

const SIDECAR_KEYS = [
  "$schema",
  "kind",
  "v",
  "key",
  "id",
  "assetKind",
  "name",
  "sha256",
  "bytes",
  "import",
  "meta",
  "metaVersion",
  "licence",
];
const LICENCE_KEYS = ["spdx", "author", "source", "attribution"];

/**
 * The canonical text of a sidecar. `key` is left out when it equals `id`,
 * and `assetKind` when it equals `detectedKind`, the kind detection gives
 * the file without a sidecar.
 */
export function formatSidecar(
  sidecar: Omit<AssetSidecar, "key"> & { key?: AssetKey },
  options: { detectedKind?: AssetKindName | null } = {},
): string {
  const value = orderKeys(sidecar as Record<string, unknown>, SIDECAR_KEYS);
  if (sidecar.key === sidecar.id) delete value.key;
  if (sidecar.assetKind !== undefined && sidecar.assetKind === options.detectedKind)
    delete value.assetKind;
  if (sidecar.import) value.import = sortKeysDeep(sidecar.import);
  if (sidecar.meta) value.meta = sortKeysDeep(sidecar.meta);
  if (sidecar.metaVersion === 1) delete value.metaVersion;
  if (sidecar.licence)
    value.licence = orderKeys(sidecar.licence as Record<string, unknown>, LICENCE_KEYS);
  return formatJsonDocument(value);
}

// ─── Meta versions ───────────────────────────────────────

/** The meta version a blob kind's inspector writes: its `metaVersion`, else 1. */
export const kindMetaVersion = (def: Pick<BlobKindDef, "metaVersion">): number =>
  def.metaVersion ?? 1;

/** The meta version a sidecar records for its meta; 1 when it records none. */
export const sidecarMetaVersion = (sidecar: Pick<AssetSidecar, "metaVersion">): number =>
  sidecar.metaVersion ?? 1;

/** Whether a sidecar's meta was inspected under an older version of its kind's inspector, so it is inspected again. */
export const isMetaStale = (
  sidecar: Pick<AssetSidecar, "metaVersion">,
  def: Pick<BlobKindDef, "metaVersion">,
): boolean => sidecarMetaVersion(sidecar) < kindMetaVersion(def);

export type Reinspection =
  | {
      ok: true;
      meta: Record<string, unknown>;
      /** The entry's settings with the ones the inspection fills; absent when there are none. */
      import?: Record<string, unknown>;
      /** The version `meta` is inspected under. */
      metaVersion: number;
      /** Whether `meta` or `import` differs from the entry's. */
      changed: boolean;
    }
  | { ok: false; issue: SceneIssue };

/**
 * A binary's meta inspected again from its bytes under its kind's current
 * inspector: what the dev watcher, the project's writer on store and
 * `assets reimport` all run. `changed` compares with the entry's meta and
 * settings, so a caller writes only what moved.
 */
export function reinspectBlob(
  def: BlobKindDef,
  entry: Pick<AssetEntry, "path" | "import" | "meta">,
  bytes: Uint8Array,
  idAt: (path: AssetPath) => AssetId | undefined,
  decompress?: FontDecompress,
): Reinspection {
  const result = inspectEntry(def, entry, bytes, idAt, decompress);
  if (!result.ok) return result;
  const meta = result.meta as Record<string, unknown>;
  const settings = result.import;
  const changed =
    stableJson(entry.meta ?? null) !== stableJson(meta) ||
    stableJson(entry.import ?? {}) !== stableJson(settings ?? {});
  return {
    ok: true,
    meta,
    ...(settings ? { import: settings } : {}),
    metaVersion: kindMetaVersion(def),
    changed,
  };
}

/** `sidecar` with a re-inspection's meta and the version it was read under; nothing else changes. */
export function withReinspectedMeta(
  sidecar: AssetSidecar,
  result: Extract<Reinspection, { ok: true }>,
): AssetSidecar {
  const { metaVersion: _was, ...rest } = sidecar;
  const next: AssetSidecar = { ...rest, meta: result.meta };
  if (result.metaVersion > 1) next.metaVersion = result.metaVersion;
  return next;
}
