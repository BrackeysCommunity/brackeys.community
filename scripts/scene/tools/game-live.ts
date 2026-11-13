import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  diffWords,
  swapStrategyFor,
  timingWords,
  utf8Bytes,
  versionName,
  type StagedVersion,
} from "@jams/engine";
import type { ExportInput } from "@jams/engine/export";
import {
  clampTiming,
  sceneVersionName,
  SWAP_TIMINGS,
  type GameDefinition,
  type SwapStrategy,
  type SwapTiming,
} from "@jams/engine/game";
import {
  fileSchemaIssue,
  swapCheck,
  type SwapCheckOptions,
  type SwapCheckReport,
} from "@jams/engine/headless";
import {
  buildSceneVersion,
  byCodeUnit,
  formatBytes,
  formatSceneVersion,
  inputScriptKind,
  parseReleaseManifest,
  parseSceneVersion,
  prefabKind,
  readReleaseScene,
  readSceneVersion,
  releaseId,
  SCENE_KIND_NAME,
  sceneVersionDataBytes,
  sceneVersionOptions,
  sha256,
  type ReleaseManifest,
  type SceneVersion,
  type Sha256,
} from "@jams/engine/project";
import {
  checksPathOf,
  closest,
  diffExpanded,
  isErrorIssue,
  liveIssue,
  parseInputScript,
  type ExpandedScene,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneIssue,
} from "@jams/engine/scene";

