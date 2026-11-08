import { z } from "zod";

import type { ProjectLogEntry } from "../collab/types";
import { createRegistry, type ProjectMaterialDef } from "../game/define";
import { ID_PATTERN } from "../game/fields";
import type { Registry } from "../game/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { bulkKeyType, bulkId } from "../scene/bulk-ref";
import { checksPathOf } from "../scene/checks";
import { closest } from "../scene/did-you-mean";
import { sceneHash } from "../scene/hash";
import { jsonPointer, makeIssue, pointerSegments } from "../scene/issues";
import { SCHEMA_ID_BASE, toJsonSchema } from "../scene/json-schema";
import { applyOps } from "../scene/ops";
import { opBatchSchemaFor, usesBulkRefs } from "../scene/ops-schema";
import { prefabOf, prefabScene, sceneBody } from "../scene/prefab";
import {
  PREFAB_KIND,
  type IssueCode,
  type OpBatch,
  type Prefab,
  type PrefabLibrary,
  type PrefabParam,
  type Pt,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
  type ShapeTuple,
} from "../scene/types";
import { cloneJson, sameValue } from "./canonical";
import { replacementHistory } from "./history";
import { applyJsonEdits, parseJsonPointer, readPointer } from "./json-edit";
import {
  isSkippedAssetPath,
  parseAssetDoc,
  type AssetKindDef,
  type BlobKindDef,
  type DocKindDef,
  type DocLayout,
  type InspectResult,
  type KindEnv,
  type KindRegistry,
} from "./kinds";
import { checksBeside } from "./kinds/checks";
import { DATA_TABLE_KIND, dataTableIssues } from "./kinds/data-table";
import { isPlainObject } from "./kinds/define";
import { GAME_SETTINGS_KIND, gameSettingsEntries } from "./kinds/game-settings";
import { MATERIAL_KIND } from "./kinds/material";
import {
  buildRefIndex,
  inUseIssue,
  namedBy,
  namesAt,
  rewriteRefs,
  type RefIndex,
  type RefSite,
} from "./refs";
import { sidecarSchema } from "./sidecar";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  AssetKindName,
  AssetPath,
  HashHistoryEntry,
  Licence,
  ProjectState,
  ProjectView,
  Sha256,
} from "./types";
import {
  assetIdOfPath,
  assetPathProblem,
  compareEntries,
  fileNameOf,
  folderPrefixOf,
  pathClash,
  projectView,
} from "./view";

/** RFC 6901 pointer into a doc kind's canonical JSON; a segment "@<id>" picks a keyed item by id. */
export type JsonPointer = string;

export type JsonEdit =
  | { set: JsonPointer; value: unknown }
  | { unset: JsonPointer }
  /** Into a keyed collection (value carries its id) or a list; `before` is a sibling's id or index; default the end. */
  | { insert: JsonPointer; value: unknown; before?: string | number }
  | { remove: JsonPointer };

export type ProjectOp =
  /** A text asset. `content` is its canonical JSON (default `kind.empty`); `path` may be a folder ending in "/" to get `<id><extension>`. */
  | {
      op: "createAsset";
      kind: AssetKindName;
      path: AssetPath;
      id?: AssetId;
      content?: unknown;
      licence?: Licence;
    }
  /** A binary asset whose bytes are already in the content store. */
  | {
      op: "importAsset";
      path: AssetPath;
      sha256: Sha256;
      bytes: number;
      kind?: AssetKindName;
      id?: AssetId;
      settings?: Record<string, unknown>;
      licence?: Licence;
    }
  /** The display name and/or the file name in place; the id never changes. A scene's checks file takes the new stem. */
  | { op: "renameAsset"; id: AssetId; name?: string | null; file?: string }
  /** Into a folder; `to` ends with "/" or is "" for the root. A scene's checks file moves with it. */
  | { op: "moveAsset"; ids: AssetId[]; to: string }
  /** To the trash; refused with `asset-in-use` while referenced (a scene's checks file included) unless `force`. */
  | { op: "deleteAsset"; id: AssetId; force?: boolean }
  | { op: "restoreAsset"; id: AssetId }
  /** Changes the id and rewrites every reference in every doc, in one cross-doc batch. */
  | { op: "changeAssetId"; id: AssetId; to: AssetId }
  /** Import settings, per field; null resets one to its default. Meta is re-inspected. */
  | { op: "setImport"; id: AssetId; set: Record<string, unknown> }
  /** New bytes for a blob asset; the old hash joins `history`. */
  | { op: "replaceContent"; id: AssetId; sha256: Sha256; bytes: number }
  | { op: "setLicence"; id: AssetId; licence: Licence | null }
  /** Generic edits to a declarative doc kind's JSON. */
  | { op: "editAsset"; id: AssetId; edits: JsonEdit[] }
  /** A scene's or prefab's SceneOps, so one batch can span docs. */
  | { op: "editScene"; id: AssetId; ops: SceneOp[] };

export type ProjectOpName = ProjectOp["op"];

export type EditSceneOp = Extract<ProjectOp, { op: "editScene" }>;

/** The engine's scene kind: the one target `editScene` writes itself. */
export const SCENE_KIND_NAME = "scene";

/** Scene ops that write prefab docs; an `editScene` holding one goes to the project's prefab writer. */
export const PREFAB_SCENE_OPS: readonly SceneOp["op"][] = [
  "definePrefab",
  "createPrefab",
  "applyToPrefab",
  "unpack",
];

/** Scene ops that change the header of the prefab doc they are sent to; a scene refuses them. */
export const PREFAB_HEADER_OPS: readonly SceneOp["op"][] = ["setPrefabBase", "exposeParam"];

type HeaderOp = Extract<SceneOp, { op: "setPrefabBase" | "exposeParam" }>;

const isHeaderOp = (op: unknown): op is HeaderOp =>
  isPlainObject(op) && PREFAB_HEADER_OPS.includes(op.op as SceneOp["op"]);

/** A batch with its header ops taken out: `at` is each remaining op's index in the original. */
export type SplitHeaderOps = {
  body: SceneOp[];
  at: number[];
  header: { op: HeaderOp; index: number }[];
};

export function splitHeaderOps(ops: readonly SceneOp[]): SplitHeaderOps {
  const out: SplitHeaderOps = { body: [], at: [], header: [] };
  ops.forEach((op, index) => {
    if (isHeaderOp(op)) out.header.push({ op, index });
    else {
      out.body.push(op);
      out.at.push(index);
    }
  });
  return out;
}

/** The index of the first header op in `ops`, or -1. */
export const headerOpAt = (ops: readonly unknown[]): number => ops.findIndex(isHeaderOp);

/** The refusal of a header op sent to a scene. */
export function headerOpOnScene(op: SceneOp, index: number, scene: string): SceneIssue {
  return makeIssue("op-invalid", {
    message: `${op.op} only works on a prefab doc, not on scene "${scene}": send it in an editScene with the prefab's id`,
    path: jsonPointer(["ops", index]),
    entityIds: [scene],
  });
}

/** A failure of the body ops, its op index and pointer mapped back to the batch they came from. */
export function remapBodyFailure<T extends { failedAt: number; issue: SceneIssue }>(
  failure: T,
  at: readonly number[],
): T {
  const index = at[failure.failedAt] ?? failure.failedAt;
  const path = failure.issue.path?.replace(
    /^\/ops\/(\d+)/,
    (_, i: string) => `/ops/${at[Number(i)] ?? i}`,
  );
  return {
    ...failure,
    failedAt: index,
    issue: { ...failure.issue, ...(path !== undefined ? { path } : {}) },
  };
}

/** A prefab's variant base and parameters, as header ops leave them. */
export type PrefabHeaderEdit = Pick<Prefab, "base" | "params">;

export type HeaderOpsResult =
  | { ok: true; header: PrefabHeaderEdit }
  | { ok: false; failedAt: number; issue: SceneIssue };

/**
 * Runs `setPrefabBase` and `exposeParam` on `prefab` (its children and
 * nested instances as the batch's other ops leave them), in order. A base
 * must be a prefab in `library` other than `prefab` itself, and may not lead
 * back to it through bases or nested instances (`prefab-cycle`). Parameter
 * targets are judged by validation, as any override path is.
 */
export function applyHeaderOps(
  prefab: Prefab,
  header: SplitHeaderOps["header"],
  library: PrefabLibrary,
  registry: Registry,
): HeaderOpsResult {
  const parsed = opBatchSchemaFor(registry).safeParse({ ops: header.map((h) => h.op) });
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    const index = header[typeof first.path[1] === "number" ? first.path[1] : 0]!.index;
    const rest = first.path.slice(2).map((p) => (typeof p === "symbol" ? String(p) : p));
    return {
      ok: false,
      failedAt: index,
      issue: makeIssue("op-invalid", {
        message: `${header.find((h) => h.index === index)!.op.op}: ${first.message}`,
        path: jsonPointer(["ops", index, ...rest]),
      }),
    };
  }
  let base = prefab.base;
  const params: Record<string, PrefabParam> = cloneJson(prefab.params ?? {});
  for (const { op, index } of header) {
    const fail = (code: IssueCode, message: string, extra: Partial<SceneIssue> = {}) =>
      ({
        ok: false,
        failedAt: index,
        issue: makeIssue(code, { message, path: jsonPointer(["ops", index]), ...extra }),
      }) as const;
    if (op.op === "exposeParam") {
      if (op.param === null) delete params[op.name];
      else params[op.name] = cloneJson(op.param);
      continue;
    }
    if (op.base === null) {
      base = undefined;
      continue;
    }
    if (!library.has(op.base) || op.base === prefab.id) {
      const known = [...library.keys()].filter((id) => id !== prefab.id);
      const suggestion = closest(op.base, known);
      return fail(
        "variant-base-unknown",
        op.base === prefab.id
          ? `Prefab "${prefab.id}" can't be its own base.`
          : `No prefab "${op.base}" to be the base of "${prefab.id}"${suggestion ? `; did you mean "${suggestion}"?` : ""}.`,
        {
          got: op.base,
          entityIds: [prefab.id],
          ...(suggestion
            ? { hint: `{ "op": "setPrefabBase", "base": ${JSON.stringify(suggestion)} }` }
            : {}),
        },
      );
    }
    const loop = baseLoop(prefab.id, op.base, library);
    if (loop)
      return fail(
        "prefab-cycle",
        `Prefab "${prefab.id}" would contain itself: ${[prefab.id, ...loop].join(" → ")}.`,
        { got: op.base, entityIds: [prefab.id] },
      );
    base = op.base;
  }
  return {
    ok: true,
    header: {
      ...(base !== undefined ? { base } : {}),
      ...(Object.keys(params).length > 0 ? { params } : {}),
    },
  };
}

