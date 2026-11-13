import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { StagedVersion } from "@jams/engine";
import {
  parseRecording,
  replayRecording,
  type RecordingPlatform,
  type ReplayReport,
  type RunRecording,
} from "@jams/engine/headless";
import {
  byCodeUnit,
  findSceneVersion,
  parseSceneVersion,
  sceneVersionId,
  sha256,
  type Sha256,
} from "@jams/engine/project";

import {
  failure,
  gameFlag,
  isToolResult,
  issueLine,
  openScene,
  readArg,
  usage,
  UsageError,
  type Tool,
} from "../context";
import { projectRuntime } from "../projects";
import { blockedText, projectRef } from "./playtest";
import { projectSaveFixtures } from "./save";
import { rapierFor, rounded } from "./step";

export type ReplayInput = {
  scene?: string;
  run?: string;
  game?: string;
  /** A directory of scene versions and the texts they carry, for a run that swapped versions in. */
  versions?: string;
};

const USAGE =
  "replay <scene|file|-> --run <file|-> [--game id] [--releases <dir>] [--versions <dir>]";

/** The file `game live build` writes a version to. */
export const SCENE_VERSION_FILE = "scene-version.json";

const TEXT_FILE = /^([0-9a-f]{64})\.json$/;

/** Versions read from files, and the files that couldn't be read as what their name or `kind` says. */
export type VersionFiles = { versions: StagedVersion[]; problems: string[] };

