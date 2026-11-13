import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  swapStrategyFor,
  timingWords,
  utf8Bytes,
  versionName,
  type StagedVersion,
} from "@jams/engine";
import type { ExportInput } from "@jams/engine/export";
import { clampTiming, type SwapStrategy } from "@jams/engine/game";
import { swapCheck, type SwapCheckOptions, type SwapCheckReport } from "@jams/engine/headless";
import {
  buildSceneVersion,
  formatBytes,
  formatSceneVersion,
  inputScriptKind,
  liveCompat,
  prefabKind,
  readSceneVersion,
  releaseId,
  SCENE_KIND_NAME,
  type ReleaseManifest,
  type SceneVersion,
  type Sha256,
} from "@jams/engine/project";
import {
  checksPathOf,
  closest,
  diffExpanded,
  liveIssue,
  makeIssue,
  parseChecks,
  parseInputScript,
  type ExpandedScene,
  type PrefabLibrary,
  type SceneDefinition,
  type SceneIssue,
} from "@jams/engine/scene";

import {
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
import { agentSiteFrom, AGENT_SITE_ENV, isHostedUrl } from "../hosted";
import { hostedCodeProject, ProjectClientError } from "../project-client";
import {
  projectById,
  projectRuntime,
  unknownProjectMessage,
  type ProjectHandle,
} from "../projects";
import { checksFileLines } from "./check";
import { clearOut, exportInputOf } from "./game-build";
import { readReleaseAt, shownPath } from "./game-manifest";
import { projectPull, type ProjectPullInput } from "./project-pull";
import { readVersionAt, SCENE_VERSION_FILE } from "./replay";

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

/** What `build --hosted` runs besides the build: the pull. */
export type GameLiveDeps = { pull?: Tool<ProjectPullInput> };

export const GAME_LIVE_BUILD_USAGE =
  "game live build <project> <scene> [--hosted] [--out <dir>] [--json]";
export const GAME_LIVE_CHECK_USAGE =
  "game live check <project> <scene> [--against <release dir|release.json>] [--from <version dir>] [--json]";

/** Where `game live build` writes when `--out` is left out, relative to the working directory. */
export const defaultLiveOut = (project: string, scene: string) =>
  join("dist", "live", project, scene);

const isError = (i: SceneIssue) => i.severity === "error";

/** Amber on a terminal that takes colour; plain everywhere else (pipes, `--json`, MCP). */
export function amber(text: string, env: Readonly<Record<string, string | undefined>>): string {
  return process.stdout.isTTY && env.NO_COLOR === undefined ? `\x1b[33m${text}\x1b[0m` : text;
}

/**
 * A copy of `local`'s files with the hosted project's docs and blobs pulled
 * over them, in a dot directory beside the project so the game code's
 * relative imports and package resolution reach what they reach from the
 * checkout. The caller removes `dir`.
 */
export async function hostedProjectCopy(
  local: ProjectHandle,
  site: string,
  token: string | undefined,
  ctx: ToolContext,
  pull: Tool<ProjectPullInput> = projectPull,
  label = "hosted",
): Promise<{ dir: string } | { dir: string; result: ToolResult }> {
  const dir = await mkdtemp(join(dirname(local.dir), `.${basename(local.dir)}-${label}-`));
  await cp(local.dir, dir, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      return (
        src === local.dir || !(name === "node_modules" || name === "dist" || name.startsWith("."))
      );
    },
  });
  const pulled = await pull(
    { id: local.file.id, url: site, out: dir, ...(token === undefined ? {} : { token }) },
    ctx,
  );
  return pulled.exitCode === 0 ? { dir } : { dir, result: pulled };
}

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
  const built = await buildSceneVersion({
    view: input.view,
    texts: input.texts,
    build: input.snapshot.build,
    game: input.game,
    registry: input.registry,
    scene,
    ...(release ? { release } : {}),
  });
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