/** The chain from `base` back to `id` through bases and nested instances, or null when there is none. */
function baseLoop(id: string, base: string, library: PrefabLibrary): string[] | null {
  const seen = new Set<string>();
  const walk = (at: string, chain: string[]): string[] | null => {
    if (at === id) return chain;
    if (seen.has(at)) return null;
    seen.add(at);
    const p = library.get(at);
    if (!p) return null;
    const next = [
      ...(typeof p.base === "string" ? [p.base] : []),
      ...(p.instances ?? []).map((n) => n.prefab),
    ];
    for (const n of next) {
      const found = walk(n, [...chain, n]);
      if (found) return found;
    }
    return null;
  };
  return walk(base, [base]);
}

/** Whether an `editScene` writes prefab docs: it targets a prefab, or holds a prefab op. */
export function writesPrefabs(op: EditSceneOp, targetKind: AssetKindName | undefined): boolean {
  return (
    targetKind === PREFAB_KIND ||
    (Array.isArray(op.ops) &&
      op.ops.some((o) => isPlainObject(o) && PREFAB_SCENE_OPS.includes(o.op as SceneOp["op"])))
  );
}

export const PROJECT_OP_NAMES = [
  "createAsset",
  "importAsset",
  "renameAsset",
  "moveAsset",
  "deleteAsset",
  "restoreAsset",
  "changeAssetId",
  "setImport",
  "replaceContent",
  "setLicence",
  "editAsset",
  "editScene",
] as const satisfies readonly ProjectOpName[];

export type ProjectOpBatch = {
  v: 1;
  label?: string;
  /** File batches only: the project snapshot hash the batch was written against (stale → exit 3). */
  base?: Sha256;
  ops: ProjectOp[];
};

export type ProjectApplyResult =
  | {
      ok: true;
      /** Doc names written, in write order. */
      docs: string[];
      created: AssetId[];
      /** Issues the batch leaves (warnings and errors on the result, as applyOps reports). */
      issues: SceneIssue[];
      /** The project log entry, when the batch wrote more than one doc. */
      entry?: ProjectLogEntry;
    }
  | { ok: false; opIndex: number; issue: SceneIssue };

/** What a blob op's inspection is given: the entry as the op leaves it (its hash, bytes, settings and path). */
export type BlobInspect = (kind: BlobKindDef, entry: AssetEntry) => InspectResult<unknown>;

/** What checking a batch needs beside the state: the kinds, who and when for `created` and `deleted` stamps, and new keys. */
export type ProjectBatchEnv = {
  registry: Registry;
  kinds: KindRegistry;
  now: number;
  by: string;
  /** New registry keys: collab's `randomKey` live, `sequentialKeys` in tests. */
  newKey: () => AssetKey;
  /**
   * Derives a blob entry's `meta` (and any import settings the file names)
   * when an op changes its content or settings; the host looks the bytes up
   * by `entry.sha256`. Without it the entry's `meta` is dropped when its
   * hash changes and kept otherwise, for the host to fill.
   */
  inspect?: BlobInspect;
  /** The prefabs a scene's instances resolve against, by the scene's asset id. */
  prefabsFor?: (scene: AssetId) => PrefabLibrary;
  /**
   * Judges an `editScene` that writes prefab docs (`writesPrefabs`): the
   * project session's prefab writer. Null accepts the op and leaves its
   * writing to the caller; without this hook such ops are refused with
   * `op-invalid`. A `changeAssetId` whose referrers include prefabs asks
   * here too, once per prefab, with the rewrite as an `editScene` of its
   * own and `index` the `changeAssetId`'s.
   */
  prefabEdit?: (op: EditSceneOp, ctx: { entry: AssetEntry; index: number }) => SceneIssue | null;
};

/** What the batch does to one scene doc: its scene ops in order, judged with this registry and these prefabs. */
export type SceneWrite = {
  ops: SceneOp[];
  registry: Registry;
  prefabs?: PrefabLibrary;
};

/** A batch applied to plain JSON: the registry and doc values it would leave, before anything is written. */
export type ProjectBatchCheck =
  | {
      ok: true;
      state: ProjectState;
      /** Every touched doc asset's value after the batch, by key. */
      values: ReadonlyMap<AssetKey, unknown>;
      /** The batch changes the registry, so the project doc is written first. */
      registry: boolean;
      /** Keys of the asset and scene docs the batch writes, in write order. */
      written: AssetKey[];
      /** The index of the op that first wrote each key of `written`. */
      writtenBy: ReadonlyMap<AssetKey, number>;
      /** The scene docs among `written`, with the scene ops that reach each (a `changeAssetId`'s rewrites included). */
      scenes: ReadonlyMap<AssetKey, SceneWrite>;
      created: AssetId[];
      issues: SceneIssue[];
      /** Indices of the `editScene` ops `prefabEdit` accepted; the caller writes those. */
      delegated: number[];
    }
  | { ok: false; opIndex: number; issue: SceneIssue };

// ─── The op schema ───────────────────────────────────────

/** `urn:jams-engine:project-ops:v1`. Project ops are game-agnostic, so there is one schema. */
export const PROJECT_OPS_SCHEMA_ID = `${SCHEMA_ID_BASE}project-ops:v1`;

const sidecarFields = sidecarSchema.shape;

const AssetIdSchema = z
  .string()
  .regex(ID_PATTERN)
  .describe(
    "An asset id: lowercase letters, digits and hyphens, starting with a letter or digit, at most 48 characters; unique among the project's live assets.",
  );

const AssetPathSchema = z
  .string()
  .min(1)
  .max(255)
  .describe(
    'A project-relative POSIX path with the file name, e.g. "sprites/crate.png": no leading "/", no "." or ".." segments, names of letters, digits, ".", "_", "-" and spaces. Two live paths may not differ only in case.',
  );

const FolderSchema = z
  .string()
  .max(255)
  .describe('A folder ending in "/", e.g. "sprites/enemies/", or "" for the project root.');

const KindNameSchema = sidecarFields.assetKind
  .unwrap()
  .describe('An asset kind: "material", "texture", or "<game>/<kind>" for a game\'s own kind.');
const Sha256Schema = sidecarFields.sha256
  .unwrap()
  .describe(
    "A SHA-256 of the bytes as 64 lowercase hex characters, as the content store returned it when they were uploaded.",
  );
const BytesSchema = sidecarFields.bytes.unwrap().describe("The size of the bytes.");
const LicenceSchema = sidecarFields.licence.unwrap();

const opName = <N extends ProjectOpName>(name: N) => z.literal(name).describe(`The op: ${name}.`);

const PointerSchema = z
  .string()
  .describe(
    'A JSON Pointer into the asset\'s file, e.g. "/physics/friction"; a segment "@<id>" picks a keyed item by its id ("/rows/@fireball/cost").',
  );

const JsonEditSchema = z
  .union([
    z
      .strictObject({ set: PointerSchema, value: z.unknown().describe("The new value.") })
      .describe("Set the value at a pointer."),
    z.strictObject({ unset: PointerSchema }).describe("Remove an object key."),
    z
      .strictObject({
        insert: PointerSchema.describe("The keyed collection or list to insert into."),
        value: z.unknown().describe("The item; a keyed collection's item carries its id."),
        before: z
          .union([z.string(), z.number().int().min(0)])
          .optional()
          .describe("A sibling's id (keyed) or index (list) to insert before; omitted appends."),
      })
      .describe("Insert an item into a keyed collection or a list."),
    z.strictObject({ remove: PointerSchema }).describe("Remove an item or key."),
  ])
  .describe("One edit to a declarative asset's JSON.");

