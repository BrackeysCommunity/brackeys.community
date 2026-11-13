import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { RELEASE_FILE, type ReleaseManifest } from "@jams/engine/project";

import { PROJECT_QUOTA } from "../../../src/lib/engine/limits";
import { quotaAmount, quotaLabel, type UsageLine } from "../../../src/lib/engine/quota";
import {
  engineReleaseCommitPath,
  engineReleaseFilePath,
  engineReleaseMovePath,
  engineReleaseRollbackPath,
  engineReleasesPath,
} from "../../../src/lib/engine/route-paths";
import { formatBytes, formatCount } from "../../../src/lib/format-bytes";
import { releaseDay } from "../../../src/lib/jam-links";
import {
  failure,
  isToolResult,
  issueLine,
  plural,
  shortId,
  usage,
  type ToolContext,
  type ToolResult,
} from "../context";
import {
  AGENT_SITE_ENV,
  agentSiteFrom,
  HostedError,
  hostedSite,
  isHostedUrl,
  requireAgentToken,
  type HostedSite,
} from "../hosted";
import { hostedCodeProject, ProjectClientError } from "../project-client";
import type { ProjectHandle } from "../projects";
import { buildGame, type GameBuildInput, type GameBuildOutcome } from "./game-build";
import { amber, hostedProjectCopy } from "./game-live";
import { checkManifestAt } from "./game-manifest";
import { projectPull, type ProjectPullInput } from "./project-pull";

export type GameReleaseCreateInput = {
  project?: string;
  hosted: boolean;
  target?: string;
  channel?: string;
  from?: string;
  allowOverBudget: boolean;
  token?: string;
  /** The site; `JAMS_AGENT_SITE` when left out. */
  url?: string;
};

export type GameReleaseListInput = { project?: string; token?: string; url?: string };

export type GameReleaseMoveInput = {
  project?: string;
  version?: string;
  channel?: string;
  token?: string;
  url?: string;
};

export const GAME_RELEASE_CREATE_USAGE =
  "game release create <project> [--hosted] [--target web|itch] [--channel preview|none] [--from <dir>] [--allow-over-budget] [--token t] [--url https://site] [--json]";
export const GAME_RELEASE_LIST_USAGE =
  "game release list <project> [--token t] [--url https://site] [--json]";
export const GAME_RELEASE_PROMOTE_USAGE =
  "game release promote <project> <version> --channel preview [--token t] [--url https://site] [--json]";
export const GAME_RELEASE_ROLLBACK_USAGE =
  "game release rollback <project> --channel preview [--token t] [--url https://site] [--json]";

/** Files in flight at once while uploading a release. */
export const RELEASE_UPLOAD_CONCURRENCY = 4;
/** Tries per file before the upload gives up on it. */
export const RELEASE_FILE_ATTEMPTS = 3;
const FILE_TIMEOUT_MS = 120_000;
const BEGIN_TIMEOUT_MS = 30_000;

/** What `create` runs besides HTTP: the build, the hosted pull and the wait between retries. */
export type GameReleaseDeps = {
  build?: (input: GameBuildInput, ctx: ToolContext) => Promise<GameBuildOutcome>;
  pull?: (input: ProjectPullInput, ctx: ToolContext) => Promise<ToolResult>;
  /** The wait before retry `n` (1-based) of a dropped file. */
  retryDelayMs?: (attempt: number) => number;
};

// ─── The site's answers ──────────────────────────────────

/** The release API's error body (`release-errors.ts`'s `ReleaseApiError`). */
export type ReleaseApiErrorBody = {
  code: string;
  message: string;
  hint?: string;
  limit?: string;
  used?: number;
  max?: number;
};

/** A refusal from the release API, with the status it came with. */
export class ReleaseApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ReleaseApiErrorBody,
  ) {
    super(body.message);
    this.name = "ReleaseApiFailure";
  }
}

