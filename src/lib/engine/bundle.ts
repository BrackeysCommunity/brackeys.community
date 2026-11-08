/**
 * The server side of `project push --create` and `project pull`: a
 * `ProjectBundle` becomes a hosted project's rows, and a hosted project
 * reads back as doc states and blob hashes. The registry is seeded here
 * with `seedProjectState`, the seeding `canvas-sync` uses; scene and asset
 * docs get their file text as `seed`, which the service lays out on first
 * load. The client converts states back into files (it has the game code).
 */
import { matchesGlob } from "node:path";

import {
  assetFileEntries,
  assetPathProblem,
  byCodeUnit,
  isSha256,
  orphanSidecarIssue,
  ownAssetId,
  parseProjectFile,
  parseSidecar,
  projectPathMatcher,
  projectView,
  SCENE_KIND_NAME,
  sidecarPathOf,
  UNLIMITED_QUOTA,
  type AssetEntry,
  type AssetFile,
  type AssetKey,
  type AssetKindName,
  type AssetPath,
  type AssetSidecar,
  type CodeModuleInfo,
  type ContentStore,
  type KindEnv,
  type KindRegistry,
  type ProjectBundle,
  type ProjectFile,
  type ProjectId,
  type ProjectState,
  type QuotaPolicy,
  type Sha256,
} from "@jams/engine/project";
import {
  createRegistry,
  ID_PATTERN,
  makeIssue,
  type Registry,
  type SceneIssue,
} from "@jams/engine/scene";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { engineAssetDocs, engineBlobs, engineProjects, sceneDocs } from "@/db/schema";
import { seedDefinition } from "@/lib/scene/doc-bytes";
import { ASSET_DOC_LIMITS, PROJECT_DOC_LIMITS, SCENE_LIMITS } from "@/lib/scene/limits";
import {
  AssetSeedError,
  declarativeKind,
  emptyProjectState,
  ENGINE_KINDS,
  projectSeeded,
  seedAssetState,
  seedProjectState,
} from "@/lib/scene/project-bytes";

import { checkQuota, storedProjectUsage, type QuotaExceeded } from "./quota";

/** What is wrong with one file of a bundle (or the bundle itself, at path ""). */
export type BundleProblem = { path: AssetPath; issues: SceneIssue[] };

/** A doc a bundle seeds: a scene (`scene_docs`) or any other doc kind (`engine_asset_docs`). */
export type BundleDoc = {
  prefix: "scene" | "asset";
  key: AssetKey;
  kind: AssetKindName;
  path: AssetPath;
  seed: string;
};

export type BundleOptions = {
  /** The kinds files are detected and seeded by; the engine's by default, as the service has. */
  kinds?: KindRegistry;
  registry?: Registry;
  /** The project's code map, as the pushing client computed it from the game. */
  code?: Readonly<Record<string, CodeModuleInfo>>;
};

/** The stamp every entry seeded from files carries, as the dev server's scan gives it. */
const SEEDED = { at: 0, by: "disk" } as const;

const PROJECT_PATH = "jams.project.json";
const encoder = new TextEncoder();

const bundleShape = z.strictObject({
  project: z.unknown(),
  texts: z.record(z.string(), z.string()),
  blobs: z.record(z.string(), z.string()),
  sidecars: z.record(z.string(), z.string()),
});

const codeShape = z.record(
  z.string(),
  z.strictObject({
    registers: z.strictObject({
      types: z.array(z.string()).optional(),
      kinds: z.array(z.string()).optional(),
      tables: z.array(z.string()).optional(),
      materials: z.array(z.string()).optional(),
    }),
  }),
);

const problem = (
  path: AssetPath,
  code: Parameters<typeof makeIssue>[0],
  message: string,
  got?: string,
): BundleProblem => ({
  path,
  issues: [makeIssue(code, { message, path: "", ...(got !== undefined ? { got } : {}) })],
});

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export type ParseBundleResult =
  | { ok: true; bundle: ProjectBundle & { project: ProjectFile } }
  | { ok: false; problems: BundleProblem[] };

