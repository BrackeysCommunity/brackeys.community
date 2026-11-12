import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { formatBytes, measureBudget } from "@jams/engine/export";
import { parseRecording } from "@jams/engine/headless";
import {
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

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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

/**
 * `replay`, then the release among `releases`' builds the recording was
 * made on (`findRelease`: its `release` id, else the same snapshot and
 * engine), or that none is. The replay decides the exit code.
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
  const match = read.ok ? findRelease(read.recording, found.releases) : null;
  const how = match && read.ok && read.recording.release === match.id ? "release" : "snapshot";
  const release = match
    ? { id: match.id, dir: match.dir, target: match.manifest.build.target, matchedBy: how }
    : null;
  const searched = found.releases.length;
  const line = match
    ? `  release ${match.id} at ${shownPath(match.dir)} (${match.manifest.build.target}; ${how === "release" ? "the run's release id" : "same snapshot and engine"})`
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