/** The version file's text and size, and every carried text's. */
function sizesOf(built: Pick<Built, "version" | "texts">) {
  const versionText = formatSceneVersion(built.version);
  const texts = [...built.texts].map(([sha, text]) => ({ sha256: sha, bytes: utf8Bytes(text) }));
  const dataBytes = utf8Bytes(versionText) + texts.reduce((n, t) => n + t.bytes, 0);
  return { versionText, texts, dataBytes };
}

/** The ids of the version's carried assets, by the hash of their text. */
function idsByHash(version: SceneVersion): Map<Sha256, string> {
  const ids = new Map<Sha256, string>();
  for (const [id, a] of Object.entries(version.assets))
    if (a.storage === "doc") ids.set(a.sha256, id);
  return ids;
}

/** The project `id` names, or the usage error listing the projects. */
function projectFor(ctx: ToolContext, id: string): ProjectHandle | ToolResult {
  return projectById(ctx.projects, id) ?? usage(unknownProjectMessage(ctx.projects, id));
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
    let handle: ProjectHandle | ToolResult;
    let from = "files";
    if (input.hosted) {
      const env = ctx.env ?? process.env;
      const site = input.url ?? agentSiteFrom(env);
      if (!site)
        return usage(`${GAME_LIVE_BUILD_USAGE}\n  --hosted needs the site in ${AGENT_SITE_ENV}`);
      if (!isHostedUrl(site)) return usage("the site hosting the project is https://…");
      let local: ProjectHandle;
      try {
        local = hostedCodeProject(ctx.projects, input.project, ctx.project);
      } catch (e) {
        if (e instanceof ProjectClientError)
          return e.exitCode === 2 ? usage(e.message) : failure(e.message);
        throw e;
      }
      const copy = await hostedProjectCopy(local, site, input.token, ctx, deps.pull, "live");
      temps.push(copy.dir);
      if ("result" in copy) return copy.result;
      handle = { ...local, dir: copy.dir };
      from = new URL(site).origin;
    } else handle = projectFor(ctx, input.project);
    if (isToolResult(handle)) return handle;

    const built = await buildFrom(handle, input.scene, "game live build");
    if (isToolResult(built)) return built;
    const { version, id } = built;
    const out = resolve(input.out ?? defaultLiveOut(input.project, input.scene));
    const cleared = await clearOut(out, SCENE_VERSION_FILE, "version");
    if (cleared) return cleared;
    await mkdir(out, { recursive: true });
    const { versionText, texts, dataBytes } = sizesOf(built);
    await writeFile(join(out, SCENE_VERSION_FILE), versionText);
    for (const [sha, text] of built.texts) await writeFile(join(out, `${sha}.json`), text);

    const ids = idsByHash(version);
    const files: { file: string; bytes: number; asset?: string }[] = [
      { file: SCENE_VERSION_FILE, bytes: utf8Bytes(versionText) },
      ...texts.map((t) => ({
        file: `${t.sha256}.json`,
        bytes: t.bytes,
        ...(ids.has(t.sha256) ? { asset: ids.get(t.sha256)! } : {}),
      })),
    ];
    const blobs = Object.values(version.assets).filter((a) => a.storage === "blob").length;
    const ok = !built.issues.some(isError);
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
 * The release's own scene, read as a version the release carries, so the
 * one reader (`readSceneVersion`) parses, validates and expands it against
 * the release's assets. `skip` says why there is none to swap from.
 */
async function releaseBase(
  manifest: ReleaseManifest,
  dir: string,
  input: ExportInput,
  scene: string,
  name: string,
): Promise<Base | { issues: SceneIssue[] } | { skip: string }> {
  const entry = manifest.flow.scenes.find((s) => s.id === scene);
  if (!entry) return { skip: `${name} doesn't list ${scene}` };
  const texts = new Map<Sha256, string>();
  for (const a of Object.values(manifest.assets)) {
    if (a.storage !== "doc" || (a.kind !== SCENE_KIND_NAME && a.kind !== prefabKind.kind)) continue;
    try {
      texts.set(a.sha256, await readFile(join(dir, a.file), "utf8"));
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
    }
  }
  const own = manifest.assets[scene];
  if (!own || !texts.has(own.sha256))
    return { skip: `${name}'s files aren't beside it (${own?.file ?? scene} is missing)` };
  const asVersion: SceneVersion = {
    kind: "scene-version",
    v: 1,
    project: manifest.project.id,
    scene,
    compat: liveCompat(manifest),
    engine: manifest.engine.version,
    base: null,
    entry,
    sceneHash: "0".repeat(16),
    assets: manifest.assets,
  };
  const read = readSceneVersion(asVersion, texts, input.registry, input.game, {
    engine: input.engine,
  });
  if (!read.ok) return { issues: read.issues };
  return {
    name,
    from: { def: read.def, prefabs: read.prefabs },
    scene: read.scene,
    physics: entry.physics,
  };
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
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
      issues.push(
        makeIssue("schema", {
          message: `${entry.path} doesn't read: ${parsed.issues.map((i) => `${i.path || "/"} ${i.message}`).join("; ")}`,
          entityIds: [entry.id],
        }),
      );
  }
  return { scripts, issues };
}