const OP_SCHEMAS = [
  z
    .strictObject({
      op: opName("createAsset"),
      kind: KindNameSchema,
      path: z
        .string()
        .max(255)
        .describe(
          'Where the file goes: a file path ("materials/rubber.json"), a folder ending in "/" for `<id><extension>` there, or "" for the kind\'s default folder.',
        ),
      id: AssetIdSchema.optional().describe(
        "The new asset's id; omitted, the file's stem (or `<kind>-<n>` for a folder path).",
      ),
      content: z
        .unknown()
        .optional()
        .describe(
          "The file's JSON as the kind's schema defines it; omitted, the kind's empty value.",
        ),
      licence: LicenceSchema.optional(),
    })
    .describe("Create a text asset (a scene, prefab, material, table, …) and its doc."),
  z
    .strictObject({
      op: opName("importAsset"),
      path: AssetPathSchema,
      sha256: Sha256Schema,
      bytes: BytesSchema,
      kind: KindNameSchema.optional().describe(
        "The blob kind; omitted, the one the path's suffix gives.",
      ),
      id: AssetIdSchema.optional().describe("The new asset's id; omitted, the file's stem."),
      settings: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Import settings the kind defines (a texture's `filter`); omitted, defaults."),
      licence: LicenceSchema.optional(),
    })
    .describe(
      "Add a binary asset (an image, atlas, font, sound) whose bytes are already in the project's content store.",
    ),
  z
    .strictObject({
      op: opName("renameAsset"),
      id: AssetIdSchema.describe("The asset."),
      name: z
        .union([z.string().min(1).max(120), z.null()])
        .optional()
        .describe("The display name; null goes back to the file's stem."),
      file: z
        .string()
        .min(1)
        .max(96)
        .optional()
        .describe('A new file name in the same folder, e.g. "rubber-ball.json"; same kind suffix.'),
    })
    .describe("Change an asset's display name or file name. Its id and references stay."),
  z
    .strictObject({
      op: opName("moveAsset"),
      ids: z.array(AssetIdSchema).min(1).describe("The assets to move."),
      to: FolderSchema,
    })
    .describe("Move assets into a folder, keeping their file names. References follow by id."),
  z
    .strictObject({
      op: opName("deleteAsset"),
      id: AssetIdSchema.describe("The asset."),
      force: z
        .boolean()
        .optional()
        .describe("Trash it even while other assets reference it; they report asset-missing."),
    })
    .describe("Move an asset to the trash. Its content is kept, so restoreAsset brings it back."),
  z
    .strictObject({
      op: opName("restoreAsset"),
      id: AssetIdSchema.describe("The trashed asset's id; the most recently trashed one wins."),
    })
    .describe("Bring an asset back from the trash to its old path; refused while it is taken."),
  z
    .strictObject({
      op: opName("changeAssetId"),
      id: AssetIdSchema.describe("The asset's current id."),
      to: AssetIdSchema.describe("The new id; must be free."),
    })
    .describe("Change an asset's id and rewrite every reference to it, in every doc."),
  z
    .strictObject({
      op: opName("setImport"),
      id: AssetIdSchema.describe("A binary asset."),
      set: z
        .record(z.string(), z.unknown())
        .describe("Setting name to new value; null resets one to its default."),
    })
    .describe("Change a binary asset's import settings, field by field; its metadata is re-read."),
  z
    .strictObject({
      op: opName("replaceContent"),
      id: AssetIdSchema.describe("A binary asset."),
      sha256: Sha256Schema,
      bytes: BytesSchema,
    })
    .describe(
      "Point a binary asset at new bytes already in the content store; the old ones stay in its history. Recordings can't be replaced.",
    ),
  z
    .strictObject({
      op: opName("setLicence"),
      id: AssetIdSchema.describe("The asset."),
      licence: z
        .union([LicenceSchema, z.null()])
        .describe("The whole licence (fields left out are cleared), or null to clear it."),
    })
    .describe("Set or clear an asset's licence and credit line."),
  z
    .strictObject({
      op: opName("editAsset"),
      id: AssetIdSchema.describe("A declarative text asset (a material, table, settings, …)."),
      edits: z.array(JsonEditSchema).min(1).describe("Applied in order."),
    })
    .describe("Edit a text asset's JSON; the result is checked against its kind's schema."),
  z
    .strictObject({
      op: opName("editScene"),
      id: AssetIdSchema.describe("A scene or prefab."),
      ops: z
        .array(
          z
            .looseObject({ op: z.string().describe("The scene op's name, e.g. move.") })
            .describe("A scene op as the game's ops.schema.json defines it."),
        )
        .min(1)
        .describe("Scene ops, applied as one scene batch."),
    })
    .describe("Edit a scene or prefab with scene ops, inside this project batch."),
] as const;

function unknownOpMessage(got: unknown): string {
  const expected = `Expected one of: ${PROJECT_OP_NAMES.join(", ")}.`;
  if (got === undefined) return `Missing op. ${expected}`;
  const guess = typeof got === "string" ? closest(got, PROJECT_OP_NAMES) : undefined;
  return `Unknown op ${JSON.stringify(got)}${guess ? `; did you mean "${guess}"?` : "."} ${expected}`;
}

const ProjectOpSchema = z
  .discriminatedUnion("op", OP_SCHEMAS, {
    error: (iss) =>
      iss.code === "invalid_union"
        ? unknownOpMessage((iss.input as Record<string, unknown> | undefined)?.op)
        : undefined,
  })
  .describe("One edit to a project's assets.");

/** The zod schema `project-ops.schema.json` is generated from; `checkProjectBatch` checks with it. */
export const projectOpBatchSchema = z
  .strictObject({
    v: z.literal(1).describe("Project op batch format version."),
    label: z
      .string()
      .optional()
      .describe('A short human label for history and logs, e.g. "Import crate art".'),
    base: Sha256Schema.optional().describe(
      "File batches only: the project snapshot hash the batch was written against; a stale one is refused.",
    ),
    ops: z.array(ProjectOpSchema).describe("Applied in order, atomically: if one fails, none do."),
  })
  .describe(
    "A batch of edits to a project's assets: creating, importing, moving, renaming, trashing and restoring them, their import settings, content and licences. Assets are named by id; paths are project-relative.",
  );

/** The draft 2020-12 JSON Schema of a project op batch. */
export function projectOpsJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = toJsonSchema(projectOpBatchSchema);
  return {
    $schema,
    $id: PROJECT_OPS_SCHEMA_ID,
    [AGENT_SURFACE_KEYWORD]: AGENT_SURFACE_VERSION,
    title: "jams engine project op batch, format v1",
    ...rest,
  };
}

// ─── Checking ────────────────────────────────────────────

/** Kinds immutable once imported: a recording pins the scene it was made on. */
const IMMUTABLE_KINDS: readonly AssetKindName[] = ["recording"];

/** Where in the op a failure points: a key, or segments below the op. */
type Field = string | readonly (string | number)[];

class OpFailure {
  constructor(readonly issue: SceneIssue) {}
}

function schemaFailure(error: z.ZodError, batch: unknown): ProjectBatchCheck {
  const first = error.issues[0]!;
  const segs = first.path.filter((p): p is string | number => typeof p !== "symbol");
  const opIndex = segs[0] === "ops" && typeof segs[1] === "number" ? segs[1] : 0;
  const path = jsonPointer(segs);
  const where = path || "/";
  if (first.code === "unrecognized_keys") {
    const key = first.keys[0]!;
    const op = segs.length === 2 ? valueAt(batch, [...segs, "op"]) : undefined;
    const known =
      typeof op === "string"
        ? Object.keys(OP_SCHEMAS.find((s) => s.shape.op.value === op)?.shape ?? {})
        : [];
    const guess = closest(key, known);
    return {
      ok: false,
      opIndex,
      issue: makeIssue("op-invalid", {
        message: `unknown key "${key}" at ${where}${guess ? `; did you mean "${guess}"?` : ""}`,
        path: `${path}${jsonPointer([key])}`,
        got: key,
      }),
    };
  }
  return {
    ok: false,
    opIndex,
    issue: makeIssue("op-invalid", { message: `${where}: ${first.message}`, path }),
  };
}

function valueAt(value: unknown, segs: readonly (string | number)[]): unknown {
  let at = value;
  for (const s of segs) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string | number, unknown>)[s];
  }
  return at;
}

/** The working state of one batch: entries are replaced, never mutated, so the input state stays as it was. */
class BatchWork {
  readonly assets: Record<AssetKey, AssetEntry>;
  readonly history: Record<AssetKey, readonly HashHistoryEntry[]>;
  readonly values = new Map<AssetKey, unknown>();
  readonly written: AssetKey[] = [];
  readonly writtenBy = new Map<AssetKey, number>();
  readonly scenes = new Map<AssetKey, SceneWrite>();
  readonly created: AssetId[] = [];
  readonly warnings: SceneIssue[] = [];
  readonly delegated: number[] = [];
  /** Ids trashed with `force` while referenced: their referrers' `asset-missing` is on the result. */
  readonly forced = new Set<AssetId>();
  /** Assets the batch trashes without `force`, judged for references once every op has run. */
  private readonly trashing = new Map<
    AssetId,
    {
      entry: AssetEntry;
      index: number;
      by: "deleteAsset" | "editScene";
      /** A scene whose own value the batch couldn't work out, so it isn't judged as a referrer. */
      unread?: AssetId;
    }
  >();
  /** What the delegated `editScene`s leave their scenes and prefabs, by key: read only to find references. */
  private readonly leaves = new Map<AssetKey, unknown>();
  /**
   * Delegated `editScene`s in op order, for `settleDelegated`: with the
   * library as given (their writes land before the batch's renames do), or
   * with the batch's renames for a `changeAssetId` rewrite, which names the
   * new id; and the registry they were judged with.
   */
  private readonly deferred: {
    entry: AssetEntry;
    index: number;
    ops: SceneOp[];
    prefabs: PrefabLibrary | undefined;
    registry: Registry;
  }[] = [];
  /** The op index of each `deleteAsset` the batch ran, by id, until a later op restores it. */
  private readonly deletedAt = new Map<AssetId, number>();
  /** True while a `changeAssetId` rewrites a referrer through `editScene`. */
  private rewriting = false;
  registry = false;
  private cached: ProjectView | null = null;
  private opIndex = 0;
  /** Ids this batch changed, old → new, for the prefab library and material choices later ops judge with. */
  private readonly prefabIds = new Map<AssetId, AssetId>();
  private readonly materialIds = new Map<AssetId, AssetId>();
  private registryCache: Registry | null = null;
  private settledCache: Registry | null = null;

  constructor(
    readonly state: ProjectState,
    readonly docs: ReadonlyMap<AssetId, unknown>,
    readonly env: ProjectBatchEnv,
  ) {
    this.assets = { ...state.assets };
    this.history = { ...state.history };
  }

  get view(): ProjectView {
    return (this.cached ??= projectView(this.current(), this.env.kinds));
  }

  current(): ProjectState {
    return { ...this.state, assets: this.assets, history: this.history };
  }

  /** The registry ops are judged with: the env's, plus each material this batch gave a new id under that id too. */
  get judge(): Registry {
    if (this.materialIds.size === 0) return this.env.registry;
    return (this.registryCache ??= withMaterialIds(this.env.registry, this.materialIds, true));
  }

  /** The registry as the batch leaves it: each material this batch gave a new id under that id only. */
  get settled(): Registry {
    if (this.materialIds.size === 0) return this.env.registry;
    return (this.settledCache ??= withMaterialIds(this.env.registry, this.materialIds, false));
  }

  kindEnv(): KindEnv {
    return { registry: this.judge, project: this.view };
  }