import { quotaAmount, quotaLabel, type UsageLine } from "../../../src/lib/engine/quota";
import { refusalFor } from "../../../src/lib/engine/release-access";
import {
  engineLiveBasePath,
  engineLiveCommitPath,
  engineLiveMovePath,
  engineLivePath,
  engineLivePromotePath,
} from "../../../src/lib/engine/route-paths";
import { formatCount } from "../../../src/lib/format-bytes";
import {
  amber,
  failure,
  isToolResult,
  issueLine,
  plural,
  shortId,
  usage,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { agentSiteFrom, AGENT_SITE_ENV, hostedProjectCopy, isHostedUrl } from "../hosted";
import { hostedCodeProject, ProjectClientError } from "../project-client";
import { projectRuntime, type ProjectHandle } from "../projects";
import { readChecksFile } from "./check";
import { clearOut, exportInputOf, projectOf } from "./game-build";
import { readReleaseAt, shownPath } from "./game-manifest";
import {
  accessFor,
  answerFailure,
  BEGIN_TIMEOUT_MS,
  call,
  channelPlayUrl,
  gamePageOf,
  keptState,
  postJson,
  quotaWarnings,
  refusalResult,
  ReleaseApiFailure,
  sendUpload,
  type Access,
  type GameReleaseDeps,
  type MissingUpload,
} from "./game-release";
import { projectPull, type ProjectPullInput } from "./project-pull";
import { readVersionAt, SCENE_VERSION_FILE, versionDirFiles, versionTextFile } from "./replay";

export type GameLiveBuildInput = {
  project?: string;
  scene?: string;
  hosted: boolean;
  out?: string;
  /** With `hosted`: the site, else `JAMS_AGENT_SITE`. */
  url?: string;
  /** With `hosted`: the agent token, else `JAMS_AGENT_TOKEN`. */
  token?: string;
};

export type GameLiveCheckInput = {
  project?: string;
  scene?: string;
  /** The release to check against: a build directory or its release.json. */
  against?: string;
  /** The version players have now: a built version's directory. */
  from?: string;
};

/** What `build --hosted` and `publish --hosted` run besides the build: the pull; and `publish`'s wait between retries. */
export type GameLiveDeps = {
  pull?: Tool<ProjectPullInput>;
  retryDelayMs?: GameReleaseDeps["retryDelayMs"];
};

/** The site and agent token, as `game release` takes them: `--url` or `JAMS_AGENT_SITE`, `--token` or `JAMS_AGENT_TOKEN`. */
type SiteInput = { project?: string; token?: string; url?: string };

export type GameLivePublishInput = SiteInput & {
  scene?: string;
  hosted: boolean;
  channel?: string;
  timing?: string;
  note?: string;
  noSwapCheck: boolean;
};

export type GameLiveListInput = SiteInput & { scene?: string };

export type GameLiveMoveInput = SiteInput & {
  scene?: string;
  /** `promote`'s version number. */
  number?: string;
  channel?: string;
  /** `promote`'s timing. */
  timing?: string;
};

export const GAME_LIVE_BUILD_USAGE =
  "game live build <project> <scene> [--hosted] [--out <dir>] [--json]";
export const GAME_LIVE_CHECK_USAGE =
  "game live check <project> <scene> [--against <release dir|release.json>] [--from <version dir>] [--json]";
export const GAME_LIVE_PUBLISH_USAGE =
  'game live publish <project> <scene> [--hosted] [--channel preview|none] [--timing next-load|boundary|now] [--note "…"] [--no-swap-check] [--json]';
export const GAME_LIVE_LIST_USAGE = "game live list <project> [<scene>] [--json]";
export const GAME_LIVE_PROMOTE_USAGE =
  "game live promote <project> <scene> <n> --channel preview [--timing next-load|boundary|now] [--json]";
export const GAME_LIVE_ROLLBACK_USAGE =
  "game live rollback <project> <scene> --channel preview [--json]";
export const GAME_LIVE_CLEAR_USAGE = "game live clear <project> <scene> --channel preview [--json]";

/** Where `game live build` writes when `--out` is left out, relative to the working directory. */
export const defaultLiveOut = (project: string, scene: string) =>
  join("dist", "live", project, scene);

// ─── Building ────────────────────────────────────────────

/** What a build produced, before anything is written. */
type Built = {
  input: ExportInput;
  handle: ProjectHandle;
  version: SceneVersion;
  id: Sha256;
  texts: ReadonlyMap<Sha256, string>;
  issues: SceneIssue[];
};

/** The scene `id` of the export input, or the usage error naming the scenes it has. */
function sceneOf(input: ExportInput, id: string, cmd: string): ToolResult | null {
  if (input.view.byId.get(id)?.kind === SCENE_KIND_NAME) return null;
  const scenes = [...input.view.byId.values()]
    .filter((e) => e.kind === SCENE_KIND_NAME)
    .map((e) => e.id)
    .sort();
  const guess = closest(id, scenes);
  return usage(
    `${cmd}: ${input.project.id} has no scene ${JSON.stringify(id)}${guess ? `; did you mean "${guess}"?` : ""} (scenes: ${scenes.join(", ") || "none"})`,
  );
}

/** Builds the version of `scene` from `handle`'s files, checked against `release` when given. */
async function buildFrom(
  handle: ProjectHandle,
  scene: string,
  cmd: string,
  release?: ReleaseManifest,
): Promise<Built | ToolResult> {
  const input = await exportInputOf(handle, "web");
  if (isToolResult(input)) return input;
  const missing = sceneOf(input, scene, cmd);
  if (missing) return missing;
  const built = await buildSceneVersion(sceneVersionOptions(input, scene, { release }));
  if (!built.ok)
    return {
      exitCode: 1,
      data: { ok: false, project: input.project.id, scene, issues: built.issues },
      text: [
        `${input.project.id} ${scene}: no version: the scene doesn't read`,
        ...built.issues.map(issueLine),
      ].join("\n"),
    };
  return { input, handle, ...built };
}

/**
 * The project a version is built from: the CLI's files, or with `hosted`
 * a pull of the hosted project over a temporary copy of them, whose
 * directory goes into `temps` for the caller to remove. `from` names it.
 */
async function sourceOf(
  input: { project?: string; hosted: boolean; url?: string; token?: string },
  ctx: ToolContext,
  deps: GameLiveDeps,
  temps: string[],
  cmdUsage: string,
  cmd: string,
): Promise<{ handle: ProjectHandle; from: string } | ToolResult> {
  const project = input.project!;
  if (!input.hosted) {
    const handle = projectOf(ctx, project, cmd);
    return isToolResult(handle) ? handle : { handle, from: "files" };
  }
  const env = ctx.env ?? process.env;
  const site = input.url ?? agentSiteFrom(env);
  if (!site) return usage(`${cmdUsage}\n  --hosted needs the site in ${AGENT_SITE_ENV}`);
  if (!isHostedUrl(site)) return usage("the site hosting the project is https://…");
  let local: ProjectHandle;
  try {
    local = hostedCodeProject(ctx.projects, project, ctx.project);
  } catch (e) {
    if (e instanceof ProjectClientError)
      return e.exitCode === 2 ? usage(e.message) : failure(e.message);
    throw e;
  }
  const copy = await hostedProjectCopy(
    local,
    site,
    input.token,
    ctx,
    deps.pull ?? projectPull,
    "live",
  );
  temps.push(copy.dir);
  if ("result" in copy) return copy.result;
  return { handle: { ...local, dir: copy.dir }, from: new URL(site).origin };
}

/** The version file's text and size, and every carried text's. */
function sizesOf(built: Pick<Built, "version" | "texts">) {
  const versionText = formatSceneVersion(built.version);
  const texts = [...built.texts].map(([sha, text]) => ({ sha256: sha, bytes: utf8Bytes(text) }));
  const dataBytes = sceneVersionDataBytes(versionText, built.version);
  return { versionText, texts, dataBytes };
}

/** The ids of the version's carried assets, by the hash of their text. */
function idsByHash(version: SceneVersion): Map<Sha256, string> {
  const ids = new Map<Sha256, string>();
  for (const [id, a] of Object.entries(version.assets))
    if (a.storage === "doc") ids.set(a.sha256, id);
  return ids;
}

/**
 * Builds one scene's version from the project's files (or, with `--hosted`,
 * from a pull of the hosted project over a temporary copy of them) and
 * writes it to `--out`: `scene-version.json` in canonical form and each
 * text it carries as `<sha256>.json`. Prints its id, its data size (the
 * version file and its texts) and the files. The same content gives the
 * editor's id.
 */
export async function gameLiveBuild(
  input: GameLiveBuildInput,
  ctx: ToolContext,
  deps: GameLiveDeps = {},
): Promise<ToolResult> {
  if (!input.project || !input.scene) return usage(GAME_LIVE_BUILD_USAGE);
  const temps: string[] = [];
  try {
    const source = await sourceOf(
      input,
      ctx,
      deps,
      temps,
      GAME_LIVE_BUILD_USAGE,
      "game live build",
    );
    if (isToolResult(source)) return source;
    const { handle, from } = source;

    const built = await buildFrom(handle, input.scene, "game live build");
    if (isToolResult(built)) return built;
    const { version, id } = built;
    const out = resolve(input.out ?? defaultLiveOut(input.project, input.scene));
    const cleared = await clearOut(out, SCENE_VERSION_FILE, "version");
    if (cleared) return cleared;
    await mkdir(out, { recursive: true });
    const { versionText, texts, dataBytes } = sizesOf(built);
    for (const [file, text] of versionDirFiles(versionText, built.texts))
      await writeFile(join(out, file), text);

    const ids = idsByHash(version);
    const files: { file: string; bytes: number; asset?: string }[] = [
      { file: SCENE_VERSION_FILE, bytes: utf8Bytes(versionText) },
      ...texts.map((t) => ({
        file: versionTextFile(t.sha256),
        bytes: t.bytes,
        ...(ids.has(t.sha256) ? { asset: ids.get(t.sha256)! } : {}),
      })),
    ];
    const blobs = Object.values(version.assets).filter((a) => a.storage === "blob").length;
    const ok = !built.issues.some(isErrorIssue);
    return {
      exitCode: ok ? 0 : 1,
      data: {
        ok,
        project: input.project,
        scene: input.scene,
        id,
        from,
        out,
        dataBytes,
        files,
        blobs,
        sceneHash: version.sceneHash,
        physics: version.entry.physics,
        issues: built.issues,
      },
      text: [
        `Built ${input.project} ${input.scene} (${shortId(id)}): ${formatBytes(dataBytes)} of data, ${plural(files.length, "file")} in ${shownPath(out)}.`,
        `  Files:    ${files.map((f) => (f.asset === undefined ? f.file : `${shortId(f.file)}.json (${f.asset})`)).join(", ")}`,
        ...(blobs > 0
          ? [`  Blobs:    ${plural(blobs, "asset")} by hash, from the release or the site's blobs`]
          : []),
        ...built.issues.map(issueLine),
      ].join("\n"),
    };
  } finally {
    for (const dir of temps) await rm(dir, { recursive: true, force: true });
  }
}

// ─── Checking ────────────────────────────────────────────

/** The version players have now, as the swap check and the diff read it. */
type Base = {
  /** How the lines name it. */
  name: string;
  from: StagedVersion | { def: SceneDefinition; prefabs: PrefabLibrary };
  scene: ExpandedScene;
  physics: string;
};

/**
 * The release's own scene, read by the one reader a version is read by
 * (`readReleaseScene`), against the release's texts by hash. `skip` says
 * why there is none to swap from.
 */
function releaseBaseOf(
  manifest: ReleaseManifest,
  texts: ReadonlyMap<Sha256, string>,
  input: ExportInput,
  scene: string,
  name: string,
): Base | { issues: SceneIssue[] } | { skip: string } {
  const entry = manifest.flow.scenes.find((s) => s.id === scene);
  if (!entry) return { skip: `${name} doesn't list ${scene}` };
  const own = manifest.assets[scene];
  if (!own || !texts.has(own.sha256))
    return { skip: `${name}'s files aren't beside it (${own?.file ?? scene} is missing)` };
  const read = readReleaseScene(manifest, scene, texts, input.registry, input.game, {
    engine: input.engine,
  });
  if (!read) return { skip: `${name} doesn't list ${scene}` };
  if (!read.ok) return { issues: read.issues };
  return {
    name,
    from: { def: read.def, prefabs: read.prefabs },
    scene: read.scene,
    physics: entry.physics,
  };
}

/** `releaseBaseOf` over the scene and prefab texts beside a release's manifest in `dir`. */
async function releaseBase(
  manifest: ReleaseManifest,
  dir: string,
  input: ExportInput,
  scene: string,
  name: string,
): Promise<Base | { issues: SceneIssue[] } | { skip: string }> {
  const texts = new Map<Sha256, string>();
  for (const a of Object.values(manifest.assets)) {
    if (a.storage !== "doc" || (a.kind !== SCENE_KIND_NAME && a.kind !== prefabKind.kind)) continue;
    try {
      texts.set(a.sha256, await readFile(join(dir, a.file), "utf8"));
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
    }
  }
  return releaseBaseOf(manifest, texts, input, scene, name);
}

/** The scene's input scripts in the project, by path, read for its game and seats; one naming the scene that doesn't read is an error. */
function scriptsOf(
  input: ExportInput,
  scene: string,
  players: Parameters<typeof parseInputScript>[2],
): { scripts: SwapCheckOptions["scripts"][number][]; issues: SceneIssue[] } {
  const scripts: SwapCheckOptions["scripts"][number][] = [];
  const issues: SceneIssue[] = [];
  const entries = [...input.view.byId.values()]
    .filter((e) => e.kind === inputScriptKind.kind)
    .sort((a, b) => byCodeUnit(a.path, b.path));
  for (const entry of entries) {
    const text = input.texts.get(entry.id);
    if (text === undefined) continue;
    const parsed = parseInputScript(text, input.registry, players);
    if (parsed.ok) {
      if (parsed.script.scene === scene) scripts.push({ name: entry.path, script: parsed.script });
      continue;
    }
    let named: unknown;
    try {
      named = (JSON.parse(text) as { scene?: unknown }).scene;
    } catch {
      named = undefined;
    }
    if (named === scene)
      issues.push(...parsed.issues.map((i) => fileSchemaIssue(entry.path, i, [entry.id])));
  }
  return { scripts, issues };
}

/** Why a wanted timing became an earlier one: the game doesn't declare it. */
const clampedWarning = (game: GameDefinition, scene: string) =>
  liveIssue({
    code: "live-timing-unsupported",
    version: scene,
    accepted: game.live?.timings ?? [],
  }).message;

/** `12 entities changed, 3 added, 1 removed (players' worlds update in place)`. */
function changesText(diff: ReturnType<typeof diffExpanded>, strategy: SwapStrategy): string {
  const how = strategy === "reload" ? "players' worlds reload" : "players' worlds update in place";
  return `${diffWords(diff)} (${how})`;
}

/** `3 runs over level-1.script.json passed; checks 4 passed` and the issues under it. */
function swapText(report: SwapCheckReport, scripts: readonly string[]): string[] {
  const failed = report.runs.filter((r) => r.issues.some(isErrorIssue));
  const over = scripts.length > 0 ? ` over ${scripts.join(", ")}` : "";
  const checks = report.checks;
  const checksFailed = checks?.results.filter((r) => !r.pass) ?? [];
  const head =
    report.runs.length === 0
      ? "no runs: the scene has no input scripts"
      : failed.length === 0
        ? `${plural(report.runs.length, "run")}${over} passed`
        : `${failed.length} of ${plural(report.runs.length, "run")}${over} failed`;
  const checksPart = checks
    ? `; checks ${checksFailed.length === 0 ? `${checks.results.length} passed` : `${checksFailed.length} of ${checks.results.length} failed`}`
    : "";
  return [
    `  Swaps:    ${head}${checksPart}`,
    ...report.issues.map(issueLine),
    ...failed.flatMap((r) => [
      `    ${r.script} at ${Math.round(r.at * 100)}% (t${r.tick}, ${r.strategy}):`,
      ...r.issues.map((i) => `  ${issueLine(i)}`),
    ]),
    ...checksFailed.map((r) => `    FAIL ${r.id} (${r.kind}) ${r.message}`),
  ];
}

/**
 * Builds one scene's version from the project's files and checks it. With
 * `--against` (a release directory or its `release.json`), the version is
 * checked for that release (`checkSceneVersion`, through the build) and the
 * release's own scene is what players have now; `--from` names a built
 * version they have instead. Then, when the game takes versions mid-run,
 * the swap check plays the scene's input scripts on what players have and
 * swaps this version in (`swapCheck`). With neither flag it only validates,
 * and says so. Exit 1 on any error.
 */
export async function gameLiveCheck(
  input: GameLiveCheckInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!input.project || !input.scene) return usage(GAME_LIVE_CHECK_USAGE);
  const { scene } = input;
  const env = ctx.env ?? process.env;
  const handle = projectOf(ctx, input.project, "game live check");
  if (isToolResult(handle)) return handle;

  let release: { manifest: ReleaseManifest; id: Sha256; file: string } | null = null;
  if (input.against !== undefined) {
    const read = await readReleaseAt(resolve(input.against));
    if (!read.ok) return read.result;
    release = { manifest: read.manifest, id: await releaseId(read.manifest), file: read.file };
  }

  const built = await buildFrom(handle, scene, "game live check", release?.manifest);
  if (isToolResult(built)) return built;
  const { version, id, texts } = built;
  const issues = [...built.issues];
  const lines: string[] = [];
  const warnings: string[] = [];
  const { dataBytes } = sizesOf(built);

  const blobs = Object.values(version.assets).filter((a) => a.storage === "blob");
  const shipped = new Set(Object.values(release?.manifest.assets ?? {}).map((a) => a.sha256));
  const newFiles = blobs.filter((a) => !shipped.has(a.sha256)).length;

  const game = built.input.game;
  const { timing, clamped } = clampTiming(game.live, "now");
  if (clamped) warnings.push(clampedWarning(game, scene));

  if (release) {
    // A build stops on its own errors, so an error here is the release check's.
    const fits = issues.some(isErrorIssue) ? "doesn't fit " : "";
    lines.push(
      `  Fits:     ${fits}release ${shortId(release.id)} (${shownPath(release.file)}) · timing: ${timingWords(timing)}`,
    );
  }

  let base: Base | null = null;
  let swapSkipped: string | null = null;
  if (input.from !== undefined) {
    const at = await readVersionAt(resolve(input.from));
    if (!at.ok) return failure(`--from: ${at.error}`, { from: input.from });
    for (const p of at.problems) warnings.push(`--from ${p}; skipped`);
    const staged = at.staged;
    if (staged.version.scene !== scene)
      return failure(`--from holds a version of ${staged.version.scene}, not ${scene}`, {
        from: input.from,
        scene: staged.version.scene,
      });
    const read = readSceneVersion(staged.version, staged.texts, built.input.registry, game, {
      engine: built.input.engine,
    });
    if (!read.ok) issues.push(...read.issues);
    else
      base = {
        name: versionName(scene, staged.id),
        from: staged,
        scene: read.scene,
        physics: staged.version.entry.physics,
      };
  } else if (release) {
    const dir = dirname(release.file);
    const read = await releaseBase(
      release.manifest,
      dir,
      built.input,
      scene,
      `release ${shortId(release.id)}`,
    );
    if ("issues" in read) issues.push(...read.issues);
    else if ("skip" in read) {
      swapSkipped = read.skip;
      lines.push(`  Swaps:    not checked: ${swapSkipped}`);
    } else base = read;
  }

  const to = readSceneVersion(version, texts, built.input.registry, game, {
    engine: built.input.engine,
  });
  if (!to.ok) issues.push(...to.issues);
  let swaps: SwapCheckReport | null = null;
  let diff: ReturnType<typeof diffExpanded> | null = null;
  if (base && to.ok) {
    diff = diffExpanded(base.scene, to.scene);
    lines.push(`  Changes:  ${changesText(diff, swapStrategyFor(diff))}`);
    if (timing === "next-load") {
      swapSkipped = "this game takes new versions only at the next load";
      lines.push(`  Swaps:    not checked: ${swapSkipped}`);
    } else {
      const ran = await swapsFrom(built, base, scene, ctx);
      if (isToolResult(ran)) return ran;
      issues.push(...ran.issues);
      swaps = ran.report;
      lines.push(...ran.lines);
    }
  } else if (input.from === undefined && !release) {
    warnings.push(
      "only validated: pass --against <release dir|release.json> to check it fits a release, or --from <version dir> to check the swap from the version players have",
    );
  }

  const ok = !issues.some(isErrorIssue) && (swaps?.ok ?? true);
  const head = `Checked ${input.project} ${scene} (${shortId(id)}): ${formatBytes(dataBytes)} of data, ${plural(newFiles, release ? "new file" : "file")}.`;
  return {
    exitCode: ok ? 0 : 1,
    data: {
      ok,
      project: input.project,
      scene,
      id,
      dataBytes,
      newFiles,
      timing: { wanted: "now", timing, clamped },
      ...(release ? { against: { release: release.id, file: release.file } } : {}),
      ...(base ? { from: base.name } : {}),
      ...(diff ? { diff } : {}),
      swapCheck: swaps,
      ...(swapSkipped ? { swapSkipped } : {}),
      warnings,
      issues,
    },
    text: [
      head,
      ...lines,
      ...issues.map(issueLine),
      ...warnings.map((w) => amber(`warning: ${w}`, env)),
    ].join("\n"),
  };
}

