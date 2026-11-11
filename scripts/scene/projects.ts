import { glob, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createRegistry, withProject, type GameDefinition, type Registry } from "@jams/engine/game";
import {
  createKindRegistry,
  MATERIAL_KIND,
  parseProjectFile,
  PROJECT_FILE,
  projectView,
  RUNTIME_VIEW_KINDS,
  runtimeView,
  type AssetId,
  type KindRegistry,
  type ProjectFile,
  type ProjectId,
  type ProjectRuntimeView,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";
import { createProjectFileAdapter, defaultCacheDir, type ProjectScan } from "@jams/engine/vite";

export type ProjectHandle = {
  /** The project's root: the directory holding its `jams.project.json`. Absolute. */
  dir: string;
  file: ProjectFile;
  /** Imported from `file.game`; null for an engine-only project. */
  game: GameDefinition | null;
  /** `createRegistry(game)` with the project's material assets overlaid, as its files were when it was opened. */
  registry: Registry;
  /** The engine's asset kinds and the game's `assetKinds`. */
  kinds: KindRegistry;
  /** The project's dev cache: doc states, the trash and blobs (`defaultCacheDir`). */
  cacheDir: string;
};

export const DEFAULT_PROJECT_GLOBS: readonly string[] = [`src/**/${PROJECT_FILE}`];

/** One project file that couldn't become a project: its path relative to the root and why. */
export type ProjectProblem = { file: string; message: string; issues?: SceneIssue[] };

export class ProjectDiscoveryError extends Error {
  constructor(readonly problems: readonly ProjectProblem[]) {
    super(
      `${problems.length === 1 ? "a project" : `${problems.length} projects`} can't be loaded:\n${problems
        .map((p) => `- ${p.file}: ${p.message}`)
        .join("\n")}`,
    );
    this.name = "ProjectDiscoveryError";
  }
}

export type DiscoverOptions = {
  /** Loads a game module by absolute path; defaults to a dynamic `import()` of its file URL. */
  importModule?: (path: string) => Promise<Record<string, unknown>>;
  /** Each project's cache directory; default `defaultCacheDir(id, root)`. */
  cacheDirOf?: (id: ProjectId) => string;
};

const SKIPPED_DIR = /(^|\/)(node_modules|dist|__tests__|\.[^/]*)$/;
const RUNTIME_KINDS: ReadonlySet<string> = new Set(RUNTIME_VIEW_KINDS);

const isGame = (v: unknown): v is GameDefinition =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as GameDefinition).id === "string" &&
  Array.isArray((v as GameDefinition).types) &&
  typeof (v as GameDefinition).createRuntime === "function";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Project files under `root` matching `globs`, as sorted absolute paths; `node_modules`, `dist`, `__tests__` and dot directories are never searched. */
async function findProjectFiles(root: string, globs: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of globs) {
    for await (const path of glob(pattern, {
      cwd: root,
      exclude: (p) => SKIPPED_DIR.test(p.split("\\").join("/")),
    })) {
      if (path.split(/[\\/]/).pop() === PROJECT_FILE) found.add(resolve(root, path));
    }
  }
  return [...found].sort();
}

/** The project's files as the dev server's adapter reads them: every asset and sidecar under its globs, judged by `registry`. */
export function scanProject(
  project: ProjectHandle,
  registry: Registry = project.registry,
): Promise<ProjectScan> {
  return createProjectFileAdapter({ ...project, registry }).scan();
}

/** The JSON of each live asset of the scan whose kind is in `kinds`, read from its file; one that isn't JSON is left out, and the scan reports it. */
async function docValues(
  dir: string,
  scan: ProjectScan,
  kinds: ReadonlySet<string>,
): Promise<Map<AssetId, unknown>> {
  const json = new Map<AssetId, unknown>();
  for (const entry of Object.values(scan.state.assets)) {
    if (!kinds.has(entry.kind) || entry.deleted !== undefined) continue;
    try {
      json.set(entry.id, JSON.parse(await readFile(join(dir, entry.path), "utf8")));
    } catch {
      // Left out.
    }
  }
  return json;
}

/**
 * `registry` with the scan's live material assets overlaid (`withProject`),
 * each read from its file. Without material assets, `registry` itself.
 */