  /** The id an entry had when the batch began, which is how `docs` names it. */
  private givenId(entry: AssetEntry): AssetId {
    return this.state.assets[entry.key]?.id ?? entry.id;
  }

  /** A doc asset's value as the batch has left it so far, else as given; undefined when neither. */
  peek(entry: AssetEntry): unknown {
    if (this.values.has(entry.key)) return this.values.get(entry.key);
    return this.docs.get(this.givenId(entry));
  }

  /** References among the live assets as the batch has left them, over the values known. */
  refIndex(): RefIndex {
    const values = new Map<AssetId, unknown>();
    for (const e of this.view.byId.values()) {
      const value = this.peek(e);
      if (value !== undefined) values.set(e.id, value);
    }
    return buildRefIndex(this.view, values, this.env.kinds, this.kindEnv());
  }

  /**
   * `asset-in-use` for the first asset trashed without `force` (by op order)
   * that a live asset still names once the whole batch has run, delegated
   * `editScene`s included; the other trashed assets don't count as referrers.
   */
  trashedInUse(): { opIndex: number; issue: SceneIssue } | undefined {
    if (this.trashing.size === 0) return undefined;
    const values = new Map<AssetId, unknown>();
    for (const e of this.view.byId.values()) {
      const value = this.leaves.has(e.key) ? this.leaves.get(e.key) : this.peek(e);
      if (value !== undefined) values.set(e.id, value);
    }
    const index = buildRefIndex(this.view, values, this.env.kinds, this.kindEnv());
    const gone = (id: AssetId) => this.trashing.has(id);
    const order = [...this.trashing.values()].sort((a, b) => a.index - b.index);
    for (const { entry, index: opIndex, by, unread } of order) {
      // A later op of the batch restored it, or gave its id to another asset.
      if (by === "deleteAsset" && this.view.byId.has(entry.id)) continue;
      const issue = inUseIssue(index, entry, {
        skip: (id) => gone(id) || id === unread,
        byPath: this.besideTrashed(entry),
        remedy:
          by === "deleteAsset"
            ? "repoint or remove those references first, or delete with force"
            : "repoint or remove those references before removing it",
      });
      if (issue) {
        const field = by === "deleteAsset" ? "id" : "ops";
        return { opIndex, issue: { ...issue, path: jsonPointer(["ops", opIndex, field]) } };
      }
    }
    return undefined;
  }

  /**
   * `dup-id` for a row id repeated across the assets of a table the batch
   * wrote, over the tables' contents it knows (given or written).
   */
  tableIssues(): SceneIssue[] {
    const tables = new Set<unknown>();
    for (const key of this.written) {
      const value = this.values.get(key);
      if (this.assets[key]?.kind === DATA_TABLE_KIND && isPlainObject(value))
        tables.add(value.table);
    }
    if (tables.size === 0) return [];
    const values = new Map<AssetId, unknown>();
    for (const e of this.view.byId.values())
      if (e.kind === DATA_TABLE_KIND) values.set(e.id, this.peek(e));
    return dataTableIssues(this.view, values).filter((i) => tables.has(i.detail?.table));
  }

  /** The op the last failure was at. */
  get failedAt(): number {
    return this.opIndex;
  }

  fail(code: IssueCode, message: string, field?: Field, extra: Partial<SceneIssue> = {}): never {
    const at = field === undefined ? [] : typeof field === "string" ? [field] : field;
    const path = jsonPointer(["ops", this.opIndex, ...at]);
    throw new OpFailure(makeIssue(code, { message, path, ...extra }));
  }

  put(entry: AssetEntry): void {
    if (sameValue(this.assets[entry.key], entry)) return;
    this.assets[entry.key] = entry;
    this.registry = true;
    this.cached = null;
  }

  appendHistory(key: AssetKey, items: HashHistoryEntry[]): void {
    if (items.length === 0 && this.history[key]) return;
    this.history[key] = [...(this.history[key] ?? []), ...items];
    this.registry = true;
    this.cached = null;
  }

  newKey(): AssetKey {
    for (let tries = 0; tries < 16; tries++) {
      const key = this.env.newKey();
      if (ID_PATTERN.test(key) && !Object.hasOwn(this.assets, key)) return key;
    }
    throw new Error("checkProjectBatch: newKey keeps returning keys that are taken or invalid");
  }

  live(id: AssetId, field: Field = "id"): AssetEntry {
    const entry = this.view.byId.get(id);
    if (entry) return entry;
    if (this.view.deleted.some((e) => e.id === id))
      this.fail("ref-not-found", `"${id}" is in the trash; restore it first`, field, {
        entityIds: [id],
        got: id,
      });
    const guess = closest(id, [...this.view.byId.keys()]);
    return this.fail(
      "ref-not-found",
      `the project has no live asset "${id}"${guess ? `; did you mean "${guess}"?` : ""}`,
      field,
      { entityIds: [id], got: id },
    );
  }

  kind(name: AssetKindName, field: Field = "kind"): AssetKindDef {
    const def = this.env.kinds.get(name);
    if (def) return def;
    const guess = closest(
      name,
      this.env.kinds.list().map((k) => k.kind),
    );
    return this.fail(
      "asset-kind",
      `the project registers no asset kind "${name}"${guess ? `; did you mean "${guess}"?` : ""}`,
      field,
      { got: name },
    );
  }

  blob(entry: AssetEntry): BlobKindDef {
    const def = this.kind(entry.kind, "id");
    if (def.storage !== "blob")
      this.fail("asset-kind", `"${entry.id}" is a ${entry.kind}, not a binary asset`, "id", {
        entityIds: [entry.id],
      });
    return def as BlobKindDef;
  }

  checkId(id: AssetId, field: Field, except?: AssetKey): void {
    if (!ID_PATTERN.test(id))
      this.fail("op-invalid", `"${id}" isn't an asset id: ${ID_PATTERN.source}`, field, {
        got: id,
      });
    const holder = this.view.byId.get(id);
    if (holder && holder.key !== except)
      this.fail("asset-id-taken", `the id "${id}" is taken by "${holder.path}"`, field, {
        entityIds: [id],
        got: id,
      });
  }

  /** The path must be an asset path, never-an-asset paths excepted, and free of every live entry but `except`, ignoring case. */
  checkPath(path: AssetPath, field: Field, except?: AssetKey): void {
    const problem = assetPathProblem(path);
    if (problem) this.fail("op-invalid", `"${path}": ${problem}`, field, { got: path });
    if (isSkippedAssetPath(path))
      this.fail("op-invalid", `"${path}" is a schema, sidecar or test path`, field, { got: path });
    const clash = pathClash(Object.values(this.assets), path, except);
    if (clash)
      this.fail("path-taken", clash.message, field, { entityIds: [clash.entry.id], got: path });
  }

  /** The file's name must give `def` (its suffix, or a `.json` file whose content or sidecar says so). */
  checkFits(def: AssetKindDef, path: AssetPath, value: unknown, field: Field): void {
    const detected = this.env.kinds.detect(path, value);
    if (detected?.kind === def.kind) return;
    const open =
      detected === null &&
      path.toLowerCase().endsWith(".json") &&
      (value === undefined || def.storage === "blob");
    if (open) return;
    const name = fileNameOf(path);
    const suffixes = def.match.suffixes ?? [];
    const want =
      suffixes.length > 0
        ? `a name ending in ${suffixes.join(" or ")}`
        : def.match.jsonKind
          ? `a .json file with "kind": "${def.match.jsonKind}"`
          : "a .json file";
    this.fail(
      "asset-kind",
      `"${name}" doesn't fit the kind ${def.kind}${detected ? ` (it reads as ${detected.kind})` : ""}: ${def.kind} needs ${want}`,
      field,
      { got: path, expected: def.kind },
    );
  }

  /** Re-derives a blob entry's meta through the host's inspector; drops stale meta when the hash changed. */
  inspected(def: BlobKindDef, entry: AssetEntry, hashChanged: boolean): AssetEntry {
    if (!this.env.inspect) {
      if (!hashChanged || entry.meta === undefined) return entry;
      const { meta: _stale, ...rest } = entry;
      return rest;
    }
    const result = this.env.inspect(def, entry);
    if (!result.ok) {
      const { code, message, path: _path, ...rest } = result.issue;
      this.fail(code, message, "id", { ...rest, entityIds: [entry.id] });
    }
    const settings = { ...result.import, ...entry.import };
    const next: AssetEntry = { ...entry, meta: result.meta as Record<string, unknown> };
    if (Object.keys(settings).length > 0) next.import = settings;
    return next;
  }

  stamp(): { at: number; by: string } {
    return { at: this.env.now, by: this.env.by };
  }

  run(op: ProjectOp, index: number): void {
    this.opIndex = index;
    switch (op.op) {
      case "createAsset":
        return this.createAsset(op);
      case "importAsset":
        return this.importAsset(op);
      case "renameAsset":
        return this.renameAsset(op);
      case "moveAsset":
        return this.moveAsset(op);
      case "deleteAsset":
        return this.deleteAsset(op);
      case "restoreAsset":
        return this.restoreAsset(op);
      case "setImport":
        return this.setImport(op);
      case "replaceContent":
        return this.replaceContent(op);
      case "setLicence":
        return this.setLicence(op);
      case "editAsset":
        return this.editAsset(op);
      case "editScene":
        return this.editScene(op);
      case "changeAssetId":
        return this.changeAssetId(op);
    }
  }

  /** A doc asset's value as the batch has left it so far, else the one the caller passed. */
  private contentOf(entry: AssetEntry, op: ProjectOpName): unknown {
    const value = this.peek(entry);
    if (value !== undefined) return value;
    return this.fail(
      "op-invalid",
      `${op} checks "${entry.id}" against its current content, which wasn't given`,
      "id",
      { entityIds: [entry.id] },
    );
  }

  private wrote(key: AssetKey, value: unknown): void {
    this.values.set(key, value);
    if (!this.written.includes(key)) this.written.push(key);
    if (!this.writtenBy.has(key)) this.writtenBy.set(key, this.opIndex);
  }