type MissingFile = { path: string; sha256: string; bytes: number };
type BeginAnswer = {
  uploadId: string;
  releaseId: string;
  version: number | null;
  missing: MissingFile[];
  usage: { before: UsageLine[]; after: UsageLine[] };
};
type CommitAnswer = { releaseId: string; version: number; created: boolean; playUrl: string };

/** A release as the list route sends it: `release-channels.ts`'s `ReleaseSummary`, its dates as ISO text. */
export type ReleaseListEntry = {
  version: number;
  id: string;
  createdAt: string;
  totalBytes: number;
  fileCount: number;
  engineVersion: string;
  target: string;
  channels: string[];
  jams: { jamId: number; title: string }[];
  firstPromotedAt: string | null;
  collectedAt: string | null;
  hidden: { at: string; reason: string | null } | null;
  audience: string;
  removalAt: string | null;
  playUrl: string;
};

const isErrorBody = (v: unknown): v is ReleaseApiErrorBody =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { code?: unknown }).code === "string" &&
  typeof (v as { message?: unknown }).message === "string";

/** Every status the release API answers with a JSON body of its own. */
const errorStatuses = () => Array.from({ length: 200 }, (_, i) => 400 + i);

/** A dropped connection or a gateway's answer: worth sending the same file again. */
const isDropped = (error: unknown) =>
  (error instanceof HostedError && error.code === "unreachable") ||
  (error instanceof ReleaseApiFailure && [500, 502, 503, 504].includes(error.status));

/** One release API call: JSON in, JSON (or nothing) out, any refusal a `ReleaseApiFailure`. */
async function call<T>(
  site: HostedSite,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const res = await site.request(path, {
    ...init,
    headers: { accept: "application/json", ...(init.headers as Record<string, string>) },
    allow: errorStatuses(),
  });
  if (res.status === 204) return undefined as T;
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ReleaseApiFailure(
      res.status,
      isErrorBody(payload)
        ? payload
        : { code: "refused", message: `The site answered ${res.status}.` },
    );
  }
  return payload as T;
}