export async function overlayMaterials(
  project: Pick<ProjectHandle, "dir" | "kinds">,
  registry: Registry,
  scan: ProjectScan,
): Promise<Registry> {
  const json = await docValues(project.dir, scan, new Set([MATERIAL_KIND]));
  if (json.size === 0) return registry;
  return withProject(registry, projectView(scan.state, project.kinds), json);
}

/**
 * What game code reads as `EngineContext.project` in a run of one of the
 * project's scenes under `registry` (the game the run plays): its
 * game-settings and data tables as their files hold them now, from `scan`
 * or a fresh one.
 */
export async function projectRuntime(
  project: ProjectHandle,
  registry: Registry,
  scan?: ProjectScan,
): Promise<ProjectRuntimeView> {
  const files = scan ?? (await scanProject(project));
  const values = await docValues(project.dir, files, RUNTIME_KINDS);
  return runtimeView(projectView(files.state, project.kinds), values, registry);
}

/** `handle` with its material assets as their files hold them now. */
export async function withLiveMaterials(handle: ProjectHandle): Promise<ProjectHandle> {
  const registry = await overlayMaterials(handle, handle.registry, await scanProject(handle));
  return { ...handle, registry };
}

/**
 * The project whose `jams.project.json` is in `dir`, judged by `game` (the
 * engine's alone without one) instead of the module its file names, with
 * its material overlay: for hosts and tests that hold the game already.
 */
export async function openProject(
  dir: string,
  opts: { game?: GameDefinition | null; cacheDir?: string } = {},
): Promise<ProjectHandle> {
  const root = resolve(dir);
  const path = join(root, PROJECT_FILE);
  const parsed = parseProjectFile(await readFile(path, "utf8"));
  if (!parsed.ok)
    throw new ProjectDiscoveryError([
      {
        file: path,
        message: parsed.issues.map((i) => i.message).join("; "),
        issues: parsed.issues,
      },
    ]);
  const game = opts.game ?? null;
  return withLiveMaterials({
    dir: root,
    file: parsed.file,
    game,
    registry: createRegistry(game),
    kinds: createKindRegistry(game),
    cacheDir: opts.cacheDir ?? defaultCacheDir(parsed.file.id, root),
  });
}

/**
 * Every project under `root`: each `jams.project.json` the globs match,
 * parsed, with its game imported, its registries built and its material
 * assets overlaid onto the registry from a scan of its files. Sorted by id.
 * Throws `ProjectDiscoveryError` naming every file that fails: a bad project
 * file, a game module that won't load or lacks its export, a registry that
 * won't build, or a project id two files claim.
 */
export async function discoverProjects(
  root: string,
  globs: readonly string[] = DEFAULT_PROJECT_GLOBS,
  options: DiscoverOptions = {},
): Promise<ProjectHandle[]> {
  const base = resolve(root);
  const importModule =
    options.importModule ??
    ((path: string) => import(pathToFileURL(path).href) as Promise<Record<string, unknown>>);
  const cacheDirOf = options.cacheDirOf ?? ((id: ProjectId) => defaultCacheDir(id, base));
  const problems: ProjectProblem[] = [];
  const handles: ProjectHandle[] = [];

  for (const path of await findProjectFiles(base, globs)) {
    const file = relative(base, path);
    const fail = (message: string, issues?: SceneIssue[]) =>
      problems.push(issues ? { file, message, issues } : { file, message });

    const parsed = parseProjectFile(await readFile(path, "utf8"));
    if (!parsed.ok) {
      fail(parsed.issues.map((i) => i.message).join("; "), parsed.issues);
      continue;
    }
    const dir = dirname(path);
    let game: GameDefinition | null = null;
    if (parsed.file.game) {
      const { module, export: name } = parsed.file.game;
      let loaded: Record<string, unknown>;
      try {
        loaded = await importModule(resolve(dir, module));
      } catch (error) {
        fail(`its game module ${module} doesn't load: ${messageOf(error)}`);
        continue;
      }
      const value = Object.hasOwn(loaded, name) ? loaded[name] : undefined;
      if (!isGame(value)) {
        fail(
          value === undefined
            ? `its game module ${module} has no export "${name}"`
            : `${module}'s export "${name}" isn't a game definition`,
        );
        continue;
      }
      game = value;
    }
    let handle: ProjectHandle;
    try {
      handle = {
        dir,
        file: parsed.file,
        game,
        registry: createRegistry(game),
        kinds: createKindRegistry(game),
        cacheDir: cacheDirOf(parsed.file.id),
      };
    } catch (error) {
      fail(messageOf(error));
      continue;
    }
    try {
      handles.push(await withLiveMaterials(handle));
    } catch (error) {
      fail(`its files can't be read: ${messageOf(error)}`);
    }
  }

  const byId = new Map<ProjectId, ProjectHandle[]>();
  for (const h of handles) byId.set(h.file.id, [...(byId.get(h.file.id) ?? []), h]);
  for (const [id, same] of byId) {
    if (same.length < 2) continue;
    const files = same.map((h) => relative(base, resolve(h.dir, PROJECT_FILE)));
    for (const file of files)
      problems.push({ file, message: `project id "${id}" is also claimed by ${files.join(", ")}` });
  }
  if (problems.length > 0) throw new ProjectDiscoveryError(problems);
  return handles.sort((a, b) => (a.file.id < b.file.id ? -1 : 1));
}