  private editAsset(op: Extract<ProjectOp, { op: "editAsset" }>): void {
    const entry = this.live(op.id);
    const def = this.kind(entry.kind, "id");
    if (def.storage !== "doc")
      this.fail(
        "asset-kind",
        def.storage === "blob"
          ? `"${entry.id}" is a ${def.kind}, a binary asset: use replaceContent or setImport`
          : `"${entry.id}" is code, which lives in git`,
        "id",
        { entityIds: [entry.id] },
      );
    const doc = def as DocKindDef;
    if (doc.layout === "custom")
      this.fail("op-invalid", `"${entry.id}" is a ${doc.kind}: edit it with editScene`, "id", {
        entityIds: [entry.id],
      });
    const layout = doc.layout as Exclude<DocKindDef["layout"], "custom">;
    const edited = applyJsonEdits(this.contentOf(entry, op.op), layout, op.edits);
    const edits = jsonPointer(["ops", this.opIndex, "edits"]);
    if (!edited.ok) {
      const { code, message, path, ...rest } = edited.issue;
      this.fail(code, message, undefined, {
        ...rest,
        path: `${edits}${path ?? ""}`,
        entityIds: [entry.id],
      });
    }
    if (doc.idField && isPlainObject(edited.value) && edited.value[doc.idField] !== entry.id)
      this.fail(
        "op-invalid",
        `editAsset can't change "${entry.id}"'s ${doc.idField}: use changeAssetId`,
        "edits",
        { entityIds: [entry.id] },
      );
    const parsed = parseAssetDoc(doc, edited.value, this.kindEnv());
    const named = (issue: SceneIssue): SceneIssue => ({
      ...issue,
      message: `"${entry.id}" ${issue.message}`,
      entityIds: [entry.id],
    });
    if (!parsed.ok) {
      const first = parsed.issues.find((i) => i.severity === "error") ?? parsed.issues[0]!;
      const { code, message, path, ...rest } = named(first);
      this.fail(code, message, undefined, { ...rest, path: edits, got: path ?? "" });
    }
    this.warnings.push(...parsed.issues.map(named));
    this.wrote(entry.key, parsed.value);
  }

  private editScene(op: EditSceneOp): void {
    const entry = this.live(op.id);
    const header = entry.kind === PREFAB_KIND || !Array.isArray(op.ops) ? -1 : headerOpAt(op.ops);
    if (header >= 0) {
      const { code, message, path, ...rest } = headerOpOnScene(op.ops[header]!, header, entry.id);
      this.fail(code, message, undefined, { ...rest, path: `/ops/${this.opIndex}${path ?? ""}` });
    }
    if (writesPrefabs(op, entry.kind)) {
      const judged = this.env.prefabEdit
        ? this.env.prefabEdit(op, { entry, index: this.opIndex })
        : makeIssue("op-invalid", {
            message: `"${entry.id}": scene ops that write prefabs (${PREFAB_SCENE_OPS.join(", ")}, or any op on a prefab) need the project`,
            entityIds: [entry.id],
          });
      if (judged) {
        const { code, message, ...rest } = judged;
        this.fail(code, message, "ops", rest);
      }
      this.delegated.push(this.opIndex);
      this.deferred.push({
        entry,
        index: this.opIndex,
        ops: op.ops,
        prefabs: this.rewriting
          ? this.prefabsFor(entry)
          : this.env.prefabsFor?.(this.givenId(entry)),
        registry: this.judge,
      });
      return;
    }
    if (entry.kind !== SCENE_KIND_NAME)
      this.fail(
        "asset-kind",
        `"${entry.id}" is a ${entry.kind}, not a scene: use editAsset`,
        "id",
        { entityIds: [entry.id] },
      );
    const current = this.contentOf(entry, op.op) as SceneDefinition;
    let batch: OpBatch = { ops: op.ops };
    if (usesBulkRefs(batch)) batch = { ...batch, base: sceneHash(current) };
    const prefabs = this.prefabsFor(entry);
    const registry = this.judge;
    const result = applyOps(current, batch, registry, prefabs ? { prefabs } : {});
    if (!result.ok) {
      const { code, message, path, ...rest } = result.issue;
      this.fail(code, message, undefined, {
        ...rest,
        path: `${jsonPointer(["ops", this.opIndex])}${path ?? ""}`,
        entityIds: rest.entityIds.length > 0 ? rest.entityIds : [entry.id],
      });
    }
    this.warnings.push(...result.issues);
    this.wrote(entry.key, result.def);
    const write = this.scenes.get(entry.key);
    this.scenes.set(entry.key, {
      ops: [...(write?.ops ?? []), ...op.ops],
      registry,
      ...(prefabs ? { prefabs } : {}),
    });
  }

  /**
   * Replays the delegated `editScene`s the way `applyProjectBatch` writes
   * them: after every other write, in op order, each one's ops on what the
   * batch left its scene or prefab, against the prefab library the earlier
   * delegated ops leave. Fails an op whose ops don't apply there, or that
   * defines or changes a prefab an earlier op removed (the prefab writer
   * would patch a trashed doc). Records what they leave each scene and
   * prefab, and each prefab they remove, for `trashedInUse`. A scene whose
   * value wasn't given can't be replayed: its removed prefabs are still
   * judged, against every referrer but that scene, and it is refused when
   * an earlier op changes the library it would read, or when a later
   * op's library would depend on what it does.
   */
  settleDelegated(): void {
    const removedAt = new Map(this.deletedAt);
    /** What the delegated ops so far did to the library, by id; null for a removal. */
    const changes = new Map<AssetId, Prefab | null>();
    /** The first unread op that changed prefabs in a way the check can't follow. */
    let unknownBy: number | undefined;
    for (const d of this.deferred) {
      this.opIndex = d.index;
      const earlier = (id: AssetId) => {
        const at = removedAt.get(id);
        if (at === undefined || at >= d.index) return;
        this.fail(
          "op-invalid",
          `prefab "${id}" is removed by op ${at} of this batch, so a later op can't define or change it; do both in one editScene, or in batches of their own`,
          "ops",
          { entityIds: [id] },
        );
      };
      const unjudged = (why: string) =>
        this.fail(
          "op-invalid",
          `"${d.entry.id}" can't be judged with the batch: ${why}; apply them in batches of their own`,
          "ops",
          { entityIds: [d.entry.id] },
        );
      if (unknownBy !== undefined)
        unjudged(
          `op ${unknownBy} changes prefabs in a way the check can't follow from what it was given`,
        );
      const library = withChanges(d.prefabs, changes);
      const key = d.entry.key;
      const isScene = d.entry.kind === SCENE_KIND_NAME;
      if (!isScene) earlier(d.entry.id);
      const known = this.leaves.has(key) ? this.leaves.get(key) : this.peek(d.entry);
      const ownPrefab = isScene ? undefined : isPrefab(known) ? known : library?.get(d.entry.id);
      const own = isScene
        ? (known as SceneDefinition | undefined)
        : ownPrefab && {
            ...prefabScene(ownPrefab, PREFAB_EDIT_BOUNDS),
            ...(ownPrefab.instances?.length ? { instances: cloneJson(ownPrefab.instances) } : {}),
          };
      if (own === undefined) {
        if (!isScene) {
          unknownBy ??= d.index;
          continue;
        }
        for (const op of d.ops)
          if ((op.op === "definePrefab" && op.prefab !== null) || op.op === "createPrefab")
            earlier(op.id);
        if (changes.size > 0)
          unjudged(
            "its content wasn't given, and earlier ops of this batch change prefabs it may read",
          );
        for (const op of d.ops) {
          if (op.op === "applyToPrefab" || op.op === "createPrefab") unknownBy ??= d.index;
          if (op.op !== "definePrefab") continue;
          if (op.prefab !== null) {
            const prev = library?.get(op.id);
            changes.set(op.id, prefabOf(op.id, op.prefab, prev?.game));
            continue;
          }
          changes.set(op.id, null);
          const prefab = this.view.byId.get(op.id);
          if (prefab?.kind !== PREFAB_KIND) continue;
          this.trashing.set(op.id, {
            entry: prefab,
            index: d.index,
            by: "editScene",
            unread: d.entry.id,
          });
          removedAt.set(op.id, d.index);
        }
        continue;
      }
      const split = splitHeaderOps(d.ops);
      let batch: OpBatch = { ops: split.body };
      if (usesBulkRefs(batch)) batch = { ...batch, base: sceneHash(own) };
      const applied = applyOps(own, batch, d.registry, {
        ...(library ? { prefabs: library } : {}),
        ...(isScene ? {} : { prefab: d.entry.id }),
        validate: "none",
      });
      const result = applied.ok ? applied : remapBodyFailure(applied, split.at);
      if (!result.ok) {
        const { code, message, path, ...rest } = result.issue;
        const renamed =
          code === "prefab-unknown" && [...this.prefabIds.values()].some((to) => to === rest.got);
        this.fail(
          renamed ? "op-invalid" : code,
          renamed
            ? `prefab "${String(rest.got)}" is a new id this batch gives a prefab, and ops that write prefabs see it only once the batch is written; do them in a batch of their own`
            : message,
          undefined,
          {
            ...rest,
            path: `${jsonPointer(["ops", d.index])}${path ?? ""}`,
            entityIds: rest.entityIds.length > 0 ? rest.entityIds : [d.entry.id],
          },
        );
      }
      if (ownPrefab) {
        if (result.def.entities?.some((e) => e.group !== undefined))
          this.fail(
            "op-invalid",
            `"${d.entry.id}": a prefab's children can't join a group; an instance takes its group`,
            "ops",
            { entityIds: [d.entry.id] },
          );
        const {
          entities: _e,
          bulk: _b,
          instances: _i,
          base: _base,
          params: _params,
          contract,
          ...head
        } = ownPrefab;
        const nested = result.def.instances?.length ? { instances: result.def.instances } : {};
        const headed = applyHeaderOps(
          { ...ownPrefab, ...nested },
          split.header,
          this.withRenamed(library) ?? new Map(),
          d.registry,
        );
        if (!headed.ok) {
          const { code, message, path, ...rest } = headed.issue;
          this.fail(code, message, undefined, {
            ...rest,
            path: `${jsonPointer(["ops", d.index])}${path ?? ""}`,
            entityIds: rest.entityIds.length > 0 ? rest.entityIds : [d.entry.id],
          });
        }
        const next: Prefab = {
          ...head,
          ...headed.header,
          ...sceneBody(result.def, d.registry, contract),
          ...(result.def.instances?.length ? { instances: result.def.instances } : {}),
        };
        this.leaves.set(key, next);
        changes.set(d.entry.id, next);
      } else this.leaves.set(key, result.def);
      if (!result.prefabsChanged || !result.prefabs) continue;
      for (const id of result.prefabsChanged) {
        const prefab = this.view.byId.get(id);
        const next = result.prefabs.get(id);
        if (next) {
          earlier(id);
          changes.set(id, next);
          if (prefab?.kind === PREFAB_KIND) this.leaves.set(prefab.key, next);
        } else if (library?.has(id)) {
          changes.set(id, null);
          if (prefab?.kind !== PREFAB_KIND) continue;
          this.trashing.set(id, { entry: prefab, index: d.index, by: "editScene" });
          removedAt.set(id, d.index);
        }
      }
    }
  }