/**
 * The swap check from `base` to the built version: the scene's input
 * scripts played on what players have, this version swapped in at points
 * along each, with the scene's checks. `issues` are the scripts that don't
 * read; `lines` are the `Swaps:` line and what failed.
 */
async function swapsFrom(
  built: Built,
  base: Base,
  scene: string,
  ctx: ToolContext,
): Promise<{ report: SwapCheckReport; lines: string[]; issues: SceneIssue[] } | ToolResult> {
  const { version, id, texts } = built;
  const project = await projectRuntime(built.handle, built.input.registry);
  const found = scriptsOf(built.input, scene, project.inputMap?.players);
  const checks = await checksOf(built, scene);
  if (isToolResult(checks)) return checks;
  const rapier =
    base.physics === "rapier" || version.entry.physics === "rapier" ? await ctx.loadRapier() : null;
  const report = swapCheck({
    game: built.input.game,
    registry: built.input.registry,
    from: base.from,
    to: { id, version, texts },
    scripts: found.scripts,
    ...(checks ? { checks } : {}),
    rapier,
    project,
  });
  return {
    report,
    lines: swapText(
      report,
      found.scripts.map((s) => s.name),
    ),
    issues: found.issues,
  };
}

/** The scene's `.checks.json` beside its file, as the swap check runs it; null without one. */
async function checksOf(
  built: Built,
  scene: string,
): Promise<NonNullable<SwapCheckOptions["checks"]> | ToolResult | null> {
  const entry = built.input.view.byId.get(scene);
  if (!entry) return null;
  return readChecksFile(checksPathOf(join(built.handle.dir, entry.path)), built.input.registry, {
    scene,
  });
}

