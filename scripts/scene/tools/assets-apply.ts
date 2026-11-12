import { randomKey, readProject } from "@jams/engine/collab";
import {
  checkProjectBatch,
  checksKind,
  inputScriptKind,
  memoryContentStore,
  projectView,
  SCENE_LIST_KIND,
  sceneListIssues,
  type AssetId,
  type ContentStore,
  type ProjectApplyResult,
  type ProjectOpBatch,
  type ProjectView,
  type Sha256,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";
import {
  applyProjectBatchToFiles,
  createProjectFileAdapter,
  fileContentStore,
  type FileProject,
} from "@jams/engine/vite";
import * as Y from "yjs";

import {
  failure,
  hostedOptions,
  inScope,
  issueLine,
  isToolResult,
  readArg,
  scopeError,
  usage,
  UsageError,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import {
  agentOrigin,
  DEFAULT_PROJECT_URL,
  openLiveProject,
  ProjectClientError,
} from "../project-client";
import { locateInProjects, type ProjectHandle } from "../projects";
import { loadProject, type LoadedProject } from "./project-show";

/** The flags every writer takes. */
export type WriterFlags = {
  live?: boolean;
  url?: string;
  dryRun?: boolean;
  agent?: string;
  onBehalfOf?: string;
  /** Live on a hosted project: its agent token; `JAMS_AGENT_TOKEN` when left out. */
  token?: string;
  /** File batches only: the project snapshot hash the batch was written against. */
  base?: string;
  timeoutMs?: number;
};

/** Where a writer's batch lands, and the store blob bytes go to first. */
export type BatchTarget = {
  project: ProjectHandle;
  view: ProjectView;
  live: boolean;
  /** Put a binary's bytes here before an op names their hash; a dry run's never reach the cache or the server. */
  store: ContentStore;
};

export type BatchPlan = {
  /** The asset the batch is about: it picks the project, `--project` the one when two hold it. */
  id?: string;
  /** Look the id up in the trash instead of among live assets. */
  trashed?: boolean;
  build: (
    target: BatchTarget,
  ) => ProjectOpBatch | ToolResult | Promise<ProjectOpBatch | ToolResult>;
};

/** A store that keeps what is put in memory and reads through to `under`: what a dry run uploads to. */
function scratchStore(under: ContentStore): ContentStore {
  const top = memoryContentStore();
  return {
    has: async (hash: Sha256) => (await top.has(hash)) || under.has(hash),
    get: async (hash: Sha256) => (await top.get(hash)) ?? under.get(hash),
    put: (bytes, expect) => top.put(bytes, expect),
  };
}

/**
 * The project's registry as a file batch sees it: the files reconciled with
 * the dev cache's persisted state, so the trash is in it.
 */
export async function fileProjectView(project: FileProject): Promise<ProjectView> {
  const doc = new Y.Doc();
  try {
    await createProjectFileAdapter(project).loadProject(doc);
    return projectView(readProject(doc), project.kinds);
  } finally {
    doc.destroy();
  }
}

const holds = (view: ProjectView, id: string, trashed: boolean) =>
  trashed ? view.deleted.some((e) => e.id === id) : view.byId.has(id);

/** The project a file batch goes to: the one holding the plan's id, else `--project`'s or the only one. */
async function fileTarget(ctx: ToolContext, plan: BatchPlan): Promise<ProjectHandle | ToolResult> {
  if (plan.id !== undefined) {
    const id = plan.id;
    const found = await locateInProjects(
      ctx.projects,
      id,
      async (p) => holds(await fileProjectView(p), id, plan.trashed === true),
      ctx.project,
    );
    if (found.ok) return found.project;
    if (found.exitCode === 2) return usage(found.message);
    return failure(
      plan.trashed
        ? `No project has ${JSON.stringify(id)} in its trash.`
        : `No project has an asset ${JSON.stringify(id)}.`,
      { id },
    );
  }
  const [only, ...more] = inScope(ctx);
  if (only && more.length === 0) return only;
  return usage(
    `pass --project to pick one (projects: ${ctx.projects.map((p) => p.file.id).join(", ") || "none"})`,
  );
}

type Head = {
  project: string;
  live: boolean;
  url?: string;
  dryRun: boolean;
  actor?: unknown;
};

function failedResult(
  head: Head,
  result: Extract<ProjectApplyResult, { ok: false }>,
  stale: boolean,
): ToolResult {
  return {
    exitCode: stale && result.issue.code === "stale-base" ? 3 : 1,
    data: { ...head, ok: false, opIndex: result.opIndex, issue: result.issue, written: false },
    text: [
      `${head.project}${head.live ? " (live)" : ""}: op ${result.opIndex} failed`,
      issueLine(result.issue),
    ].join("\n"),
  };
}

function report(
  head: Head,
  batch: ProjectOpBatch,
  result: Extract<ProjectApplyResult, { ok: true }>,
  written: boolean,
): ToolResult {
  const errors = result.issues.filter((i) => i.severity === "error");
  const verb = written ? "applied" : "would apply";
  const ops = batch.ops.map((o) => o.op).join(", ");
  const lines = [
    `${head.project}${head.live ? " (live)" : ""}: ${verb} ${batch.ops.length} op${batch.ops.length === 1 ? "" : "s"} (${ops})`,
    ...(result.docs.length > 0 ? [`  docs ${result.docs.join(", ")}`] : []),
    ...(result.created.length > 0 ? [`  created ${result.created.join(", ")}`] : []),
    ...result.issues.map(issueLine),
  ];
  return {
    exitCode: errors.length > 0 ? 1 : 0,
    data: {
      ...head,
      ok: errors.length === 0,
      written,
      docs: result.docs,
      created: result.created,
      issues: result.issues,
      ...(result.entry ? { entry: result.entry } : {}),
    },
    text: lines.join("\n"),
  };
}

/**
 * Applies the batch a writer builds, to the project's files or, with
 * `--live`, to the project on a running dev server as an agent client. It
 * is tried first (in memory, or on copies of the live docs): a batch the
 * engine refuses writes nothing, and `--dry-run` stops after the trial. A
 * batch that leaves error-severity issues (a forced delete's dangling
 * references) is written and exits 1. A stale file `base` exits 3.
 */
export async function runProjectBatch(
  ctx: ToolContext,
  flags: WriterFlags,
  plan: BatchPlan,
): Promise<ToolResult> {
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  if (!flags.live) {
    const liveOnly = (["url", "token"] as const).find((f) => flags[f] !== undefined);
    if (liveOnly) return usage(`--${liveOnly} needs --live`);
    return fileBatch(ctx, flags, plan);
  }
  if (flags.base !== undefined)
    return usage("--base is for file batches; a live batch applies to the docs as they are");
  return liveBatch(ctx, flags, plan);
}

/** The kinds whose docs decide what `sceneListIssues` finds. */
const FLOW_KINDS: ReadonlySet<string> = new Set([
  SCENE_LIST_KIND,
  checksKind.kind,
  inputScriptKind.kind,
]);

/** Whether the batch creates, writes, moves or removes a scene list, a checks file or an input script. */
function touchesFlow(loaded: LoadedProject, batch: ProjectOpBatch, written: Set<string>): boolean {
  if (written.size > 0) return true;
  return batch.ops.some((op) => {
    if (op.op === "createAsset") return FLOW_KINDS.has(op.kind);
    const rec = op as { id?: unknown; ids?: unknown };
    const ids = [rec.id, ...(Array.isArray(rec.ids) ? rec.ids : [])];
    return ids.some((id) => {
      const entry = typeof id === "string" ? loaded.view.byId.get(id) : undefined;
      return entry !== undefined && FLOW_KINDS.has(entry.kind);
    });
  });
}

/**
 * `scene-unlisted` as the batch would leave the project, for a batch that
 * touches a scene list, a checks file or an input script:
 * `sceneListIssues` over the registry and doc values `checkProjectBatch`
 * gives, the docs it doesn't touch as the files hold them. Issues the
 * trial already reported are left out.
 */
function sceneListAfter(
  loaded: LoadedProject,
  batch: ProjectOpBatch,
  reported: readonly SceneIssue[],
): SceneIssue[] {
  const check = checkProjectBatch(loaded.state, loaded.values, batch, {
    registry: loaded.registry,
    kinds: loaded.project.kinds,
    now: 0,
    by: "disk",
    newKey: randomKey,
  });
  if (!check.ok) return [];
  const view = projectView(check.state, loaded.project.kinds);
  const written = new Set(
    check.written.filter((key) => FLOW_KINDS.has(view.byKey.get(key)?.kind ?? "")),
  );
  if (!touchesFlow(loaded, batch, written)) return [];
  const values = new Map<AssetId, unknown>(loaded.values);
  for (const [key, value] of check.values) {
    const entry = view.byKey.get(key);
    if (entry) values.set(entry.id, value);
  }
  const seen = new Set(reported.map((i) => `${i.code} ${i.message}`));
  return sceneListIssues(view, values).filter((i) => !seen.has(`${i.code} ${i.message}`));
}

const withIssues = <R extends Extract<ProjectApplyResult, { ok: true }>>(
  result: R,
  extra: readonly SceneIssue[],
): R => (extra.length === 0 ? result : { ...result, issues: [...result.issues, ...extra] });

async function fileBatch(ctx: ToolContext, flags: WriterFlags, plan: BatchPlan) {
  const project = await fileTarget(ctx, plan);
  if (isToolResult(project)) return project;
  const loaded = await loadProject(project);
  const files = { ...project, registry: loaded.registry };
  const cache = fileContentStore(project.cacheDir);
  const store = flags.dryRun ? scratchStore(cache) : cache;
  const view = await fileProjectView(files);
  const built = await plan.build({ project, view, live: false, store });
  if (isToolResult(built)) return built;
  const batch: ProjectOpBatch =
    flags.base !== undefined && built.base === undefined ? { ...built, base: flags.base } : built;
  const origin =
    flags.agent !== undefined || flags.onBehalfOf !== undefined
      ? agentOrigin({ agent: flags.agent, onBehalfOf: flags.onBehalfOf })
      : undefined;
  const opts = { ...(origin ? { origin } : {}), store };
  const head: Head = {
    project: project.file.id,
    live: false,
    dryRun: flags.dryRun === true,
    ...(origin ? { actor: origin } : {}),
  };

  const trial = await applyProjectBatchToFiles(files, batch, { ...opts, dryRun: true });
  if (!trial.ok) return failedResult(head, trial, true);
  const unlisted = sceneListAfter(loaded, batch, trial.issues);
  if (flags.dryRun) return report(head, batch, withIssues(trial, unlisted), false);
  const applied = await applyProjectBatchToFiles(files, batch, opts);
  if (!applied.ok) return failedResult(head, applied, true);
  return report(head, batch, withIssues(applied, unlisted), true);
}

async function liveBatch(ctx: ToolContext, flags: WriterFlags, plan: BatchPlan) {
  const url = flags.url ?? DEFAULT_PROJECT_URL;
  const origin = agentOrigin({ agent: flags.agent, onBehalfOf: flags.onBehalfOf });
  const id = plan.id;
  let live;
  try {
    live = await openLiveProject({
      projects: ctx.projects,
      url,
      project: ctx.project,
      ...(id === undefined
        ? {}
        : {
            find: {
              id,
              what: plan.trashed ? "trashed asset" : "asset",
              test: (view: ProjectView) => holds(view, id, plan.trashed === true),
            },
          }),
      origin,
      prefabs: true,
      write: flags.dryRun !== true,
      ...(flags.timeoutMs === undefined ? {} : { timeoutMs: flags.timeoutMs }),
      ...hostedOptions(ctx, flags.token),
    });
  } catch (e) {
    if (e instanceof ProjectClientError)
      return e.exitCode === 2 ? usage(e.message) : failure(e.message, { url });
    throw e;
  }
  const { client, project } = live;
  const head: Head = {
    project: project.file.id,
    live: true,
    url,
    dryRun: flags.dryRun === true,
    actor: client.origin,
  };
  try {
    const server = client.session.store!;
    const store = flags.dryRun ? scratchStore(server) : server;
    const built = await plan.build({ project, view: client.session.view(), live: true, store });
    if (isToolResult(built)) return built;
    if (built.base !== undefined)
      return usage("a live batch takes no base; it applies to the docs as they are");
    const trial = await client.trial(built, { store });
    if (!trial.ok) return failedResult(head, trial, false);
    if (flags.dryRun) return report(head, built, trial, false);
    const applied = await client.apply(built);
    if (!applied.ok) return failedResult(head, applied, false);
    return report(head, built, applied, true);
  } catch (e) {
    if (e instanceof ProjectClientError) return failure(e.message, { ...head, written: false });
    throw e;
  } finally {
    await client.close().catch(() => undefined);
  }
}

// ─── assets apply ────────────────────────────────────────

export type AssetsApplyInput = WriterFlags & { ops?: string };

const APPLY_USAGE =
  "scene assets apply --ops <file|-> [--base hash] [--dry-run] [--live [--url ws://…|https://site [--token t]]] [--agent id] [--on-behalf-of user] [--project id]";

/** The first asset id a batch's ops name, which picks the project when `--project` doesn't. */
function firstId(batch: ProjectOpBatch): string | undefined {
  for (const op of batch.ops) {
    const rec = op as { id?: unknown; ids?: unknown };
    if (typeof rec.id === "string" && op.op !== "createAsset" && op.op !== "importAsset")
      return rec.id;
    if (Array.isArray(rec.ids) && typeof rec.ids[0] === "string") return rec.ids[0];
  }
  return undefined;
}

/** Applies a project op batch (`schema project-ops`), which may span docs. */
export const assetsApply: Tool<AssetsApplyInput> = async (input, ctx) => {
  if (!input.ops) return usage(APPLY_USAGE);
  let batch: ProjectOpBatch;
  try {
    batch = JSON.parse(await readArg(ctx, input.ops)) as ProjectOpBatch;
  } catch (e) {
    if (e instanceof UsageError) return usage(e.message);
    if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.ops}.`);
    return failure(`--ops is not JSON: ${(e as Error).message}`);
  }
  if (!batch || typeof batch !== "object" || !Array.isArray(batch.ops))
    return failure("--ops is not a project op batch: it needs an `ops` array.");
  const restore = batch.ops.find((o) => o.op === "restoreAsset");
  const id = ctx.project === undefined ? firstId(batch) : undefined;
  return runProjectBatch(ctx, input, {
    ...(id === undefined ? {} : { id, trashed: restore !== undefined && restore === batch.ops[0] }),
    build: () => batch,
  });
};