  /** The prefabs a scene's instances resolve against, with each prefab this batch renamed also under its new id. */
  private prefabsFor(scene: AssetEntry): PrefabLibrary | undefined {
    return this.withRenamed(this.env.prefabsFor?.(this.givenId(scene)));
  }

  /** `given` with each prefab this batch renamed also under its new id. */
  private withRenamed(given: PrefabLibrary | undefined): PrefabLibrary | undefined {
    if (this.prefabIds.size === 0) return given;
    const library = new Map(given ?? []);
    for (const [from, to] of this.prefabIds) {
      if (library.has(to)) continue;
      const renamed = this.view.byId.get(to);
      const own = renamed ? this.peek(renamed) : undefined;
      const prefab = library.get(from) ?? (isPrefab(own) ? own : undefined);
      if (prefab) library.set(to, { ...prefab, id: to });
    }
    return library;
  }

  private createAsset(op: Extract<ProjectOp, { op: "createAsset" }>): void {
    const def = this.kind(op.kind);
    if (def.storage !== "doc")
      this.fail(
        "asset-kind",
        def.storage === "blob"
          ? `${def.kind} is a binary kind: upload the bytes and use importAsset`
          : `${def.kind} is code, which lives in git and is never created by an op`,
        "kind",
        { got: def.kind },
      );
    const doc = def as DocKindDef;
    const env = this.kindEnv();
    if (op.content !== undefined && !isPlainObject(op.content))
      this.fail("op-invalid", "content must be a JSON object, as the kind's file is", "content");
    const declared = doc.idField && isPlainObject(op.content) ? op.content[doc.idField] : undefined;

    let path = op.path;
    let id: AssetId;
    if (path === "" || path.endsWith("/")) {
      const folder = path === "" ? normalFolder(doc.defaultFolder?.(env) ?? "") : path;
      this.checkFolder(folder, "path");
      id = op.id ?? (typeof declared === "string" ? declared : this.generatedId(doc));
      path = `${folder}${id}${defaultExtension(doc)}`;
    } else {
      const fromPath = assetIdOfPath(path);
      const fallback = typeof declared === "string" ? declared : fromPath;
      if (op.id === undefined && fallback === null)
        this.fail("op-invalid", `"${fileNameOf(path)}" gives no asset id; pass one as id`, "id");
      id = op.id ?? fallback!;
    }
    this.checkId(id, "id");

    const value = cloneJson(op.content) ?? doc.empty(env, { id });
    if (doc.idField && isPlainObject(value)) {
      const own = value[doc.idField];
      if (own === undefined) value[doc.idField] = id;
      else if (own !== id)
        this.fail(
          "op-invalid",
          `the content's ${doc.idField} ${JSON.stringify(own)} differs from the asset id "${id}"`,
          "content",
        );
    }
    this.checkPath(path, "path");
    this.checkFits(doc, path, value, "path");
    this.checkSingle(doc.kind, "kind");

    const parsed = parseAssetDoc(doc, value, env);
    const inContent = (issue: SceneIssue): SceneIssue => ({
      ...issue,
      path: `${jsonPointer(["ops", this.opIndex, "content"])}${issue.path ?? ""}`,
      entityIds: [id],
    });
    if (!parsed.ok) {
      const first = parsed.issues.find((i) => i.severity === "error") ?? parsed.issues[0]!;
      this.fail(first.code, first.message, undefined, inContent(first));
    }
    this.warnings.push(...parsed.issues.map(inContent));

    const key = this.newKey();
    this.put(
      withOptional(
        { key, id, kind: doc.kind, path, created: this.stamp() },
        { licence: op.licence },
      ),
    );
    this.wrote(key, parsed.value);
    this.created.push(id);
  }

  private importAsset(op: Extract<ProjectOp, { op: "importAsset" }>): void {
    const def =
      op.kind !== undefined
        ? this.kind(op.kind)
        : (this.env.kinds.detect(op.path) ??
          this.fail(
            "asset-kind",
            `"${fileNameOf(op.path)}" doesn't match any binary kind's suffix; pass kind`,
            "path",
            { got: op.path },
          ));
    if (def.storage !== "blob")
      this.fail("asset-kind", `${def.kind} isn't a binary kind: use createAsset`, "kind", {
        got: def.kind,
      });
    const blob = def as BlobKindDef;
    const id = op.id ?? assetIdOfPath(op.path);
    if (id === null)
      this.fail("op-invalid", `"${fileNameOf(op.path)}" gives no asset id; pass one as id`, "id");
    this.checkId(id, "id");
    this.checkPath(op.path, "path");
    this.checkFits(blob, op.path, undefined, "path");
    this.checkSize(blob, op.bytes);
    const settings = this.settings(blob, {}, op.settings ?? {}, "settings");

    const key = this.newKey();
    let entry: AssetEntry = withOptional(
      {
        key,
        id,
        kind: blob.kind,
        path: op.path,
        sha256: op.sha256,
        bytes: op.bytes,
        created: this.stamp(),
      },
      { import: settings, licence: op.licence },
    );
    entry = this.inspected(blob, entry, true);
    this.put(entry);
    this.appendHistory(key, []);
    this.created.push(id);
  }

  private renameAsset(op: Extract<ProjectOp, { op: "renameAsset" }>): void {
    const entry = this.live(op.id);
    if (op.name === undefined && op.file === undefined)
      this.fail("op-invalid", "renameAsset needs a name, a file, or both", undefined);
    let next: AssetEntry = { ...entry };
    if (op.name === null) delete next.name;
    else if (op.name !== undefined) next.name = op.name;
    if (op.file !== undefined) {
      if (op.file.includes("/"))
        this.fail(
          "op-invalid",
          `"${op.file}" is a file name; use moveAsset to change folders`,
          "file",
        );
      const path = `${folderPrefixOf(entry.path)}${op.file}`;
      if (path !== entry.path) {
        this.checkPath(path, "file", entry.key);
        this.checkFits(this.kind(entry.kind, "id"), path, this.peek(entry), "file");
        next = { ...next, path };
      }
    }
    const checks = checksBeside(this.view, entry);
    this.put(next);
    if (checks) this.follow(checks, checksPathOf(next.path), "file");
  }

  private moveAsset(op: Extract<ProjectOp, { op: "moveAsset" }>): void {
    this.checkFolder(op.to, "to");
    op.ids.forEach((id, i) => {
      const entry = this.live(id, ["ids", i]);
      const path = `${op.to}${fileNameOf(entry.path)}`;
      if (path === entry.path) return;
      this.checkPath(path, "to", entry.key);
      const checks = checksBeside(this.view, entry);
      this.put({ ...entry, path });
      if (checks) this.follow(checks, checksPathOf(path), "to");
    });
  }

  /** A scene's checks file to `path` beside the scene's new one, in the same op. */
  private follow(checks: AssetEntry, path: AssetPath, field: Field): void {
    if (path === checks.path) return;
    this.checkPath(path, field, checks.key);
    this.put({ ...checks, path });
  }

  /**
   * The checks file left beside a trashed scene's path, while no live scene
   * has taken that path since.
   */
  private besideTrashed(entry: AssetEntry): AssetId[] {
    if (this.view.byPath.get(entry.path)?.kind === entry.kind) return [];
    const checks = checksBeside(this.view, entry);
    return checks ? [checks.id] : [];
  }

  /** The other live assets' sites that name `entry` as a kind it is, by referrer id, in id order. */
  private namedBy(entry: AssetEntry): Map<AssetId, RefSite[]> {
    return namedBy(this.refIndex(), entry);
  }

  /**
   * Refused while another live asset names it (`detail.referrers`) once the
   * whole batch has run, unless `force`.
   */
  private deleteAsset(op: Extract<ProjectOp, { op: "deleteAsset" }>): void {
    const entry = this.live(op.id);
    if (!op.force) this.trashing.set(entry.id, { entry, index: this.opIndex, by: "deleteAsset" });
    else if (inUseIssue(this.refIndex(), entry)) this.forced.add(op.id);
    this.deletedAt.set(entry.id, this.opIndex);
    this.put({ ...entry, deleted: this.stamp() });
  }