// ─── Publishing ──────────────────────────────────────────

/** `engineLive.base` as the route sends it: the channel's release and the scene as players have it now. */
type LiveBaseAnswer = {
  channel: "preview" | "production";
  release: { id: Sha256; version: number; manifest: string } | null;
  live: {
    number: number;
    versionId: Sha256;
    timing: SwapTiming;
    since: string;
    descriptor: string;
  } | null;
  texts: Record<Sha256, string>;
  latest: number | null;
};

type LiveBeginAnswer = {
  uploadId: string;
  versionId: Sha256;
  number: number | null;
  missing: MissingUpload[];
  issues: SceneIssue[];
  usage: { before: UsageLine[]; after: UsageLine[] };
};

type LiveCommitAnswer = {
  versionId: Sha256;
  scene: string;
  number: number;
  created: boolean;
  liveOn: "preview" | null;
};

const timingOf = (value: string | undefined): SwapTiming | null =>
  SWAP_TIMINGS.find((t) => t === value) ?? null;

/**
 * Production is refused here, before any request, with the site's own
 * refusal: agent tokens act on preview only, and a person moves production
 * on the game's page.
 */
function productionRefused({ site, projectId }: Access): ToolResult {
  const gamePage = gamePageOf(site, projectId);
  const refusal = refusalFor("agent", "live-move-production", { gameUrl: gamePage });
  if (!refusal) throw new Error("an agent token may move production");
  return refusalResult(new ReleaseApiFailure(403, refusal), { project: projectId, gamePage });
}