// ─── Which project holds an id ───────────────────────────

/** The CLI's exit code for each refusal: 2 is a usage error, which `--project` fixes. */
export type ProjectLookup =
  | { ok: true; project: ProjectHandle }
  | {
      ok: false;
      reason: "unknown-project";
      exitCode: 2;
      message: string;
      known: ProjectId[];
    }
  | { ok: false; reason: "ambiguous"; exitCode: 2; message: string; projects: ProjectId[] }
  | { ok: false; reason: "not-found"; exitCode: 1; message: string };

export function projectById(
  projects: readonly ProjectHandle[],
  id: ProjectId,
): ProjectHandle | undefined {
  return projects.find((p) => p.file.id === id);
}

/** The `--project` message for an id no project has, listing the projects. */
export function unknownProjectMessage(projects: readonly ProjectHandle[], id: string): string {
  const known = projects.map((p) => p.file.id);
  return `--project: no project ${JSON.stringify(id)} (projects: ${known.join(", ") || "none"})`;
}

/**
 * The one project holding `id`, asking each with `holds`. With `only` (the
 * `--project` flag) just that project is asked. An id two projects hold is
 * `ambiguous` unless `only` names one of them.
 */
export async function locateInProjects(
  projects: readonly ProjectHandle[],
  id: string,
  holds: (project: ProjectHandle) => boolean | Promise<boolean>,
  only?: ProjectId,
): Promise<ProjectLookup> {
  const known = projects.map((p) => p.file.id);
  let candidates = projects;
  if (only !== undefined) {
    const named = projectById(projects, only);
    if (!named)
      return {
        ok: false,
        reason: "unknown-project",
        exitCode: 2,
        message: unknownProjectMessage(projects, only),
        known,
      };
    candidates = [named];
  }
  const answers = await Promise.all(candidates.map(async (p) => ((await holds(p)) ? p : null)));
  const hits = answers.filter((p): p is ProjectHandle => p !== null);
  const [first] = hits;
  if (!first)
    return {
      ok: false,
      reason: "not-found",
      exitCode: 1,
      message:
        only === undefined
          ? `No project has ${JSON.stringify(id)}.`
          : `Project "${only}" has no ${JSON.stringify(id)}.`,
    };
  if (hits.length > 1) {
    const ids = hits.map((p) => p.file.id);
    return {
      ok: false,
      reason: "ambiguous",
      exitCode: 2,
      message: `${JSON.stringify(id)} is in more than one project: ${ids.join(", ")}; pass --project to pick one.`,
      projects: ids,
    };
  }
  return { ok: true, project: first };
}

/** Ids more than one project holds, each with the ids of the projects holding it, from each project's ids. */
export function ambiguousIds(
  projects: readonly ProjectHandle[],
  idsOf: (project: ProjectHandle) => Iterable<string>,
): Map<string, ProjectId[]> {
  const holders = new Map<string, ProjectId[]>();
  for (const p of projects)
    for (const id of new Set(idsOf(p))) holders.set(id, [...(holders.get(id) ?? []), p.file.id]);
  return new Map([...holders].filter(([, ids]) => ids.length > 1));
}
