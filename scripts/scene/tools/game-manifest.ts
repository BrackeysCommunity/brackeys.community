import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { formatBytes, measureBudget } from "@jams/engine/export";
import { parseRecording, type RunRecording } from "@jams/engine/headless";
import {
  byCodeUnit,
  checkReleaseManifest,
  findRelease,
  parseReleaseManifest,
  RELEASE_FILE,
  releaseId,
  sha256,
  type ReleaseFile,
  type ReleaseManifest,
  type Sha256,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";

import {
  failure,
  issueLine,
  readArg,
  usage,
  UsageError,
  type Tool,
  type ToolResult,
} from "../context";
import { replay, type ReplayInput } from "./replay";

export type GameManifestInput = {
  /** A build directory, or a `release.json`. */
  path?: string;
};

export const GAME_MANIFEST_USAGE = "game manifest <dir|release.json>";

/** A path as a summary prints it: relative to the working directory when under it. */
export function shownPath(path: string): string {
  const rel = relative(process.cwd(), path);
  if (rel === "") return ".";
  return rel === ".." || rel.startsWith(`..${sep}`) ? path : rel;
}

/** Every file under `dir`, "/" separated and sorted. */
export async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort(byCodeUnit);
}

/** The order roles are listed in. */
const ROLES = [
  "code",
  "style",
  "wasm",
  "shell",
  "worker",
  "icon",
  "asset",
  "data",
] as const satisfies readonly ReleaseFile["role"][];

/** What a manifest says, as summary lines and the same as data: scenes and physics, bytes per role, the budget, credits. */
export function manifestSummary(m: ReleaseManifest): {
  lines: string[];
  data: Record<string, unknown>;
} {
  const bytes: Partial<Record<ReleaseFile["role"], number>> = {};
  for (const f of m.build.files) bytes[f.role] = (bytes[f.role] ?? 0) + f.bytes;
  const total = m.build.files.reduce((n, f) => n + f.bytes, 0);
  const scenes = m.flow.scenes.map((s) => ({
    id: s.id,
    physics: s.physics,
    ...(s.id === m.flow.start ? { start: true } : {}),
    ...(s.sublevel ? { sublevel: true } : {}),
  }));
  const rapier = m.build.rapier;
  const { limits, measured, over } = m.budget;
  const budgetText = (["codeBytes", "firstLoadBytes", "totalBytes"] as const)
    .map((k) => `${k} ${formatBytes(measured[k])} of ${formatBytes(limits[k])}`)
    .concat(
      `largest file ${measured.largestFile.path || "none"} ${formatBytes(measured.largestFile.bytes)} of ${formatBytes(limits.fileBytes)}`,
    )
    .join(", ");
  const { credits } = m;
  const lines = [
    `  game ${m.game.id}, engine ${m.engine.version} (agent surface ${m.engine.agentSurface}), target ${m.build.target}, snapshot ${m.project.snapshot}`,
    `  scenes ${scenes
      .map(
        (s) =>
          `${s.id} (${[...(s.start ? ["start"] : []), ...(s.sublevel ? ["sublevel"] : []), s.physics].join(", ")})`,
      )
      .join(", ")}`,
    rapier
      ? `  physics rapier: ${rapier.package} ${rapier.version}, ${rapier.file ? `${rapier.file} ${formatBytes(rapier.bytes)}` : `inlined ${formatBytes(rapier.bytes)}`}`
      : "  physics none: no wasm",
    `  files ${m.build.files.length} + ${RELEASE_FILE}, ${formatBytes(total)}: ${ROLES.filter(
      (r) => bytes[r] !== undefined,
    )
      .map((r) => `${r} ${formatBytes(bytes[r]!)}`)
      .join(", ")}`,
    `  budget ${budgetText}${over.length > 0 ? `; over ${over.join(", ")}` : ""}`,
    `  credits ${credits.assets.length} licence group${credits.assets.length === 1 ? "" : "s"}, ${credits.code.length} code package${credits.code.length === 1 ? "" : "s"}; ${
      credits.missing.length > 0
        ? `no licence recorded for ${credits.missing.join(", ")}`
        : "every asset has a licence"
    }`,
  ];
  return {
    lines,
    data: {
      game: m.game.id,
      engine: m.engine.version,
      buildTarget: m.build.target,
      snapshot: m.project.snapshot,
      scenes,
      rapier,
      files: m.build.files.length,
      bytes: { ...bytes, total },
      budget: m.budget,
      credits: {
        groups: credits.assets.length,
        missing: credits.missing,
        packages: credits.code.map((c) => `${c.package}@${c.version}`),
      },
    },
  };
}

/** A manifest read from a build directory or a `release.json`: its text, and the directory's files by hash when given one. */
type ReadManifest = {
  file: string;
  text: string;
  /** Every file of the directory but `release.json`, by path; absent for a lone `release.json`. */
  files?: Map<string, Sha256>;
};