/** `--channel` for a move: preview, production refused here, anything else usage. */
function moveChannel(access: Access, channel: string | undefined, cmdUsage: string) {
  if (channel === "production") return productionRefused(access);
  return channel === "preview" ? null : usage(cmdUsage);
}

/**
 * The scene as players have it on the base's channel: the live version's,
 * else the release's own. Texts whose hash doesn't match are left out, so
 * a scene they'd carry reads as missing. Null when the channel has nothing.
 */
async function siteBase(
  answer: LiveBaseAnswer,
  manifest: ReleaseManifest | undefined,
  built: Built,
  scene: string,
): Promise<Base | { issues: SceneIssue[] } | { skip: string } | null> {
  const texts = new Map<Sha256, string>();
  for (const [hash, text] of Object.entries(answer.texts))
    if ((await sha256(text)) === hash) texts.set(hash, text);
  if (answer.live) {
    const parsed = parseSceneVersion(answer.live.descriptor);
    if (!parsed.ok) return { issues: parsed.issues };
    const read = readSceneVersion(parsed.version, texts, built.input.registry, built.input.game, {
      engine: built.input.engine,
    });
    if (!read.ok) return { issues: read.issues };
    return {
      name: sceneVersionName(scene, answer.live.number),
      from: { id: answer.live.versionId, version: parsed.version, texts },
      scene: read.scene,
      physics: parsed.version.entry.physics,
    };
  }
  if (!answer.release || !manifest) return null;
  return releaseBaseOf(manifest, texts, built.input, scene, `v${answer.release.version}`);
}