async function jsonFilesIn(dir: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(dir, { recursive, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => join(e.parentPath, e.name))
    .sort(byCodeUnit);
}

/**
 * Every scene version under `dir` (a JSON file whose `kind` is
 * "scene-version", as `game live build` writes `scene-version.json`) with
 * the texts it carries, read from the `<sha256>.json` files beside it or
 * anywhere under `dir` when `recursive`. A text whose content doesn't hash
 * to its name, or a version that doesn't parse, is a problem and is left out.
 */
export async function readVersionFiles(
  dir: string,
  opts: { recursive: boolean },
): Promise<VersionFiles> {
  const problems: string[] = [];
  const texts = new Map<Sha256, string>();
  const read: { file: string; text: string }[] = [];
  for (const file of await jsonFilesIn(dir, opts.recursive)) {
    const text = await readFile(file, "utf8");
    const named = TEXT_FILE.exec(basename(file))?.[1];
    if (named !== undefined) {
      if ((await sha256(text)) === named) texts.set(named, text);
      else problems.push(`${file}: its content doesn't hash to its name`);
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      continue;
    }
    if (isRecord(raw) && raw.kind === "scene-version") read.push({ file, text });
  }
  const versions: StagedVersion[] = [];
  for (const { file, text } of read) {
    const parsed = parseSceneVersion(text);
    if (!parsed.ok) {
      problems.push(`${file}: ${parsed.issues.map((i) => i.message).join("; ")}`);
      continue;
    }
    const { version } = parsed;
    const carried = new Map<Sha256, string>();
    for (const asset of Object.values(version.assets)) {
      const t = asset.storage === "doc" ? texts.get(asset.sha256) : undefined;
      if (t !== undefined) carried.set(asset.sha256, t);
    }
    versions.push({ id: await sceneVersionId(version), version, texts: carried });
  }
  return { versions, problems };
}

/**
 * The one version at `path`: a version file, or a directory holding
 * `scene-version.json` (or exactly one version), with its texts beside it.
 */
export async function readVersionAt(
  path: string,
): Promise<{ ok: true; staged: StagedVersion; problems: string[] } | { ok: false; error: string }> {
  let dir = path;
  let file: string | null = null;
  try {
    if (!(await stat(path)).isDirectory()) {
      dir = dirname(path);
      file = path;
    }
  } catch (e) {
    if (isMissing(e)) return { ok: false, error: `Not found: ${path}.` };
    throw e;
  }
  const { versions, problems } = await readVersionFiles(dir, { recursive: false });
  let staged: StagedVersion | undefined;
  if (file !== null) {
    const parsed = parseSceneVersion(await readFile(file, "utf8"));
    if (!parsed.ok)
      return {
        ok: false,
        error: `${path} isn't a scene version: ${parsed.issues.map((i) => i.message).join("; ")}`,
      };
    staged = findSceneVersion(await sceneVersionId(parsed.version), versions) ?? undefined;
  } else {
    const own = join(dir, SCENE_VERSION_FILE);
    const ownText = await readFile(own, "utf8").catch((e: unknown) => {
      if (isMissing(e)) return null;
      throw e;
    });
    const ownParsed = ownText === null ? null : parseSceneVersion(ownText);
    if (ownParsed?.ok)
      staged = findSceneVersion(await sceneVersionId(ownParsed.version), versions) ?? undefined;
    else if (ownText === null && versions.length === 1) staged = versions[0];
  }
  if (!staged)
    return {
      ok: false,
      error:
        problems.length > 0
          ? `${path} holds no scene version that reads: ${problems.join("; ")}`
          : `${path} holds no ${SCENE_VERSION_FILE}`,
    };
  return { ok: true, staged, problems };
}

const isMissing = (e: unknown) => (e as { code?: string }).code === "ENOENT";

/** `level-1@9a3f12a4b5c6`: a version as a line names it. */
export const versionName = (scene: string, id: Sha256) => `${scene}@${id.slice(0, 12)}`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Where and on what a recording was made, as its file says. */
export type Recorded = Pick<RunRecording, "engine" | "platform">;

/** `arm64, node 22.1.0, rapier2d-compat`; a platform a v1 recording never named reads `unknown`. */
const platformText = (p: RecordingPlatform) =>
  p.arch === "unknown" && p.runtime === "unknown"
    ? "unknown"
    : [p.arch, p.runtime, ...(p.flavour ? [p.flavour] : [])].join(", ");

/** A replay's text: how it ended, what it was recorded on, its warnings and issues. */
export function replayText(scene: string, r: ReplayReport, recorded: Recorded | null): string {
  const o = r.recording.outcome;
  return [
    `${scene}: ${r.matches ? "replays" : "diverges"}: ${o.result} at t${o.tick} (${r.recording.ticks} ticks)${r.divergence ? `: ${r.divergence}` : ""}`,
    ...(recorded
      ? [
          `  recorded on engine ${recorded.engine.version}, physics ${recorded.engine.physics ?? "none"}${r.migratedFrom === undefined ? "" : `; migratedFrom ${r.migratedFrom}`}`,
          `  platform recorded ${platformText(recorded.platform)}; replayed ${platformText(r.recording.platform)}`,
        ]
      : []),
    ...(r.recording.swaps ?? []).map(
      (w) =>
        `  swap t${w.tick} to ${w.version === null ? "the release's scene" : versionName(r.recording.scene, w.version)} (${w.strategy}, ${w.timing === "next-load" ? "next load" : w.timing})`,
    ),
    ...r.warnings.map((w) => `  warning ${w}`),
    ...r.issues.map(issueLine),
    `  final ${rounded(r.final)}`,
  ].join("\n");
}

/**
 * Replays a run recording, v1 or v2 (or the `recording` of a `playtest
 * --json` report), on a scene headless, and says what it was recorded on:
 * the engine version and physics, the platform beside this one, and the
 * format a v1 file was migrated from. Exit 1 when it doesn't end the way it
 * was recorded; a stale scene or another platform is a warning. A run that
 * swapped scene versions in replays its swaps from `--versions`, a
 * directory of version files and their texts (`game live build`'s output,
 * one or several); without the version a swap names, it stops there with
 * `scene-version-removed`.
 */
export const replay: Tool<ReplayInput> = async (input, ctx) => {
  if (!input.run) return usage(`scene ${USAGE}`);
  if (input.scene === "-" && input.run === "-")
    return usage("only one of the scene and --run can be read from stdin");

  const under = input.game === undefined ? undefined : gameFlag(ctx, input.game);
  if (isToolResult(under)) return under;
  const loaded = await openScene(ctx, input.scene, USAGE, under);
  if (!loaded.ok) return loaded.result;
  const { registry } = loaded;

  let json: unknown;
  try {
    json = JSON.parse(await readArg(ctx, input.run));
  } catch (e) {
    if (e instanceof UsageError) return usage(e.message);
    if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.run}.`);
    return failure(`The run is not JSON: ${(e as Error).message}.`);
  }
  const recording = isRecord(json) && json.blocked === false ? json.recording : json;

  let held: VersionFiles | null = null;
  if (input.versions !== undefined) {
    try {
      if (!(await stat(input.versions)).isDirectory())
        return usage(`--versions takes a directory of scene versions: ${input.versions}`);
      held = await readVersionFiles(input.versions, { recursive: true });
    } catch (e) {
      if (isMissing(e)) return failure(`Not found: ${input.versions}.`);
      throw e;
    }
  }
  const versions = held?.versions;

  const project = loaded.project ? await projectRuntime(loaded.project, registry) : null;
  const saves = loaded.project ? await projectSaveFixtures(loaded.project) : undefined;
  const run = replayRecording({
    rapier: await rapierFor(ctx, loaded.def, registry, project?.engine),
    game: registry.game,
    registry,
    scene: loaded.def,
    prefabs: loaded.prefabs,
    project,
    recording,
    projectRef: projectRef(loaded.project),
    ...(saves ? { saves } : {}),
    ...(versions ? { versions: (id: Sha256) => findSceneVersion(id, versions) } : {}),
    ...(ctx.rapierFlavour ? { platform: { flavour: ctx.rapierFlavour } } : {}),
  });
  const game = registry.game?.id ?? null;
  const versionsData = held
    ? {
        versions: {
          dir: input.versions,
          ids: held.versions.map((v) => v.id),
          ...(held.problems.length > 0 ? { problems: held.problems } : {}),
        },
      }
    : {};
  const problemLines = (held?.problems ?? []).map((p) => `  warning --versions ${p}; skipped`);
  if (run.blocked)
    return {
      exitCode: 1,
      data: { ok: false, game, ...run, ...versionsData },
      text: [blockedText(run), ...problemLines].join("\n"),
    };
  const read = parseRecording(recording, registry);
  const recorded: Recorded | null = read.ok
    ? { engine: read.recording.engine, platform: read.recording.platform }
    : null;
  return {
    exitCode: run.matches ? 0 : 1,
    data: { game, ...run, ...(recorded ? { recorded } : {}), ...versionsData },
    text: [replayText(loaded.def.name, run, recorded), ...problemLines].join("\n"),
  };
};