async function readManifestAt(path: string): Promise<ReadManifest> {
  if (!(await stat(path)).isDirectory()) return { file: path, text: await readFile(path, "utf8") };
  const file = join(path, RELEASE_FILE);
  const text = await readFile(file, "utf8");
  const files = new Map<string, Sha256>();
  for (const rel of await filesUnder(path))
    if (rel !== RELEASE_FILE)
      files.set(rel, await sha256(new Uint8Array(await readFile(join(path, rel)))));
  return { file, text, files };
}

const isMissing = (error: unknown) => (error as { code?: string }).code === "ENOENT";

/**
 * Checks a manifest the way every reader does (`checkReleaseManifest`, the
 * budget recomputed), with its directory's files and their hashes when
 * given one. Its issues; and the files the directory holds that the
 * manifest doesn't list.
 */
export async function checkManifestAt(
  path: string,
): Promise<
  | { ok: true; file: string; manifest: ReleaseManifest; issues: SceneIssue[]; unlisted: string[] }
  | { ok: false; result: ToolResult }
> {
  let read: ReadManifest;
  try {
    read = await readManifestAt(path);
  } catch (error) {
    if (isMissing(error)) return { ok: false, result: failure(`Not found: ${path}.`) };
    throw error;
  }
  const parsed = parseReleaseManifest(read.text);
  if (!parsed.ok)
    return {
      ok: false,
      result: {
        exitCode: 1,
        data: { ok: false, file: read.file, issues: parsed.issues },
        text: [
          `${shownPath(read.file)}: not a release manifest`,
          ...parsed.issues.map(issueLine),
        ].join("\n"),
      },
    };
  const { manifest } = parsed;
  const issues = await checkReleaseManifest(manifest, read.files, { measureBudget });
  const listed = new Set(manifest.build.files.map((f) => f.path));
  const unlisted = read.files ? [...read.files.keys()].filter((p) => !listed.has(p)) : [];
  return { ok: true, file: read.file, manifest, issues, unlisted };
}

/** Parses and checks a release manifest (with the build's files when given a directory) and prints its summary. */
export const gameManifest: Tool<GameManifestInput> = async (input) => {
  if (!input.path) return usage(GAME_MANIFEST_USAGE);
  const checked = await checkManifestAt(input.path);
  if (!checked.ok) return checked.result;
  const { file, manifest, issues, unlisted } = checked;
  const id = await releaseId(manifest);
  const summary = manifestSummary(manifest);
  const ok = !issues.some((i) => i.severity === "error");
  const withFiles = file !== input.path;
  return {
    exitCode: ok ? 0 : 1,
    data: {
      ok,
      file,
      release: id,
      ...summary.data,
      filesChecked: withFiles,
      unlisted,
      issues,
      manifest,
    },
    text: [
      `${shownPath(file)}: ${manifest.project.name} release ${id}, ${ok ? "holds together" : "doesn't hold together"}${withFiles ? " with its files" : ""}`,
      ...summary.lines,
      ...(unlisted.length > 0 ? [`  not listed in build.files: ${unlisted.join(", ")}`] : []),
      ...issues.map(issueLine),
    ].join("\n"),
  };
};

// ─── Releases a recording was made on ────────────────────

/** A build found under a releases directory. */
export type FoundRelease = { id: Sha256; manifest: ReleaseManifest; dir: string };

/**
 * Every build under `dir` (its own `release.json` and any below it), newest
 * `release.json` first, then by path. A `release.json` that doesn't parse
 * is skipped and named in `skipped`.
 */
export async function readReleases(
  dir: string,
): Promise<{ releases: FoundRelease[]; skipped: string[] }> {
  const files = (await filesUnder(dir)).filter(
    (f) => (f === RELEASE_FILE || f.endsWith(`/${RELEASE_FILE}`)) && !f.includes("node_modules/"),
  );
  const found: (FoundRelease & { at: number })[] = [];
  const skipped: string[] = [];
  for (const rel of files) {
    const file = join(dir, rel);
    const parsed = parseReleaseManifest(await readFile(file, "utf8"));
    if (!parsed.ok) {
      skipped.push(file);
      continue;
    }
    found.push({
      id: await releaseId(parsed.manifest),
      manifest: parsed.manifest,
      dir: dirname(file),
      at: (await stat(file)).mtimeMs,
    });
  }
  found.sort((a, b) => b.at - a.at || byCodeUnit(a.dir, b.dir));
  return { releases: found.map(({ at: _, ...r }) => r), skipped };
}