/** `6 of 100 scene versions · release storage 124 MB of 512 MB`, from the usage after the upload. */
function todayOf(after: readonly UsageLine[]) {
  const versions = after.find((l) => l.quota === "liveVersionsPerDay");
  const storage = after.find((l) => l.quota === "releaseStorageBytes");
  const parts = [
    ...(versions
      ? [`${formatCount(versions.used)} of ${formatCount(versions.max)} scene versions`]
      : []),
    ...(storage
      ? [
          `${quotaLabel(storage.quota)} ${quotaAmount(storage.quota, storage.used)} of ${quotaAmount(storage.quota, storage.max)}`,
        ]
      : []),
  ];
  return {
    data: {
      versions: versions ? { used: versions.used, max: versions.max } : null,
      releaseStorage: storage ? { used: storage.used, max: storage.max } : null,
    },
    text: parts.join(" · "),
  };
}

/**
 * Builds one scene's version as `game live build` does (the files, or the
 * hosted project with `--hosted`) and publishes it to the hosted project:
 * checked against the channel's release, swap-checked from what players
 * have there before a `boundary` or `now` move unless `--no-swap-check`,
 * then begin, the texts the site doesn't hold, and commit. On preview
 * unless `--channel none`; production is refused here, since a person
 * moves it on the game's page. Prints the version, its size and new
 * files, the release it fits, the changes, the swap check and today's
 * usage, with a `warning:` line for each quota at or over 80% and for a
 * clamped timing.
 */