  /**
   * The entry's id, the asset's own id field, then every referrer: a doc's
   * value through `editAsset` (or, for a scene, `update` scene ops; for a
   * prefab, an `editScene` the prefab writer judges), a binary's import
   * settings. Needs the content of every live doc that can hold a
   * reference. A referrer that can't take the new id fails the op.
   */
  private changeAssetId(op: Extract<ProjectOp, { op: "changeAssetId" }>): void {
    const entry = this.live(op.id);
    const { id: from, to } = op;
    if (to === from) this.fail("op-invalid", `"${from}" already has the id "${to}"`, "to");
    this.checkId(to, "to", entry.key);
    const def = this.kind(entry.kind, "id");
    for (const e of this.view.byId.values()) {
      const kind = this.env.kinds.get(e.kind);
      if (kind?.storage === "doc" && kind.refs && this.peek(e) === undefined)
        this.fail(
          "op-invalid",
          `changeAssetId rewrites every reference to "${from}", so it needs the content of every doc that can hold one; "${e.id}"'s wasn't given`,
          "id",
          { entityIds: [e.id] },
        );
    }
    const sitesBy = this.namedBy(entry);
    const prior = { registry: this.settled, values: new Map<AssetKey, unknown>() };
    for (const e of this.view.byId.values())
      if (isCustomDoc(this.env.kinds.get(e.kind))) prior.values.set(e.key, this.peek(e));

    const own = def.storage === "doc" && def.idField ? this.contentOf(entry, op.op) : undefined;
    this.put({ ...entry, id: to });
    if (def.storage === "doc" && def.idField && isPlainObject(own))
      this.wrote(entry.key, { ...own, [def.idField]: to });
    if (entry.kind === PREFAB_KIND) this.prefabIds.set(from, to);
    if (entry.kind === MATERIAL_KIND && this.judge.materials.has(from)) {
      this.materialIds.set(from, to);
      this.registryCache = null;
      this.settledCache = null;
    }

    const rewritten = new Map<AssetKey, unknown>();
    for (const [referrer, sites] of sitesBy) {
      const current = this.view.byId.get(referrer)!;
      this.asReferrer(current, from, to, () => {
        const next = this.rewriteReferrer(current, sites, from, to);
        if (next !== undefined) rewritten.set(current.key, next);
      });
    }

    // Scenes and prefabs are read with the registry: a rewritten one, and every one when a
    // material changed id, must still read as a file if it did before.
    const materialMoved = this.materialIds.get(from) === to;
    for (const e of this.view.byId.values()) {
      const kind = this.env.kinds.get(e.kind);
      if (!isCustomDoc(kind) || (!rewritten.has(e.key) && !materialMoved)) continue;
      const value = rewritten.get(e.key) ?? this.peek(e);
      if (value === undefined) continue;
      const after = readsAsFile(kind, value, { registry: this.settled, project: this.view });
      if (after === null) continue;
      const before = prior.values.get(e.key);
      const priorEnv = { registry: prior.registry, project: this.view };
      if (before === undefined || readsAsFile(kind, before, priorEnv) !== null) continue;
      this.asReferrer(e, from, to, () =>
        this.fail(after.code, `it wouldn't read afterwards: ${after.message}`, "id", {
          got: after.path ?? "",
        }),
      );
    }
  }

  /** Runs one referrer's part of a changeAssetId; its failure fails the op, naming the referrer. */
  private asReferrer(entry: AssetEntry, from: AssetId, to: AssetId, part: () => void): void {
    try {
      part();
    } catch (error) {
      if (!(error instanceof OpFailure)) throw error;
      const { code, message, path: _path, ...rest } = error.issue;
      this.fail(code, `"${entry.id}" can't follow "${from}" to "${to}": ${message}`, "to", {
        ...rest,
        entityIds: [entry.id],
        detail: { ...rest.detail, referrer: entry.id },
      });
    }
  }

  /** Points one referrer's sites at `to`; a scene's or prefab's value as rewritten, for reading back. */
  private rewriteReferrer(
    entry: AssetEntry,
    sites: readonly RefSite[],
    from: AssetId,
    to: AssetId,
  ): unknown {
    const def = this.kind(entry.kind, "id");
    if (def.storage === "blob") {
      const derived = sites.find((s) => !s.pointer.startsWith("/import/"));
      if (derived)
        this.fail(
          "asset-kind",
          `it's a ${def.kind}, whose bytes name "${from}" (${derived.pointer}); replace or re-record it instead`,
          "id",
        );
      const next = rewriteRefs(entry, sites, from, to);
      this.mustFollow(next, sites);
      this.settings(def as BlobKindDef, {}, next.import ?? {}, "to");
      this.put(next);
      return undefined;
    }
    if (def.storage !== "doc") return undefined;
    const doc = def as DocKindDef;
    const value = this.contentOf(entry, "changeAssetId");
    if (doc.layout !== "custom") {
      const layout = doc.layout;
      const next = rewriteRefs(value, sites, from, to, layout);
      this.mustFollow(next, sites, layout);
      const edits: JsonEdit[] = [];
      for (const site of sites) {
        const at = settablePointer(value, layout, holderPointer(site));
        if (edits.some((e) => "set" in e && e.set === at)) continue;
        const read = readPointer(next, layout, at);
        if (!read.ok) this.fail(read.issue.code, read.issue.message, "id");
        edits.push({ set: at, value: read.value });
      }
      this.editAsset({ op: "editAsset", id: entry.id, edits });
      return undefined;
    }
    const next = rewriteRefs(value, sites, from, to);
    this.mustFollow(next, sites);
    const ops = sceneRewrites(value, sites, to, this.judge);
    if (typeof ops === "string")
      this.fail("op-invalid", `the engine can't rewrite a reference at ${ops}`, "id");
    this.rewriting = true;
    try {
      this.editScene({ op: "editScene", id: entry.id, ops });
    } finally {
      this.rewriting = false;
    }
    return entry.kind === SCENE_KIND_NAME ? this.values.get(entry.key) : next;
  }

  /** Refuses a rewrite that left a site naming the old id, which a layout or pointer the engine can't follow would. */
  private mustFollow(next: unknown, sites: readonly RefSite[], layout?: DocLayout): void {
    const stuck = sites.find((site) => namesAt(next, site, layout));
    if (stuck)
      this.fail("op-invalid", `the engine can't rewrite the reference at ${stuck.pointer}`, "id", {
        got: stuck.pointer,
      });
  }

  private restoreAsset(op: Extract<ProjectOp, { op: "restoreAsset" }>): void {
    const trashed = this.view.deleted
      .filter((e) => e.id === op.id)
      .sort((a, b) => b.deleted!.at - a.deleted!.at || compareEntries(b, a))[0];
    if (!trashed) {
      if (this.view.byId.has(op.id))
        this.fail("op-invalid", `"${op.id}" isn't in the trash`, "id", { entityIds: [op.id] });
      const guess = closest(
        op.id,
        this.view.deleted.map((e) => e.id),
      );
      this.fail(
        "ref-not-found",
        `the trash holds no "${op.id}"${guess ? `; did you mean "${guess}"?` : ""}`,
        "id",
        { got: op.id },
      );
    }
    this.checkId(trashed.id, "id", trashed.key);
    this.checkPath(trashed.path, "id", trashed.key);
    this.checkSingle(trashed.kind, "id");
    const { deleted: _deleted, ...restored } = trashed;
    this.deletedAt.delete(restored.id);
    this.put(restored);
  }

  private setImport(op: Extract<ProjectOp, { op: "setImport" }>): void {
    const entry = this.live(op.id);
    const def = this.blob(entry);
    const settings = this.settings(def, entry.import ?? {}, op.set, "set");
    const next = withOptional({ ...entry }, { import: settings });
    if (!settings) delete next.import;
    this.put(
      sameValue(entry.import ?? {}, settings ?? {}) ? entry : this.inspected(def, next, false),
    );
  }

  private replaceContent(op: Extract<ProjectOp, { op: "replaceContent" }>): void {
    const entry = this.live(op.id);
    const def = this.blob(entry);
    if (IMMUTABLE_KINDS.includes(def.kind))
      this.fail("asset-kind", `"${entry.id}" is a ${def.kind}: it never changes`, "id", {
        entityIds: [entry.id],
      });
    this.checkSize(def, op.bytes);
    if (entry.sha256 === op.sha256) return;
    const previous =
      entry.sha256 === undefined ? null : { sha256: entry.sha256, bytes: entry.bytes ?? 0 };
    const items = replacementHistory(
      this.history[entry.key] ?? [],
      previous,
      { sha256: op.sha256, bytes: op.bytes },
      { at: this.env.now, by: this.env.by },
    );
    this.put(this.inspected(def, { ...entry, sha256: op.sha256, bytes: op.bytes }, true));
    this.appendHistory(entry.key, items);
  }

  private setLicence(op: Extract<ProjectOp, { op: "setLicence" }>): void {
    const entry = this.live(op.id);
    const next = { ...entry };
    if (op.licence === null || Object.keys(op.licence).length === 0) delete next.licence;
    else next.licence = { ...op.licence };
    this.put(next);
  }

  /** A project has at most one game-settings asset. */
  private checkSingle(kind: AssetKindName, field: Field): void {
    if (kind !== GAME_SETTINGS_KIND) return;
    const [held] = gameSettingsEntries(this.view);
    if (held)
      this.fail(
        "asset-kind",
        `the project already has its game settings, "${held.id}" (${held.path}); a project has at most one`,
        field,
        { entityIds: [held.id], got: kind },
      );
  }

  private checkFolder(folder: string, field: string): void {
    if (folder === "") return;
    if (!folder.endsWith("/"))
      this.fail("op-invalid", `"${folder}" isn't a folder: end it with "/"`, field, {
        got: folder,
      });
    const problem = assetPathProblem(folder.slice(0, -1));
    if (problem) this.fail("op-invalid", `"${folder}": ${problem}`, field, { got: folder });
  }

  private checkSize(def: BlobKindDef, bytes: number): void {
    if (bytes > def.maxBytes)
      this.fail(
        "asset-too-large",
        `${bytes} bytes is more than a ${def.kind} may hold (${def.maxBytes})`,
        "bytes",
        { got: String(bytes), expected: `at most ${def.maxBytes}` },
      );
  }