/** `12 changed, 3 added, 1 removed (players' worlds update in place)`. */
function changesText(diff: ReturnType<typeof diffExpanded>, strategy: SwapStrategy): string {
  const parts = [
    ...(diff.changed.length > 0 ? [`${diff.changed.length} changed`] : []),
    ...(diff.added.length > 0 ? [`${diff.added.length} added`] : []),
    ...(diff.removed.length > 0 ? [`${diff.removed.length} removed`] : []),
    ...(diff.header ? ["the scene's header changed"] : []),
  ];
  const how = strategy === "reload" ? "players' worlds reload" : "players' worlds update in place";
  return `${parts.length > 0 ? parts.join(", ") : "nothing changed"} (${how})`;
}

/** `3 runs over level-1.script.json passed; checks 4 passed` and the issues under it. */
function swapText(report: SwapCheckReport, scripts: readonly string[]): string[] {
  const failed = report.runs.filter((r) => r.issues.some(isError));
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
  const handle = projectFor(ctx, input.project);
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
  if (clamped)
    warnings.push(
      liveIssue({
        code: "live-timing-unsupported",
        version: scene,
        accepted: game.live?.timings ?? [],
      }).message,
    );

  if (release) {
    // A build stops on its own errors, so an error here is the release check's.
    const fits = issues.some(isError) ? "doesn't fit " : "";
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
      const project = await projectRuntime(built.handle, built.input.registry);
      const found = scriptsOf(built.input, scene, project.inputMap?.players);
      issues.push(...found.issues);
      const checks = await checksOf(built, scene);
      if (isToolResult(checks)) return checks;
      const rapier =
        base.physics === "rapier" || version.entry.physics === "rapier"
          ? await ctx.loadRapier()
          : null;
      swaps = swapCheck({
        game,
        registry: built.input.registry,
        from: base.from,
        to: { id, version, texts },
        scripts: found.scripts,
        ...(checks ? { checks } : {}),
        rapier,
        project,
      });
      lines.push(
        ...swapText(
          swaps,
          found.scripts.map((s) => s.name),
        ),
      );
    }
  } else if (input.from === undefined && !release) {
    warnings.push(
      "only validated: pass --against <release dir|release.json> to check it fits a release, or --from <version dir> to check the swap from the version players have",
    );
  }

  const ok = !issues.some(isError) && (swaps?.ok ?? true);
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

/** The scene's `.checks.json` beside its file, as the swap check runs it; null without one. */
async function checksOf(
  built: Built,
  scene: string,
): Promise<NonNullable<SwapCheckOptions["checks"]> | ToolResult | null> {
  const entry = built.input.view.byId.get(scene);
  if (!entry) return null;
  const file = checksPathOf(join(built.handle.dir, entry.path));
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw e;
  }
  const parsed = parseChecks(text, built.input.registry);
  if (!parsed.ok)
    return {
      exitCode: 1,
      data: { ok: false, scene, checks: file, issues: parsed.issues },
      text: checksFileLines(shownPath(file), parsed.issues).join("\n"),
    };
  const dir = dirname(file);
  return { file: parsed.file, readFile: (path) => readFileSync(resolve(dir, path), "utf8") };
}