/** A bundle's shape and project file; what its files hold is judged by `bundleProjectState`. Never throws. */
export function parseProjectBundle(input: unknown): ParseBundleResult {
  const shape = bundleShape.safeParse(input);
  if (!shape.success)
    return {
      ok: false,
      problems: [
        problem(
          "",
          "schema",
          `not a project bundle: ${shape.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
        ),
      ],
    };
  const file = parseProjectFile(shape.data.project);
  if (!file.ok) return { ok: false, problems: [{ path: PROJECT_PATH, issues: file.issues }] };
  return { ok: true, bundle: { ...shape.data, project: file.file } };
}

export type BundleStateResult =
  | {
      ok: true;
      state: ProjectState;
      docs: BundleDoc[];
      /** Every blob hash the registry names, sorted. */
      blobs: Sha256[];
      /** What the dev server would also only report: a binary whose header doesn't read leaves its entry without meta. */
      warnings: BundleProblem[];
    }
  | { ok: false; problems: BundleProblem[] };

type Read = AssetFile & { text: string | null };

/**
 * The registry a bundle seeds, as the dev server's scan reads the same
 * files: kinds detected by path, JSON and sidecar; ids from the sidecar,
 * the kind's id field or the file name; keys from the sidecar or the id,
 * suffixed in path order when two collide; binaries inspected from the
 * bytes `store` holds, with the sidecar's settings, name and licence kept.
 * Deterministic: the same bundle and bytes give the same state. Refuses
 * what can't be hosted faithfully: bad paths and sidecars, files of no
 * kind, missing or oversized content, seeds the service can't lay out, and
 * ids or paths the registry would have to repair.
 */
export async function bundleProjectState(
  bundle: ProjectBundle,
  options: BundleOptions & { store: ContentStore },
): Promise<BundleStateResult> {
  const kinds = options.kinds ?? ENGINE_KINDS;
  const env: KindEnv = { registry: options.registry ?? createRegistry(null), project: null };
  const file = bundle.project;
  const { isAsset } = projectPathMatcher(file, matchesGlob);

  const problems: BundleProblem[] = [];
  const warnings: BundleProblem[] = [];

  const sidecars = new Map<AssetPath, AssetSidecar>();
  for (const [path, text] of Object.entries(bundle.sidecars)) {
    if (!Object.hasOwn(bundle.texts, path) && !Object.hasOwn(bundle.blobs, path)) {
      problems.push({
        path: sidecarPathOf(path),
        issues: [orphanSidecarIssue(sidecarPathOf(path), path)],
      });
      continue;
    }
    const parsed = parseSidecar(text);
    if (parsed.ok) sidecars.set(path, parsed.sidecar);
    else problems.push({ path: sidecarPathOf(path), issues: parsed.issues });
  }

  const paths = [...new Set([...Object.keys(bundle.texts), ...Object.keys(bundle.blobs)])].sort(
    byCodeUnit,
  );
  const reads: Read[] = [];
  for (const path of paths) {
    const pathProblem = assetPathProblem(path);
    if (pathProblem) {
      problems.push(problem(path, "schema", `"${path}": ${pathProblem}`, path));
      continue;
    }
    if (Object.hasOwn(bundle.texts, path) && Object.hasOwn(bundle.blobs, path)) {
      problems.push(problem(path, "schema", `${path} is both a text file and a binary`));
      continue;
    }
    if (!isAsset(path)) {
      problems.push(
        problem(path, "schema", `${path} isn't under the project file's asset globs`, path),
      );
      continue;
    }
    const sidecar = sidecars.get(path) ?? null;
    const text = Object.hasOwn(bundle.texts, path) ? bundle.texts[path] : undefined;
    if (text !== undefined) {
      const json = path.toLowerCase().endsWith(".json") ? tryJson(text) : undefined;
      const def = kinds.detect(path, json, sidecar?.assetKind);
      if (def?.storage !== "doc") {
        problems.push(
          problem(
            path,
            "asset-kind",
            def
              ? `${path} is a ${def.kind} file, which isn't a text asset`
              : json === undefined && path.toLowerCase().endsWith(".json")
                ? `${path} isn't valid JSON, so its asset kind can't be told`
                : `${path} is of no asset kind this project registers`,
            sidecar?.assetKind,
          ),
        );
        continue;
      }
      const id = sidecar?.id ?? ownAssetId(def, path, json);
      if (id === null || !ID_PATTERN.test(id)) {
        problems.push(problem(path, "bad-id", `${path} gives no valid asset id`, id ?? undefined));
        continue;
      }
      reads.push({ path, def, id, sidecar, text, blob: null });
      continue;
    }
    const hash = bundle.blobs[path]!;
    const def = kinds.detect(path, undefined, sidecar?.assetKind);
    if (def?.storage !== "blob") {
      problems.push(
        problem(
          path,
          "asset-kind",
          def
            ? `${path} is a ${def.kind} file, which isn't a binary asset`
            : `${path} is of no asset kind this project registers`,
          sidecar?.assetKind,
        ),
      );
      continue;
    }
    if (!isSha256(hash)) {
      problems.push(problem(path, "hash-mismatch", `${path}'s hash isn't a SHA-256`, hash));
      continue;
    }
    const data = await options.store.get(hash);
    if (data === null) {
      problems.push(
        problem(path, "hash-mismatch", `${path}'s bytes (${hash}) aren't uploaded`, hash),
      );
      continue;
    }
    if (data.byteLength > def.maxBytes) {
      problems.push(
        problem(
          path,
          "asset-too-large",
          `${path} is ${data.byteLength} bytes, more than a ${def.kind} may hold (${def.maxBytes})`,
          String(data.byteLength),
        ),
      );
      continue;
    }
    const id = sidecar?.id ?? ownAssetId(def, path, undefined);
    if (id === null) {
      problems.push(
        problem(path, "bad-id", `${path} gives no asset id; give it a sidecar with one`),
      );
      continue;
    }
    reads.push({ path, def, id, sidecar, text: null, blob: { sha256: hash, data } });
  }

  const assets: Record<AssetKey, AssetEntry> = {};
  const docs: BundleDoc[] = [];
  const blobs = new Set<Sha256>();
  const keyed = assetFileEntries(reads, SEEDED).sort((a, b) => byCodeUnit(a.key, b.key));
  for (const { file: read, key, entry, issue } of keyed) {
    if (read.blob) {
      if (issue) warnings.push({ path: read.path, issues: [issue] });
      blobs.add(read.blob.sha256);
    } else {
      const seeded = seedProblem(file.id, key, read, kinds, env);
      if (seeded) {
        problems.push(seeded);
        continue;
      }
      docs.push({
        prefix: read.def.storage === "doc" && read.def.prefix === "scene" ? "scene" : "asset",
        key,
        kind: read.def.kind,
        path: read.path,
        seed: read.text!,
      });
    }
    assets[key] = entry;
  }

  const code: Record<string, CodeModuleInfo> = {};
  const codeRead = codeShape.safeParse(options.code ?? {});
  if (!codeRead.success)
    problems.push(problem("", "schema", `the code map isn't one: ${codeRead.error.message}`));
  else
    for (const [path, info] of Object.entries(codeRead.data).sort(([a], [b]) => byCodeUnit(a, b))) {
      const pathProblem = assetPathProblem(path);
      if (pathProblem) problems.push(problem(path, "schema", `"${path}": ${pathProblem}`, path));
      else code[path] = info;
    }

  const state: ProjectState = {
    ...emptyProjectState(file.id, file.name),
    assets,
    code,
  };
  const view = projectView(state, kinds);
  for (const issue of view.issues) {
    const key = issue.entityIds.find((k) => view.repairs.has(k)) ?? issue.entityIds[0];
    problems.push({ path: (key !== undefined && assets[key]?.path) || "", issues: [issue] });
  }
  const projectBytes = seedProjectState(state).byteLength;
  if (projectBytes > PROJECT_DOC_LIMITS.maxStateBytes)
    problems.push(
      problem(
        PROJECT_PATH,
        "asset-too-large",
        `the registry is ${projectBytes} bytes, more than a project doc may hold (${PROJECT_DOC_LIMITS.maxStateBytes})`,
        String(projectBytes),
      ),
    );

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, state, docs, blobs: [...blobs].sort(byCodeUnit), warnings };
}