  /** `base` with `set` merged in (null removes a key), judged by the kind's settings schema; undefined when empty. */
  private settings(
    def: BlobKindDef,
    base: Record<string, unknown>,
    set: Record<string, unknown>,
    field: string,
  ): Record<string, unknown> | undefined {
    const next: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(set)) {
      if (v === null) delete next[k];
      else next[k] = cloneJson(v);
    }
    const parsed = def.settings.safeParse(next);
    if (!parsed.success) {
      const first = parsed.error.issues[0]!;
      const at = first.path.filter((p): p is string | number => typeof p !== "symbol");
      this.fail(
        "op-invalid",
        `${def.kind} import settings: ${jsonPointer(at) || "/"}: ${first.message}`,
        field,
      );
    }
    return Object.keys(next).length > 0 ? next : undefined;
  }

  private generatedId(def: DocKindDef): AssetId {
    const base = def.kind.slice(def.kind.indexOf("/") + 1);
    for (let n = 1; ; n++) {
      const id = `${base}-${n}`;
      if (!this.view.byId.has(id)) return id;
    }
  }
}

const isCustomDoc = (def: AssetKindDef | undefined): def is DocKindDef =>
  def?.storage === "doc" && def.layout === "custom";

/** Why `value` written as its kind's file wouldn't read back under `env`; null when it would. */
function readsAsFile(def: DocKindDef, value: unknown, env: KindEnv): SceneIssue | null {
  const parsed = parseAssetDoc(def, def.format ? def.format(value) : value, env);
  if (parsed.ok) return null;
  return parsed.issues.find((i) => i.severity === "error") ?? parsed.issues[0] ?? null;
}

const normalFolder = (folder: string) =>
  folder === "" || folder.endsWith("/") ? folder : `${folder}/`;

const defaultExtension = (def: AssetKindDef) => def.match.suffixes?.[0] ?? ".json";

/** `entry` with each defined value of `extra` set. */
function withOptional(
  entry: AssetEntry,
  extra: { import?: Record<string, unknown>; licence?: Licence },
): AssetEntry {
  const out = { ...entry };
  if (extra.import !== undefined) out.import = extra.import;
  if (extra.licence !== undefined && Object.keys(extra.licence).length > 0)
    out.licence = { ...extra.licence };
  return out;
}

const isPrefab = (v: unknown): v is Prefab =>
  isPlainObject(v) && v.kind === PREFAB_KIND && Array.isArray(v.entities);

/** Where a prefab's children are replayed as a scene; the replay never validates, so only its shape matters. */
const PREFAB_EDIT_BOUNDS: SceneDefinition["bounds"] = [-1e6, -1e6, 1e6, 1e6];

/** `library` with `changes` laid over it (null removes an id); `library` itself when nothing changed. */
function withChanges(
  library: PrefabLibrary | undefined,
  changes: ReadonlyMap<AssetId, Prefab | null>,
): PrefabLibrary | undefined {
  if (changes.size === 0) return library;
  const out = new Map(library ?? []);
  for (const [id, prefab] of changes) {
    if (prefab) out.set(id, { ...prefab, id });
    else out.delete(id);
  }
  return out;
}

/**
 * `registry` with each material in `ids` (old → new, in the order given)
 * under its new id, and under its old one too while `keepOld`. A game's
 * code material of an old name comes back once the asset leaves it.
 */
function withMaterialIds(
  registry: Registry,
  ids: ReadonlyMap<AssetId, AssetId>,
  keepOld: boolean,
): Registry {
  const defs = new Map(registry.materials);
  for (const [from, to] of ids) {
    const def = defs.get(from);
    if (def && !defs.has(to)) defs.set(to, def);
    if (!keepOld) defs.delete(from);
  }
  const materials: Record<string, ProjectMaterialDef> = {};
  for (const [name, { friction, restitution, impulse, description, style }] of defs)
    materials[name] = {
      description,
      physics: { friction, restitution, ...(impulse ? { impulse } : {}) },
      ...(style ? { style } : {}),
    };
  return createRegistry(registry.game, { materials });
}

/** The deepest pointer at or above `pointer` that a `set` edit may address under `layout`. */
function settablePointer(value: unknown, layout: DocLayout, pointer: JsonPointer): JsonPointer {
  const tokens = parseJsonPointer(pointer) ?? [];
  for (let n = tokens.length; n > 0; n--) {
    const at = jsonPointer(tokens.slice(0, n));
    if (readPointer(value, layout, at).ok) return at;
  }
  return "";
}

/** Where a site's rewrite is written: a key site's object, else the site itself. */
function holderPointer(site: RefSite): JsonPointer {
  return site.in === "key" ? jsonPointer(pointerSegments(site.pointer).slice(0, -1)) : site.pointer;
}

/**
 * Scene ops that point a scene's or prefab's sites at `to`: `update` of
 * an entity's or instance's field, `override` of an instance's override,
 * and for a bulk key (`/solid:from`, a prefab's `/bulk/solid:from`) its
 * entries added under the new key and removed from the old. The first
 * pointer none of those reach, when there is one.
 */
function sceneRewrites(
  value: unknown,
  sites: readonly RefSite[],
  to: AssetId,
  registry: Registry,
): SceneOp[] | JsonPointer {
  const updates = new Map<string, Record<string, unknown>>();
  const overrides = new Map<string, Record<string, unknown>>();
  const bulk: SceneOp[] = [];
  const removed: string[] = [];
  const settings: Record<string, unknown> = {};
  const header = new Set<string>();
  let base = false;
  const into = (map: Map<string, Record<string, unknown>>, ref: string, key: string) => {
    const set = map.get(ref) ?? {};
    set[key] = to;
    map.set(ref, set);
  };
  for (const site of sites) {
    const segments = pointerSegments(site.pointer);
    if (site.in === "key") {
      const [key, ...extra] = segments[0] === "bulk" ? segments.slice(1) : segments;
      const holder = segments[0] === "bulk" && isPlainObject(value) ? value.bulk : value;
      const entries = isPlainObject(holder) && key !== undefined ? holder[key] : undefined;
      const form = key && registry.types.get(bulkKeyType(key))?.bulk?.form;
      if (!key || extra.length > 0 || !Array.isArray(entries) || !form) return site.pointer;
      const next = `${key.slice(0, -site.id.length)}${to}`;
      bulk.push(
        form === "point"
          ? { op: "addBulk", key: next, points: entries as Pt[] }
          : { op: "addBulk", key: next, shapes: entries as ShapeTuple[] },
      );
      removed.push(...entries.map((_, i) => bulkId(key, i)));
      continue;
    }
    if (segments[0] === "settings" && segments.length > 1) {
      settings[segments.slice(1).join(".")] = to;
      continue;
    }
    if (segments[0] === "assets" && segments.length === 2) {
      header.add(site.id);
      continue;
    }
    if (segments.length === 1 && segments[0] === "base") {
      base = true;
      continue;
    }
    const [list, item, ...field] = segments;
    if ((list !== "entities" && list !== "instances") || !item?.startsWith("@") || !field.length)
      return site.pointer;
    if (list === "instances" && field[0] === "overrides" && field.length === 2)
      into(overrides, item.slice(1), field[1]!);
    else into(updates, item.slice(1), field.join("."));
  }
  return [
    ...[...updates].map(([ref, set]): SceneOp => ({ op: "update", ref, set })),
    ...[...overrides].map(([ref, set]): SceneOp => ({ op: "override", ref, set })),
    ...(Object.keys(settings).length > 0
      ? [{ op: "setSettings", set: settings } satisfies SceneOp]
      : []),
    ...(header.size > 0
      ? [{ op: "useAssets", add: [to], remove: [...header] } satisfies SceneOp]
      : []),
    ...(base ? [{ op: "setPrefabBase", base: to } satisfies SceneOp] : []),
    ...bulk,
    ...(removed.length > 0 ? [{ op: "remove", refs: removed } satisfies SceneOp] : []),
  ];
}

/**
 * Checks a whole batch against plain JSON: the project state and the
 * current values of the docs it touches (by asset id). A failing op means
 * nothing anywhere is written. `editAsset` applies its edits through the
 * kind's layout and judges the result by the kind's schema; `editScene`
 * runs `applyOps` on a scene and hands ops that write prefabs to
 * `env.prefabEdit`. `deleteAsset` without `force`, and an `editScene` whose
 * `definePrefab` null removes a prefab, are refused with `asset-in-use`
 * while a live asset among those given still names the asset once the
 * whole batch has run; a scene's checks file (`<stem>.checks.json` beside
 * it) counts as naming it, and follows it through `moveAsset` and
 * `renameAsset`. `changeAssetId`
 * rewrites every referrer (see `BatchWork.changeAssetId`), so it needs
 * every live doc that can hold a reference.
 */
export function checkProjectBatch(
  state: ProjectState,
  docs: ReadonlyMap<AssetId, unknown>,
  batch: ProjectOpBatch,
  env: ProjectBatchEnv,
): ProjectBatchCheck {
  const parsed = projectOpBatchSchema.safeParse(batch);
  if (!parsed.success) return schemaFailure(parsed.error, batch);
  const work = new BatchWork(state, docs, env);
  for (const [index, op] of batch.ops.entries()) {
    try {
      work.run(op, index);
    } catch (error) {
      if (error instanceof OpFailure) return { ok: false, opIndex: index, issue: error.issue };
      throw error;
    }
  }
  try {
    work.settleDelegated();
  } catch (error) {
    if (error instanceof OpFailure)
      return { ok: false, opIndex: work.failedAt, issue: error.issue };
    throw error;
  }
  const inUse = work.trashedInUse();
  if (inUse) return { ok: false, ...inUse };
  const missing =
    work.forced.size > 0
      ? work
          .refIndex()
          .dangling()
          .filter((issue) => issue.got !== undefined && work.forced.has(issue.got))
      : [];
  return {
    ok: true,
    state: work.current(),
    values: work.values,
    registry: work.registry,
    written: work.written,
    writtenBy: work.writtenBy,
    scenes: work.scenes,
    created: work.created,
    issues: [...work.view.issues, ...work.warnings, ...missing, ...work.tableIssues()],
    delegated: work.delegated,
  };
}