export async function gameLivePublish(
  input: GameLivePublishInput,
  ctx: ToolContext,
  deps: GameLiveDeps = {},
): Promise<ToolResult> {
  if (!input.project || !input.scene) return usage(GAME_LIVE_PUBLISH_USAGE);
  const access = accessFor(input, ctx, GAME_LIVE_PUBLISH_USAGE);
  if (isToolResult(access)) return access;
  const { site, projectId } = access;
  const { scene } = input;
  const channel = input.channel ?? "preview";
  if (channel === "production") return productionRefused(access);
  if (channel !== "preview" && channel !== "none") return usage(GAME_LIVE_PUBLISH_USAGE);
  const wanted = input.timing === undefined ? "next-load" : timingOf(input.timing);
  if (!wanted) return usage(GAME_LIVE_PUBLISH_USAGE);
  const env = ctx.env ?? process.env;
  const cmd = "game live publish";

  const temps: string[] = [];
  try {
    const source = await sourceOf(
      { ...input, url: site.origin },
      ctx,
      deps,
      temps,
      GAME_LIVE_PUBLISH_USAGE,
      cmd,
    );
    if (isToolResult(source)) return source;

    // What the site checks it against: preview's release, or with `none` production's.
    const baseChannel = channel === "preview" ? "preview" : "production";
    const answer = await call<LiveBaseAnswer>(
      site,
      engineLiveBasePath(projectId, scene, baseChannel),
    );
    let manifest: ReleaseManifest | undefined;
    if (answer.release) {
      const parsed = parseReleaseManifest(answer.release.manifest);
      if (!parsed.ok)
        return failure(`${baseChannel}'s release v${answer.release.version} doesn't read`, {
          issues: parsed.issues,
        });
      manifest = parsed.manifest;
    }

    const built = await buildFrom(source.handle, scene, cmd, manifest);
    if (isToolResult(built)) return built;
    const { version, id, texts } = built;
    const game = built.input.game;
    const issues = [...built.issues];
    const warnings: string[] = [];
    const lines: string[] = [];
    const { timing, clamped } = clampTiming(game.live, wanted);
    const moves = channel === "preview";
    if (moves && clamped) warnings.push(clampedWarning(game, scene));

    const fits = answer.release
      ? `v${answer.release.version} (${baseChannel})`
      : "the newest release";
    lines.push(`  Fits:     ${fits}${moves ? ` · timing: ${timingWords(timing)}` : ""}`);

    const base = await siteBase(answer, manifest, built, scene);
    let swapSkipped: string | null = null;
    if (base && "issues" in base) issues.push(...base.issues);
    else if (base && "skip" in base) swapSkipped = base.skip;
    const from = base && "scene" in base ? base : null;

    const to = readSceneVersion(version, texts, built.input.registry, game, {
      engine: built.input.engine,
    });
    if (!to.ok) issues.push(...to.issues);
    let diff: ReturnType<typeof diffExpanded> | null = null;
    let strategy: SwapStrategy | null = null;
    if (from && to.ok) {
      diff = diffExpanded(from.scene, to.scene);
      strategy = swapStrategyFor(diff);
      lines.push(`  Changes:  ${changesText(diff, strategy)}`);
    }

    let swaps: SwapCheckReport | null = null;
    if (moves && timing !== "next-load") {
      if (input.noSwapCheck) swapSkipped = "--no-swap-check";
      else if (from && to.ok && !issues.some(isErrorIssue)) {
        const ran = await swapsFrom(built, from, scene, ctx);
        if (isToolResult(ran)) return ran;
        issues.push(...ran.issues);
        swaps = ran.report;
        lines.push(...ran.lines);
      } else swapSkipped ??= `${baseChannel} has no release to swap from`;
      if (!swaps && swapSkipped) lines.push(`  Swaps:    not checked: ${swapSkipped}`);
    }

    const { versionText, dataBytes } = sizesOf(built);
    const checked = {
      project: projectId,
      scene,
      id,
      channel,
      timing: { wanted, timing, clamped },
      dataBytes,
      fits: {
        channel: baseChannel,
        release: answer.release ? { id: answer.release.id, version: answer.release.version } : null,
      },
      ...(from ? { from: from.name } : {}),
      diff,
      strategy,
      swapCheck: swaps,
      ...(swapSkipped ? { swapSkipped } : {}),
    };
    if (issues.some(isErrorIssue) || (swaps && !swaps.ok)) {
      const why = swaps && !swaps.ok ? "the swap check failed" : "it doesn't check";
      return {
        exitCode: 1,
        data: { ok: false, ...checked, warnings, issues },
        text: [
          `${projectId} ${scene} (${shortId(id)}) wasn't published: ${why}.`,
          ...lines,
          ...issues.map(issueLine),
          ...warnings.map((w) => amber(`warning: ${w}`, env)),
        ].join("\n"),
      };
    }

    const { first, committed, sent } = await sendUpload<
      MissingUpload,
      LiveBeginAnswer,
      LiveCommitAnswer
    >(
      site,
      {
        begin: () =>
          postJson<LiveBeginAnswer>(
            site,
            engineLivePath(projectId),
            {
              version: versionText,
              channel,
              ...(moves ? { timing } : {}),
              ...(input.note !== undefined ? { note: input.note } : {}),
            },
            BEGIN_TIMEOUT_MS,
          ),
        read: async (file) => {
          const text = texts.get(file.sha256);
          if (text === undefined)
            throw new Error(
              `the site asked for ${file.sha256}, which ${scene}'s version doesn't carry`,
            );
          return new TextEncoder().encode(text);
        },
        commit: (uploadId) =>
          postJson<LiveCommitAnswer>(site, engineLiveCommitPath(projectId), { uploadId }),
      },
      deps,
    );

    const name = sceneVersionName(scene, committed.number);
    const today = todayOf(first.usage.after);
    if (today.text) lines.push(`  Today:    ${today.text}`);
    const quotaLines = quotaWarnings(first.usage.after);
    const gamePage = gamePageOf(site, projectId);
    const newFiles = first.missing.length;
    const where = committed.liveOn === "preview" ? " to preview" : "";
    const size = `${formatBytes(dataBytes)} of data, ${plural(newFiles, "new file")}`;
    const head = committed.created
      ? `Published ${projectId} ${name} (${shortId(committed.versionId)})${where}: ${size}.`
      : `${projectId} ${name} (${shortId(committed.versionId)}) was published already${committed.liveOn ? "; preview names it" : ""}: ${size}.`;
    const next =
      committed.liveOn === "preview"
        ? `Put it on production on the game's page: ${gamePage}`
        : `Put it on preview with vp run scene game live promote ${projectId} ${scene} ${committed.number} --channel preview, or on production on the game's page: ${gamePage}`;
    const allWarnings = [...warnings.map((w) => `warning: ${w}`), ...quotaLines];

    return {
      exitCode: 0,
      data: {
        ok: true,
        ...checked,
        name,
        number: committed.number,
        versionId: committed.versionId,
        created: committed.created,
        liveOn: committed.liveOn,
        newFiles,
        uploaded: sent,
        today: today.data,
        usage: first.usage,
        gamePage,
        warnings: allWarnings,
        issues,
      },
      text: [
        head,
        ...lines,
        next,
        ...issues.map(issueLine),
        ...allWarnings.map((w) => amber(w, env)),
      ].join("\n"),
    };
  } catch (error) {
    return answerFailure(error, { project: projectId, scene });
  } finally {
    for (const dir of temps) await rm(dir, { recursive: true, force: true });
  }
}

// ─── The list and the pointers ───────────────────────────

/** A scene version as the list route sends it: `live-versions.ts`'s `SceneVersionSummary`, its dates as ISO text. */
export type SceneVersionListEntry = {
  scene: string;
  number: number;
  id: Sha256;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
  physics: "rapier" | "none";
  dataBytes: number;
  compatKey: Sha256;
  baseReleaseId: Sha256 | null;
  pointers: {
    channel: "preview" | "production";
    timing: SwapTiming;
    since: string;
    by: string | null;
  }[];
  blocked: { at: string; by: "system" | "user"; reason: string | null } | null;
  hidden: { at: string; reason: string | null } | null;
  collectedAt: string | null;
  reports: { ok: number; failed: number };
  removalAt: string | null;
};

/** The hosted project's scene versions (one scene's with `<scene>`), newest first: size, where each is live, its state and note. */
export async function gameLiveList(
  input: GameLiveListInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const access = accessFor(input, ctx, GAME_LIVE_LIST_USAGE);
  if (isToolResult(access)) return access;
  const { site, projectId } = access;
  let versions: SceneVersionListEntry[];
  try {
    ({ versions } = await call<{ versions: SceneVersionListEntry[] }>(
      site,
      engineLivePath(projectId, input.scene),
    ));
  } catch (error) {
    return answerFailure(error, { project: projectId });
  }
  const what = input.scene === undefined ? projectId : `${projectId} ${input.scene}`;
  const lines = versions.map((v) =>
    [
      `  ${sceneVersionName(v.scene, v.number)}`,
      shortId(v.id),
      formatBytes(v.dataBytes),
      v.pointers.length > 0
        ? v.pointers.map((p) => `${p.channel} (${timingWords(p.timing)})`).join(", ")
        : "-",
      keptState(v),
      ...(v.note ? [JSON.stringify(v.note)] : []),
    ].join("  "),
  );
  return {
    exitCode: 0,
    data: {
      ok: true,
      project: projectId,
      ...(input.scene !== undefined ? { scene: input.scene } : {}),
      versions,
      gamePage: gamePageOf(site, projectId),
    },
    text:
      versions.length === 0
        ? `${what}: no scene versions yet; publish one with vp run scene game live publish ${projectId} ${input.scene ?? "<scene>"}`
        : [`${what}: ${plural(versions.length, "scene version")}`, ...lines].join("\n"),
  };
}