/** Why the service couldn't seed this doc from its text, or null when it can. */
function seedProblem(
  projectId: ProjectId,
  key: AssetKey,
  read: Read,
  kinds: KindRegistry,
  env: KindEnv,
): BundleProblem | null {
  const text = read.text!;
  const bytes = encoder.encode(text).byteLength;
  if (read.def.storage === "doc" && read.def.prefix === "scene") {
    if (bytes > SCENE_LIMITS.maxSeedBytes)
      return problem(
        read.path,
        "asset-too-large",
        `${read.path} is ${bytes} bytes, more than a hosted scene's seed may be (${SCENE_LIMITS.maxSeedBytes})`,
        String(bytes),
      );
    try {
      seedDefinition(`${projectId}.${key}`, text);
    } catch (error) {
      return problem(read.path, "schema", error instanceof Error ? error.message : String(error));
    }
    return null;
  }
  if (!declarativeKind(kinds, read.def.kind)) {
    const json = tryJson(text);
    return json !== null && typeof json === "object" && !Array.isArray(json)
      ? null
      : problem(read.path, "schema", `${read.path} isn't a JSON object`);
  }
  let state: Uint8Array;
  try {
    state = seedAssetState({
      project: projectId,
      key,
      kind: read.def.kind,
      seed: text,
      kinds,
      env,
    });
  } catch (error) {
    if (!(error instanceof AssetSeedError)) throw error;
    return problem(read.path, "schema", error.message);
  }
  const max = Math.min(
    read.def.storage === "doc" && read.def.limits
      ? read.def.limits.maxStateBytes
      : ASSET_DOC_LIMITS.maxStateBytes,
    ASSET_DOC_LIMITS.maxStateBytes,
  );
  return state.byteLength > max
    ? problem(
        read.path,
        "asset-too-large",
        `${read.path} seeds ${state.byteLength} bytes, more than a ${read.def.kind} doc may hold (${max})`,
        String(state.byteLength),
      )
    : null;
}