const postJson = <T>(site: HostedSite, path: string, body: unknown, timeoutMs?: number) =>
  call<T>(site, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

// ─── Shared pieces ───────────────────────────────────────

type Access = { site: HostedSite; projectId: string };

/** The site and the agent token: `--url` or `JAMS_AGENT_SITE`, `--token` or `JAMS_AGENT_TOKEN`. */
function accessFor(
  input: { project?: string; token?: string; url?: string },
  ctx: ToolContext,
  cmdUsage: string,
): Access | ToolResult {
  if (!input.project) return usage(cmdUsage);
  const env = ctx.env ?? process.env;
  const origin = input.url ?? agentSiteFrom(env);
  if (!origin)
    return usage(`${cmdUsage}\n  name the site with --url or ${AGENT_SITE_ENV} (https://…)`);
  if (!isHostedUrl(origin)) return usage("--url: the site hosting the project, https://…");
  try {
    const agentToken = requireAgentToken(input.token, env);
    return {
      projectId: input.project,
      site: hostedSite({ site: origin, agentToken, ...(ctx.fetch ? { fetch: ctx.fetch } : {}) }),
    };
  } catch (e) {
    if (e instanceof HostedError)
      return e.code === "no-token" ? usage(e.message) : failure(e.message);
    throw e;
  }
}

/** The game's page on the site: where production is moved. */
const gamePageOf = (site: HostedSite, projectId: string) =>
  new URL(`/games/${encodeURIComponent(projectId)}`, site.origin).toString();

/** The refusal as the CLI prints it: its code, its message and its hint. */
function refusalResult(error: ReleaseApiFailure, extra: Record<string, unknown> = {}): ToolResult {
  const { code, message, hint, limit, used, max } = error.body;
  return {
    exitCode: 1,
    data: {
      ok: false,
      code,
      error: message,
      ...(hint !== undefined ? { hint } : {}),
      ...(limit !== undefined ? { limit, used, max } : {}),
      status: error.status,
      ...extra,
    },
    text: [`error: ${code}: ${message}`, ...(hint ? [`  ${hint}`] : [])].join("\n"),
  };
}

/** A site or network failure as the tool's answer; anything else is rethrown. */
function answerFailure(error: unknown, extra: Record<string, unknown> = {}): ToolResult {
  if (error instanceof ReleaseApiFailure) return refusalResult(error, extra);
  if (error instanceof HostedError) return failure(error.message, { code: error.code, ...extra });
  if (error instanceof ProjectClientError)
    return error.exitCode === 2 ? usage(error.message) : failure(error.message, extra);
  throw error;
}

/** One `warning:` line per quota at or over 80% once the release is stored. */
export function quotaWarnings(lines: readonly UsageLine[]): string[] {
  return lines
    .filter((l) => l.level !== "ok")
    .map((l) => {
      const name = quotaLabel(l.quota);
      const of = `${quotaAmount(l.quota, l.used)} of ${quotaAmount(l.quota, l.max)}`;
      return l.level === "full"
        ? `warning: ${name} is full: ${of}`
        : `warning: ${name} is ${Math.floor(l.ratio * 100)}% full: ${of}`;
    });
}

/** The release the cleanup removes next, unless something pins it first. */
function nextRemoval(releases: readonly ReleaseListEntry[]) {
  const due = releases
    .filter((r) => r.collectedAt === null && r.removalAt !== null)
    .sort((a, b) => Date.parse(a.removalAt!) - Date.parse(b.removalAt!));
  const [first] = due;
  return first ? { version: first.version, at: first.removalAt! } : null;
}

async function listOf(site: HostedSite, projectId: string): Promise<ReleaseListEntry[]> {
  const answer = await call<{ releases: ReleaseListEntry[] }>(site, engineReleasesPath(projectId));
  return answer.releases;
}

// ─── create ──────────────────────────────────────────────

type BuildDir = {
  dir: string;
  text: string;
  manifest: ReleaseManifest;
  /** Every listed file's path by hash, to read a missing file's bytes from. */
  paths: Map<string, string>;
};

/** Reads and checks a build's `release.json` with its files: what `game manifest <dir>` checks. */
async function readBuild(dir: string, allowOverBudget: boolean): Promise<BuildDir | ToolResult> {
  const checked = await checkManifestAt(dir);
  if (!checked.ok) return checked.result;
  const blocking = checked.issues.filter(
    (i) => i.severity === "error" && !(allowOverBudget && i.code === "export-over-budget"),
  );
  if (blocking.length > 0)
    return {
      exitCode: 1,
      data: { ok: false, dir, issues: checked.issues },
      text: [`${dir}: this build can't be released`, ...checked.issues.map(issueLine)].join("\n"),
    };
  const paths = new Map<string, string>();
  for (const f of checked.manifest.build.files)
    if (!paths.has(f.sha256)) paths.set(f.sha256, f.path);
  return {
    dir,
    text: await readFile(join(dir, RELEASE_FILE), "utf8"),
    manifest: checked.manifest,
    paths,
  };
}

/** Runs `work` over `items` with at most `limit` in flight; the first failure stops new work and is thrown. */
async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  let failed: unknown = null;
  const lane = async () => {
    while (failed === null && next < items.length) {
      const item = items[next++]!;
      try {
        await work(item);
      } catch (error) {
        failed ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failed !== null) throw failed;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends every missing file, four at a time, each tried again when its connection drops. */
async function uploadMissing(
  site: HostedSite,
  build: BuildDir,
  begun: BeginAnswer,
  deps: GameReleaseDeps,
): Promise<{ files: number; bytes: number; retries: number }> {
  const delay = deps.retryDelayMs ?? ((n: number) => 500 * 2 ** (n - 1));
  let retries = 0;
  let bytes = 0;
  await pool(begun.missing, RELEASE_UPLOAD_CONCURRENCY, async (file) => {
    const path = build.paths.get(file.sha256) ?? file.path;
    const body = new Uint8Array(await readFile(join(build.dir, ...path.split("/"))));
    for (let attempt = 1; ; attempt++) {
      try {
        await call<void>(site, engineReleaseFilePath(begun.uploadId, file.sha256), {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body,
          timeoutMs: FILE_TIMEOUT_MS,
        });
        bytes += file.bytes;
        return;
      } catch (error) {
        if (!isDropped(error) || attempt >= RELEASE_FILE_ATTEMPTS) throw error;
        retries++;
        await wait(delay(attempt));
      }
    }
  });
  return { files: begun.missing.length, bytes, retries };
}

/**
 * Builds the project (or takes `--from`'s build), uploads it to the hosted
 * project as a new release and prints its version, size, play URL and the
 * quotas after it. `begin` names the files the site doesn't hold; they go
 * four at a time, a dropped one sent again, and a commit that finds files
 * missing begins again for those. New releases land on preview unless
 * `--channel none`; production moves on the game's page.
 */
export async function gameReleaseCreate(
  input: GameReleaseCreateInput,
  ctx: ToolContext,
  deps: GameReleaseDeps = {},
): Promise<ToolResult> {
  const access = accessFor(input, ctx, GAME_RELEASE_CREATE_USAGE);
  if (isToolResult(access)) return access;
  const { site, projectId } = access;
  const channel = input.channel ?? "preview";
  if (channel !== "preview" && channel !== "none")
    return usage(
      `--channel is preview or none; production is moved by a person on the game's page: ${gamePageOf(site, projectId)}`,
    );
  if (input.from !== undefined && input.hosted)
    return usage(
      "--from takes a finished build; --hosted builds from the hosted project, so pass one",
    );

  const temps: string[] = [];
  try {
    let build: BuildDir | ToolResult;
    if (input.from !== undefined) {
      build = await readBuild(resolve(input.from), input.allowOverBudget);
    } else {
      let local: ProjectHandle;
      try {
        local = hostedCodeProject(ctx.projects, projectId, ctx.project);
      } catch (e) {
        return answerFailure(e);
      }
      const buildInput: GameBuildInput = {
        id: local.file.id,
        allowOverBudget: input.allowOverBudget,
        ...(input.target === undefined ? {} : { target: input.target }),
      };
      if (input.hosted) {
        const copy = await hostedProjectCopy(
          local,
          site.origin,
          input.token,
          ctx,
          deps.pull ?? projectPull,
          "release",
        );
        temps.push(copy.dir);
        if ("result" in copy) return copy.result;
        local = { ...local, dir: copy.dir };
        const out = await mkdtemp(join(tmpdir(), `jams-release-${local.file.id}-`));
        temps.push(out);
        buildInput.out = out;
      }
      const built = await (deps.build ?? buildGame)(buildInput, { ...ctx, projects: [local] });
      if (built.result.exitCode !== 0 || !built.built) return built.result;
      build = await readBuild(built.built.out, input.allowOverBudget);
    }
    if (isToolResult(build)) return build;
    return await release(site, projectId, build, channel, deps, ctx.env ?? process.env);
  } catch (error) {
    return answerFailure(error, { project: projectId });
  } finally {
    for (const dir of temps) await rm(dir, { recursive: true, force: true });
  }
}

async function release(
  site: HostedSite,
  projectId: string,
  build: BuildDir,
  channel: "preview" | "none",
  deps: GameReleaseDeps,
  env: Readonly<Record<string, string | undefined>>,
): Promise<ToolResult> {
  const begin = () =>
    postJson<BeginAnswer>(
      site,
      engineReleasesPath(projectId),
      { manifest: build.text, channel },
      BEGIN_TIMEOUT_MS,
    );
  let begun = await begin();
  const first = begun;
  const sent = await uploadMissing(site, build, begun, deps);
  let committed: CommitAnswer;
  try {
    committed = await postJson<CommitAnswer>(site, engineReleaseCommitPath(projectId), {
      uploadId: begun.uploadId,
    });
  } catch (error) {
    if (!(error instanceof ReleaseApiFailure && error.body.code === "release-files-missing"))
      throw error;
    begun = await begin();
    const again = await uploadMissing(site, build, begun, deps);
    sent.files += again.files;
    sent.bytes += again.bytes;
    sent.retries += again.retries;
    committed = await postJson<CommitAnswer>(site, engineReleaseCommitPath(projectId), {
      uploadId: begun.uploadId,
    });
  }

  const releases = await listOf(site, projectId);
  const kept = releases.filter((r) => r.collectedAt === null).length;
  const removal = nextRemoval(releases);
  const after = first.usage.after;
  const storage = after.find((l) => l.quota === "releaseStorageBytes");
  const files = build.manifest.build.files;
  const bytes =
    files.reduce((n, f) => n + f.bytes, 0) + new TextEncoder().encode(build.text).length;
  const newBytes = first.missing.reduce((n, f) => n + f.bytes, 0);
  const gamePage = gamePageOf(site, projectId);
  const warnings = quotaWarnings(after);
  const v = `v${committed.version}`;

  const head = committed.created
    ? `Released ${projectId} ${v} (${shortId(committed.releaseId)})${channel === "preview" ? " to preview" : ""}`
    : `${projectId} ${v} (${shortId(committed.releaseId)}) was released already${channel === "preview" ? "; preview names it" : ""}`;
  const text = [
    `${head}: ${formatBytes(bytes)}, ${plural(files.length, "file")}, ${formatBytes(newBytes)} new.`,
    `  Play:     ${committed.playUrl}`,
    ...(storage
      ? [
          `  Storage:  ${formatBytes(storage.used)} of ${formatBytes(storage.max)} ${quotaLabel("releaseStorageBytes")} · ${formatCount(kept)} of ${formatCount(PROJECT_QUOTA.releasesKept)} releases kept`,
        ]
      : []),
    `  Removal:  ${removal ? `v${removal.version} on ${releaseDay(removal.at)} (not pinned)` : "none due"}`,
    `Promote it to production on the game's page: ${gamePage}`,
    ...warnings.map((w) => amber(w, env)),
  ].join("\n");

  return {
    exitCode: 0,
    data: {
      ok: true,
      project: projectId,
      version: committed.version,
      releaseId: committed.releaseId,
      shortId: committed.releaseId.slice(0, 6),
      created: committed.created,
      channel,
      bytes,
      files: files.length,
      newBytes,
      uploaded: { files: sent.files, bytes: sent.bytes, retries: sent.retries },
      playUrl: committed.playUrl,
      gamePage,
      usage: first.usage,
      kept: { count: kept, max: PROJECT_QUOTA.releasesKept },
      nextRemoval: removal,
      warnings,
    },
    text,
  };
}

// ─── list ────────────────────────────────────────────────

function stateOf(r: ReleaseListEntry): string {
  if (r.collectedAt !== null) return `removed ${releaseDay(r.collectedAt)}`;
  if (r.hidden) return `hidden${r.hidden.reason ? `: ${r.hidden.reason}` : ""}`;
  if (r.removalAt !== null) return `removal ${releaseDay(r.removalAt)}`;
  return "kept";
}

/** The hosted project's releases, newest first: size, channels, jam pins and when each is removed. */
export async function gameReleaseList(
  input: GameReleaseListInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const access = accessFor(input, ctx, GAME_RELEASE_LIST_USAGE);
  if (isToolResult(access)) return access;
  const { site, projectId } = access;
  let releases: ReleaseListEntry[];
  try {
    releases = await listOf(site, projectId);
  } catch (error) {
    return answerFailure(error, { project: projectId });
  }
  const kept = releases.filter((r) => r.collectedAt === null).length;
  const lines = releases.map((r) => {
    const pins = [...r.channels, ...r.jams.map((j) => `jam ${j.title}`)];
    return [
      `  v${r.version}`,
      shortId(r.id),
      formatBytes(r.totalBytes),
      plural(r.fileCount, "file"),
      r.target,
      pins.length > 0 ? pins.join(", ") : "-",
      stateOf(r),
    ].join("  ");
  });
  return {
    exitCode: 0,
    data: {
      ok: true,
      project: projectId,
      releases,
      kept: { count: kept, max: PROJECT_QUOTA.releasesKept },
      gamePage: gamePageOf(site, projectId),
    },
    text:
      releases.length === 0
        ? `${projectId}: no releases yet; publish one with vp run scene game release create ${projectId}`
        : [
            `${projectId}: ${plural(releases.length, "release")}, ${formatCount(kept)} of ${formatCount(PROJECT_QUOTA.releasesKept)} kept`,
            ...lines,
          ].join("\n"),
  };
}

// ─── promote, rollback ───────────────────────────────────

/** `--channel`: preview here; production goes to the site, whose refusal names the game's page. */
function channelOf(
  channel: string | undefined,
  cmdUsage: string,
): "preview" | "production" | ToolResult {
  if (channel === "preview" || channel === "production") return channel;
  return usage(cmdUsage);
}

/** A production refusal always ends with the game's page, where a person moves it. */
function moveFailure(error: unknown, site: HostedSite, projectId: string): ToolResult {
  const gamePage = gamePageOf(site, projectId);
  const result = answerFailure(error, { project: projectId, gamePage });
  if (
    error instanceof ReleaseApiFailure &&
    error.body.code === "release-forbidden" &&
    !result.text.includes(gamePage)
  )
    return { ...result, text: `${result.text}\n  ${gamePage}` };
  return result;
}

function moved(
  site: HostedSite,
  projectId: string,
  channel: string,
  verb: string,
  answer: { from: number | null; to: number },
): ToolResult {
  const playUrl = new URL(
    `/games/${encodeURIComponent(projectId)}/play/${channel}`,
    site.origin,
  ).toString();
  const was = answer.from === null ? "" : ` (was v${answer.from})`;
  return {
    exitCode: 0,
    data: { ok: true, project: projectId, channel, from: answer.from, to: answer.to, playUrl },
    text: [`${projectId}: ${channel} ${verb} v${answer.to}${was}`, `  Play:     ${playUrl}`].join(
      "\n",
    ),
  };
}

/** Points the hosted project's preview channel at a version. */
export async function gameReleasePromote(
  input: GameReleaseMoveInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const access = accessFor(input, ctx, GAME_RELEASE_PROMOTE_USAGE);
  if (isToolResult(access)) return access;
  const { site, projectId } = access;
  const version = Number(input.version);
  if (input.version === undefined || !Number.isSafeInteger(version) || version < 1)
    return usage(GAME_RELEASE_PROMOTE_USAGE);
  const channel = channelOf(input.channel, GAME_RELEASE_PROMOTE_USAGE);
  if (isToolResult(channel)) return channel;
  try {
    const answer = await postJson<{ from: number | null; to: number }>(
      site,
      engineReleaseMovePath(projectId, version, "promote"),
      { channel },
    );
    return moved(site, projectId, channel, "now names", answer);
  } catch (error) {
    return moveFailure(error, site, projectId);
  }
}

/** Points the hosted project's preview channel back at the release it named before. */
export async function gameReleaseRollback(
  input: GameReleaseMoveInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const access = accessFor(input, ctx, GAME_RELEASE_ROLLBACK_USAGE);
  if (isToolResult(access)) return access;
  const { site, projectId } = access;
  const channel = channelOf(input.channel, GAME_RELEASE_ROLLBACK_USAGE);
  if (isToolResult(channel)) return channel;
  try {
    const answer = await postJson<{ from: number; to: number }>(
      site,
      engineReleaseRollbackPath(projectId),
      { channel },
    );
    return moved(site, projectId, channel, "rolled back to", answer);
  } catch (error) {
    return moveFailure(error, site, projectId);
  }
}