export type ReplayReleasesInput = ReplayInput & {
  /** A directory of builds, each with its `release.json`. */
  releases: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The release a recording was made on, and whether its fallback match was confirmed. */
export type ReleaseMatch = {
  release: FoundRelease;
  /** `release`: the run's own release id; `snapshot`: the same snapshot and engine. */
  matchedBy: "release" | "snapshot";
  /** Always true for a `release` match; a `snapshot` match is confirmed when it reproduces the run's `runHash`. */
  confirmed: boolean;
};

/**
 * Whether a release reproduces what a run ran (`runHash`): the replay over
 * the run's snapshot isn't stale, and the release's game and clock are the
 * run's. The snapshot and engine are already the run's, so the clock is all
 * `runHash` covers that two such releases can differ in.
 */
function reproducesRun(r: FoundRelease, recording: RunRecording, stale: boolean | null): boolean {
  const { game, time } = r.manifest;
  return (
    stale === false &&
    game.id === recording.game &&
    time.kind === recording.time.kind &&
    time.rate === recording.time.rate
  );
}

/**
 * `findRelease` over `releases` (newest first): the run's own release id is
 * exact; else each release with the run's snapshot and engine in turn, the
 * first that reproduces its `runHash` (`stale` is the replay's verdict, null
 * when it didn't run), and the newest unconfirmed when none does.
 */
export function matchRelease(
  recording: RunRecording,
  releases: readonly FoundRelease[],
  stale: boolean | null,
): ReleaseMatch | null {
  const first = findRelease(recording, releases);
  if (!first) return null;
  if (recording.release === first.id)
    return { release: first, matchedBy: "release", confirmed: true };
  const bySnapshot = { project: recording.project, engine: recording.engine };
  let rest = releases.filter((r) => r !== first);
  for (let next: FoundRelease | null = first; next; next = findRelease(bySnapshot, rest)) {
    if (reproducesRun(next, recording, stale))
      return { release: next, matchedBy: "snapshot", confirmed: true };
    const done = next;
    rest = rest.filter((r) => r !== done);
  }
  return { release: first, matchedBy: "snapshot", confirmed: false };
}

/** A release's clock and replay rule as the release line prints them. */
const releaseTerms = (m: ReleaseManifest) =>
  `time ${m.time.kind} at ${m.time.rate}, ${m.replay.acrossPlatforms ? "replays across platforms" : "replays on its own platform only"}`;

/**
 * `replay`, then the release among `releases`' builds the recording was
 * made on (`matchRelease`: its `release` id, else the same snapshot and
 * engine judged by `runHash`), or that none is, with that release's time
 * model and `replay.acrossPlatforms`. The replay decides the exit code.
 */
export const replayRelease: Tool<ReplayReleasesInput> = async (input, ctx) => {
  if (!input.run) return replay(input, ctx);
  let text: string;
  try {
    text = await readArg(ctx, input.run);
  } catch (e) {
    if (e instanceof UsageError) return usage(e.message);
    if (isMissing(e)) return failure(`Not found: ${input.run}.`);
    throw e;
  }
  // The run is read once here and once by the replay; stdin can be read only once.
  const replayed = await replay(
    input,
    input.run === "-" ? { ...ctx, readStdin: async () => text } : ctx,
  );
  if (replayed.exitCode === 2) return replayed;

  let found: { releases: FoundRelease[]; skipped: string[] };
  try {
    found = await readReleases(input.releases);
  } catch (error) {
    if (isMissing(error)) return failure(`Not found: ${input.releases}.`);
    throw error;
  }
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // The replay has said why.
  }
  const raw = isRecord(json) && json.blocked === false ? json.recording : json;
  const read = parseRecording(raw);
  const stale =
    isRecord(replayed.data) && typeof replayed.data.stale === "boolean"
      ? replayed.data.stale
      : null;
  const match = read.ok ? matchRelease(read.recording, found.releases, stale) : null;
  const release = match
    ? {
        id: match.release.id,
        dir: match.release.dir,
        target: match.release.manifest.build.target,
        matchedBy: match.matchedBy,
        confirmed: match.confirmed,
        time: match.release.manifest.time,
        acrossPlatforms: match.release.manifest.replay.acrossPlatforms,
      }
    : null;
  const searched = found.releases.length;
  const how = !match
    ? ""
    : match.matchedBy === "release"
      ? "the run's release id"
      : match.confirmed
        ? "same snapshot and engine, run hash reproduced"
        : "same snapshot and engine, unconfirmed: no build reproduces the run hash";
  const line = match
    ? `  release ${match.release.id} at ${shownPath(match.release.dir)} (${match.release.manifest.build.target}; ${how}; ${releaseTerms(match.release.manifest)})`
    : `  release none of the ${searched} build${searched === 1 ? "" : "s"} under ${shownPath(input.releases)} ${read.ok ? `has snapshot ${read.recording.project?.snapshot ?? "(none recorded)"} on engine ${read.recording.engine.version}` : "can be matched: the run doesn't parse"}`;
  return {
    exitCode: replayed.exitCode,
    data: {
      ...(isRecord(replayed.data) ? replayed.data : { replay: replayed.data }),
      release,
      releasesSearched: searched,
      ...(found.skipped.length > 0 ? { releasesSkipped: found.skipped } : {}),
    },
    text: [
      replayed.text,
      line,
      ...found.skipped.map((f) => `  warning ${shownPath(f)} isn't a release manifest; skipped`),
    ].join("\n"),
  };
};