// ─── Hosted rows ─────────────────────────────────────────

type Db = Pick<typeof db, "select" | "insert" | "update">;

/**
 * Whether a project id is free, reserved (a live row with no registry and
 * no docs yet, made so blobs can be uploaded before seeding), or taken.
 * A deleted project keeps its id.
 */
async function projectSlot(tx: Db, projectId: ProjectId): Promise<"free" | "reserved" | "taken"> {
  const [row] = await tx
    .select({ state: engineProjects.state, deletedAt: engineProjects.deletedAt })
    .from(engineProjects)
    .where(eq(engineProjects.projectId, projectId));
  if (!row) return "free";
  if (row.deletedAt || projectSeeded(row.state)) return "taken";
  const [[assets], [scenes]] = await Promise.all([
    tx.select({ n: count() }).from(engineAssetDocs).where(eq(engineAssetDocs.projectId, projectId)),
    tx.select({ n: count() }).from(sceneDocs).where(eq(sceneDocs.projectId, projectId)),
  ]);
  return (assets?.n ?? 0) + (scenes?.n ?? 0) > 0 ? "taken" : "reserved";
}

export type ReserveResult = { ok: true } | { ok: false; reason: "exists" | "invalid" };

/**
 * A live project row with nothing in it, so a push can upload blobs under
 * the id before it seeds the project; refuses an id that exists. The
 * service seeds an empty registry if someone opens it first, which takes
 * the id for good.
 */
export async function reserveHostedProject(input: {
  projectId: ProjectId;
  name: string;
  game?: string | null;
  createdById?: string | null;
}): Promise<ReserveResult> {
  if (!ID_PATTERN.test(input.projectId) || (input.game != null && !ID_PATTERN.test(input.game)))
    return { ok: false, reason: "invalid" };
  const [row] = await db
    .insert(engineProjects)
    .values({
      projectId: input.projectId,
      name: input.name,
      game: input.game ?? null,
      createdById: input.createdById ?? null,
    })
    .onConflictDoNothing()
    .returning({ projectId: engineProjects.projectId });
  return row ? { ok: true } : { ok: false, reason: "exists" };
}

export type SeedHostedProjectInput = BundleOptions & {
  /** A `ProjectBundle`, as the client sent it. */
  bundle: unknown;
  /** The project's content store, which holds every blob's bytes. */
  store: ContentStore;
  /** The game id whose registry judges the project; null for engine kinds only. */
  game?: string | null;
  createdById?: string | null;
  quota?: QuotaPolicy;
};