/** The game the CLI's own project of this id declares, to clamp a timing by; null when the CLI has none. */
function localGame(ctx: ToolContext, projectId: string): GameDefinition | null {
  try {
    return hostedCodeProject(ctx.projects, projectId, ctx.project).game;
  } catch (e) {
    if (e instanceof ProjectClientError) return null;
    throw e;
  }
}

/** A move's answer, with where the channel plays. */
function movedScene(
  access: Access,
  scene: string,
  text: string,
  data: Record<string, unknown>,
  warnings: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ToolResult {
  const playUrl = channelPlayUrl(access.site, access.projectId, "preview");
  return {
    exitCode: 0,
    data: {
      ok: true,
      project: access.projectId,
      scene,
      channel: "preview",
      ...data,
      playUrl,
      warnings: warnings.map((w) => `warning: ${w}`),
    },
    text: [
      `${access.projectId} ${scene}: ${text}`,
      `  Play:     ${playUrl}`,
      ...warnings.map((w) => amber(`warning: ${w}`, env)),
    ].join("\n"),
  };
}

const wasOf = (scene: string, from: number | null) =>
  from === null ? "the release's scene" : sceneVersionName(scene, from);

/** Points the hosted project's preview at version `<n>` of a scene; production is refused here. */
export async function gameLivePromote(
  input: GameLiveMoveInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const access = accessFor(input, ctx, GAME_LIVE_PROMOTE_USAGE);
  if (isToolResult(access)) return access;
  const number = Number(input.number);
  if (!input.scene || input.number === undefined || !Number.isSafeInteger(number) || number < 1)
    return usage(GAME_LIVE_PROMOTE_USAGE);
  const refused = moveChannel(access, input.channel, GAME_LIVE_PROMOTE_USAGE);
  if (refused) return refused;
  const wanted = input.timing === undefined ? "next-load" : timingOf(input.timing);
  if (!wanted) return usage(GAME_LIVE_PROMOTE_USAGE);
  const { site, projectId } = access;
  const { scene } = input;
  const game = localGame(ctx, projectId);
  const { timing, clamped } = game
    ? clampTiming(game.live, wanted)
    : { timing: wanted, clamped: false };
  try {
    const answer = await postJson<{ from: number | null; to: number; timing: SwapTiming }>(
      site,
      engineLivePromotePath(projectId, scene, number),
      { channel: "preview", timing },
    );
    return movedScene(
      access,
      scene,
      `preview now plays ${sceneVersionName(scene, answer.to)} (was ${wasOf(scene, answer.from)}) · timing: ${timingWords(answer.timing)}`,
      { from: answer.from, to: answer.to, timing: { wanted, timing: answer.timing, clamped } },
      game && clamped ? [clampedWarning(game, scene)] : [],
      ctx.env ?? process.env,
    );
  } catch (error) {
    return answerFailure(error, { project: projectId, scene });
  }
}

/** Points the hosted project's preview back at the scene's previous version, or the release's scene. */
export async function gameLiveRollback(
  input: GameLiveMoveInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const access = accessFor(input, ctx, GAME_LIVE_ROLLBACK_USAGE);
  if (isToolResult(access)) return access;
  if (!input.scene) return usage(GAME_LIVE_ROLLBACK_USAGE);
  const refused = moveChannel(access, input.channel, GAME_LIVE_ROLLBACK_USAGE);
  if (refused) return refused;
  const { scene } = input;
  try {
    const answer = await postJson<{ from: number | null; to: number | null }>(
      access.site,
      engineLiveMovePath(access.projectId, scene, "rollback"),
      { channel: "preview" },
    );
    return movedScene(
      access,
      scene,
      `preview rolled back to ${wasOf(scene, answer.to)} (was ${wasOf(scene, answer.from)}) · timing: next load`,
      { from: answer.from, to: answer.to },
      [],
      ctx.env ?? process.env,
    );
  } catch (error) {
    return answerFailure(error, { project: access.projectId, scene });
  }
}

/** "Stop": the hosted project's preview plays the release's own scene again. */
export async function gameLiveClear(
  input: GameLiveMoveInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const access = accessFor(input, ctx, GAME_LIVE_CLEAR_USAGE);
  if (isToolResult(access)) return access;
  if (!input.scene) return usage(GAME_LIVE_CLEAR_USAGE);
  const refused = moveChannel(access, input.channel, GAME_LIVE_CLEAR_USAGE);
  if (refused) return refused;
  const { scene } = input;
  try {
    const answer = await postJson<{ from: number }>(
      access.site,
      engineLiveMovePath(access.projectId, scene, "clear"),
      { channel: "preview" },
    );
    return movedScene(
      access,
      scene,
      `preview stopped ${sceneVersionName(scene, answer.from)}; players get the release's scene at their next load`,
      { from: answer.from, to: null },
      [],
      ctx.env ?? process.env,
    );
  } catch (error) {
    return answerFailure(error, { project: access.projectId, scene });
  }
}