export type SeedHostedProjectResult =
  | {
      ok: true;
      projectId: ProjectId;
      /** The registry doc as stored. */
      state: Uint8Array;
      docs: number;
      warnings: BundleProblem[];
    }
  | { ok: false; reason: "invalid"; problems: BundleProblem[] }
  | { ok: false; reason: "exists" }
  | { ok: false; reason: "quota-exceeded"; refusal: QuotaExceeded };

class Taken extends Error {}

/**
 * Seeds a new hosted project from a bundle in one transaction: the
 * registry and code map as `engine_projects.state`, an `engine_asset_docs`
 * row with its seed text for every doc kind but scenes, and a `scene_docs`
 * row with its seed for every scene. Every blob the registry names must
 * already be in `engine_blobs` for the project, so a bundle with blobs
 * seeds a reserved id; one without may seed a free id. Refuses an id that
 * holds a project. The same bundle gives byte-identical rows.
 */
export async function seedHostedProject(
  input: SeedHostedProjectInput,
): Promise<SeedHostedProjectResult> {
  const parsed = parseProjectBundle(input.bundle);
  if (!parsed.ok) return { ok: false, reason: "invalid", problems: parsed.problems };
  const { bundle } = parsed;
  const projectId = bundle.project.id;
  const game = input.game ?? null;
  if (game !== null && !ID_PATTERN.test(game))
    return {
      ok: false,
      reason: "invalid",
      problems: [problem("", "bad-id", `"${game}" isn't a game id`, game)],
    };

  const slot = await projectSlot(db, projectId);
  if (slot === "taken") return { ok: false, reason: "exists" };

  const derived = await bundleProjectState(bundle, input);
  if (!derived.ok) return { ok: false, reason: "invalid", problems: derived.problems };

  const held = new Set(
    slot === "free" || derived.blobs.length === 0
      ? []
      : (
          await db
            .select({ sha256: engineBlobs.sha256 })
            .from(engineBlobs)
            .where(
              and(eq(engineBlobs.projectId, projectId), inArray(engineBlobs.sha256, derived.blobs)),
            )
        ).map((row) => row.sha256),
  );
  const missing = derived.blobs.filter((hash) => !held.has(hash));
  if (missing.length > 0) {
    const pathsOf = new Map<Sha256, AssetPath[]>();
    for (const entry of Object.values(derived.state.assets))
      if (entry.sha256 && missing.includes(entry.sha256))
        pathsOf.set(entry.sha256, [...(pathsOf.get(entry.sha256) ?? []), entry.path]);
    return {
      ok: false,
      reason: "invalid",
      problems: missing.flatMap((hash) =>
        (pathsOf.get(hash) ?? [""]).map((path) =>
          problem(
            path,
            "hash-mismatch",
            `${path}'s bytes (${hash}) aren't uploaded to project ${projectId}`,
            hash,
          ),
        ),
      ),
    };
  }

  const refusal = checkQuota(
    input.quota ?? UNLIMITED_QUOTA,
    slot === "free"
      ? { docs: 0, docBytes: 0, blobs: 0, blobBytes: 0, trashBytes: 0 }
      : await storedProjectUsage(projectId),
    { docs: derived.docs.length },
  );
  if (refusal) return { ok: false, reason: "quota-exceeded", refusal };

  const state = seedProjectState(derived.state);
  const layout = derived.state.meta.layout;
  const createdById = input.createdById ?? null;
  try {
    await db.transaction(async (tx) => {
      const now = await projectSlot(tx, projectId);
      if (now !== slot) throw new Taken();
      const values = {
        name: bundle.project.name,
        game,
        state: Buffer.from(state),
        byteSize: state.byteLength,
        layout,
      };
      if (now === "free") {
        const [row] = await tx
          .insert(engineProjects)
          .values({ projectId, createdById, ...values })
          .onConflictDoNothing()
          .returning({ projectId: engineProjects.projectId });
        if (!row) throw new Taken();
      } else {
        await tx
          .update(engineProjects)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(engineProjects.projectId, projectId));
      }
      const assets = derived.docs.filter((d) => d.prefix === "asset");
      const scenes = derived.docs.filter((d) => d.prefix === "scene");
      if (assets.length > 0)
        await tx
          .insert(engineAssetDocs)
          .values(
            assets.map((doc) => ({ projectId, assetKey: doc.key, kind: doc.kind, seed: doc.seed })),
          );
      if (scenes.length > 0) {
        const rows = await tx
          .insert(sceneDocs)
          .values(
            scenes.map((doc) => ({
              sceneId: `${projectId}.${doc.key}`,
              projectId,
              seed: doc.seed,
              createdById,
            })),
          )
          .onConflictDoNothing()
          .returning({ sceneId: sceneDocs.sceneId });
        if (rows.length !== scenes.length) throw new Taken();
      }
    });
  } catch (error) {
    if (error instanceof Taken) return { ok: false, reason: "exists" };
    throw error;
  }
  return { ok: true, projectId, state, docs: derived.docs.length, warnings: derived.warnings };
}

// ─── Reading back ────────────────────────────────────────

/** One scene or asset doc of a hosted project. */
export type HostedDoc = {
  prefix: "scene" | "asset";
  key: AssetKey;
  kind: AssetKindName;
  /** The stored Yjs state; null until the service first loads the doc. */
  state: Uint8Array | null;
  /** The file text the doc starts from, while no state is stored: the service lays it out on load. */
  seed: string | null;
};

/** What `getProjectBundle` answers: every doc state and blob hash; the client turns them into files. */
export type HostedProjectBundle = {
  projectId: ProjectId;
  name: string;
  game: string | null;
  /** The registry doc's state; an unopened project's is the empty registry the service would seed. */
  project: Uint8Array;
  /** Scenes then asset docs, each by key. */
  docs: HostedDoc[];
  /** Every blob the project stores, by hash. */
  blobs: { sha256: Sha256; bytes: number; contentType: string }[];
};

/** A hosted project's docs and blobs; null when there is no live project of that id. */
export async function readHostedProject(projectId: ProjectId): Promise<HostedProjectBundle | null> {
  if (!ID_PATTERN.test(projectId)) return null;
  const [row] = await db
    .select({
      name: engineProjects.name,
      game: engineProjects.game,
      state: engineProjects.state,
      deletedAt: engineProjects.deletedAt,
    })
    .from(engineProjects)
    .where(eq(engineProjects.projectId, projectId));
  if (!row || row.deletedAt) return null;
  const [scenes, assets, blobs] = await Promise.all([
    db
      .select({ sceneId: sceneDocs.sceneId, state: sceneDocs.state, seed: sceneDocs.seed })
      .from(sceneDocs)
      .where(eq(sceneDocs.projectId, projectId))
      .orderBy(asc(sceneDocs.sceneId)),
    db
      .select({
        key: engineAssetDocs.assetKey,
        kind: engineAssetDocs.kind,
        state: engineAssetDocs.state,
        seed: engineAssetDocs.seed,
      })
      .from(engineAssetDocs)
      .where(eq(engineAssetDocs.projectId, projectId))
      .orderBy(asc(engineAssetDocs.assetKey)),
    db
      .select({
        sha256: engineBlobs.sha256,
        bytes: engineBlobs.byteSize,
        contentType: engineBlobs.contentType,
      })
      .from(engineBlobs)
      .where(eq(engineBlobs.projectId, projectId))
      .orderBy(asc(engineBlobs.sha256)),
  ]);
  const stored = (state: Uint8Array | null) =>
    state && state.byteLength > 0 ? new Uint8Array(state) : null;
  const docs: HostedDoc[] = [
    ...scenes.map((scene) => {
      const state = stored(scene.state);
      return {
        prefix: "scene" as const,
        key: scene.sceneId.slice(projectId.length + 1),
        kind: SCENE_KIND_NAME,
        state,
        seed: state ? null : scene.seed,
      };
    }),
    ...assets.map((asset) => {
      const state = stored(asset.state);
      return {
        prefix: "asset" as const,
        key: asset.key,
        kind: asset.kind,
        state,
        seed: state ? null : asset.seed,
      };
    }),
  ];
  const project = projectSeeded(row.state)
    ? new Uint8Array(row.state!)
    : seedProjectState(emptyProjectState(projectId, row.name));
  return { projectId, name: row.name, game: row.game, project, docs, blobs };
}
