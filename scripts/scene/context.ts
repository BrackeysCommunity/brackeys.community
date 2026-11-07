import { execFile } from "node:child_process";
import { access, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";

import type { GameDefinition } from "@jams/engine/game";
import type { RapierModule } from "@jams/engine/headless";
import {
  closest,
  createRegistry,
  makeIssue,
  parseScene,
  sceneGameOf,
  type PrefabLibrary,
  type Registry,
  type SceneDefinition,
  type SceneIssue,
} from "@jams/engine/scene";
import { readPrefabFiles, resolveScenePath, sceneNameOf, ScenePathError } from "@jams/engine/vite";

const run = promisify(execFile);

export type GameTable = Readonly<Record<string, GameDefinition>>;

export type ToolContext = {
  /** The games a scene's `game` key may name, by id. */
  games: GameTable;
  /**
   * Scenes directories by home: a game's id, or `engine` for scenes that
   * name no game. Scene names resolve across all of them.
   */
  scenesDirs: Readonly<Record<string, string>>;
  /** Each home's scene JSON Schema file, for the `$schema` that `new` writes; omitted, `new` writes none. */
  schemaFiles?: Readonly<Record<string, string>>;
  loadRapier: () => Promise<RapierModule>;
  /** Reads `-` arguments; the CLI passes stdin. */
  readStdin?: () => Promise<string>;
  /** A file's text at a git revision; defaults to `git show <rev>:./<file>` beside the file. */
  gitShow?: (file: string, rev: string) => Promise<string>;
};

/** `git show <rev>:./<name>`, run in the file's own directory. */
export async function gitShow(file: string, rev: string): Promise<string> {
  const { stdout } = await run("git", ["show", `${rev}:./${basename(file)}`], {
    cwd: dirname(file),
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** 0 ok, 1 error-severity issues or failure, 2 usage, 3 stale base. */
export type ExitCode = 0 | 1 | 2 | 3;

export type ToolResult = { exitCode: ExitCode; data: unknown; text: string };

export type Tool<I> = (input: I, ctx: ToolContext) => Promise<ToolResult>;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const usage = (message: string): ToolResult => ({
  exitCode: 2,
  data: { ok: false, error: message },
  text: `usage: ${message}`,
});

export const failure = (message: string, extra: Record<string, unknown> = {}): ToolResult => ({
  exitCode: 1,
  data: { ok: false, error: message, ...extra },
  text: `error: ${message}`,
});

// ─── Registries ──────────────────────────────────────────

const registries = new WeakMap<GameDefinition, Registry>();
let engineRegistry: Registry | undefined;

/** The registry for game `id`, or the engine's alone for `undefined`; null for a game not in the table. */
export function registryOf(ctx: ToolContext, id: string | undefined): Registry | null {
  if (id === undefined) return (engineRegistry ??= createRegistry());
  const game = Object.hasOwn(ctx.games, id) ? ctx.games[id] : undefined;
  if (!game) return null;
  let registry = registries.get(game);
  if (!registry) registries.set(game, (registry = createRegistry(game)));
  return registry;
}

const gameIds = (ctx: ToolContext) => Object.keys(ctx.games);

function knownGames(ctx: ToolContext, id: string): string {
  const guess = closest(id, gameIds(ctx));
  const hint = guess ? `; did you mean "${guess}"?` : "";
  return `${hint} (games: ${gameIds(ctx).join(", ") || "none"})`;
}

function unknownGame(ctx: ToolContext, id: string): SceneIssue {
  return makeIssue("unknown-game", {
    message: `no game ${JSON.stringify(id)}${knownGames(ctx, id)}`,
    path: "/game",
    expected: gameIds(ctx)
      .map((g) => JSON.stringify(g))
      .join(" | "),
    got: JSON.stringify(id),
  });
}

/** Resolves a `--game` flag; a usage error names the known games. */
export function gameFlag(ctx: ToolContext, id: string | undefined): Registry | ToolResult {
  const registry = registryOf(ctx, id);
  return registry ?? usage(`--game: no game ${JSON.stringify(id)}${knownGames(ctx, id!)}`);
}

export const isToolResult = (v: unknown): v is ToolResult =>
  typeof v === "object" && v !== null && "exitCode" in v;

/** The scene's `game` key, read from its text without validating it. */
function declaredGame(text: string): string | undefined {
  try {
    return sceneGameOf(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export type Judged =
  | { ok: true; game: string | undefined; registry: Registry }
  | { ok: false; game: string; issue: SceneIssue };

/**
 * The registry a scene is parsed, validated, edited and stepped with: its
 * game's, or the engine's alone without a `game` key. `under` picks a game
 * for a scene that names none.
 */
export function judgeScene(ctx: ToolContext, text: string, under?: Registry): Judged {
  const game = declaredGame(text);
  if (game === undefined) return { ok: true, game, registry: under ?? registryOf(ctx, undefined)! };
  const registry = registryOf(ctx, game);
  return registry
    ? { ok: true, game, registry }
    : { ok: false, game, issue: unknownGame(ctx, game) };
}

// ─── Scene files ─────────────────────────────────────────

/** A scene file and the game whose scenes directory holds it. */
export type SceneFile = { name: string; home: string; file: string };

export async function listSceneFiles(ctx: ToolContext): Promise<SceneFile[]> {
  const found = await Promise.all(
    Object.entries(ctx.scenesDirs).map(async ([home, dir]) => {
      const files = await readdir(dir).catch(() => [] as string[]);
      return files
        .map(sceneNameOf)
        .filter((n): n is string => n !== null)
        .map((name) => ({ name, home, file: resolveScenePath(dir, name) }));
    }),
  );
  return found
    .flat()
    .sort((a, b) => (a.name === b.name ? (a.home < b.home ? -1 : 1) : a.name < b.name ? -1 : 1));
}

/** Names held by more than one game's scenes directory. */
export function clashes(files: readonly SceneFile[]): Map<string, string[]> {
  const homes = new Map<string, string[]>();
  for (const f of files) homes.set(f.name, [...(homes.get(f.name) ?? []), f.home]);
  return new Map([...homes].filter(([, h]) => h.length > 1));
}

export type Located = { ok: true; scene: SceneFile } | { ok: false; result: ToolResult };

/** Finds scene `name` in the games' scenes directories, through the same guard as the dev sink. */
export async function locateScene(ctx: ToolContext, name: string): Promise<Located> {
  let candidates: SceneFile[];
  try {
    candidates = Object.entries(ctx.scenesDirs).map(([home, dir]) => ({
      name,
      home,
      file: resolveScenePath(dir, name),
    }));
  } catch (e) {
    if (e instanceof ScenePathError) return { ok: false, result: usage(e.message) };
    throw e;
  }
  const found = await Promise.all(
    candidates.map((c) =>
      access(c.file).then(
        () => c,
        () => null,
      ),
    ),
  );
  const hits = found.filter((c): c is SceneFile => c !== null);
  if (hits.length === 0)
    return { ok: false, result: failure(`No scene named ${JSON.stringify(name)}.`) };
  if (hits.length > 1) {
    const homes = hits.map((h) => h.home);
    return {
      ok: false,
      result: failure(
        `Scene ${JSON.stringify(name)} is in more than one game's scenes: ${homes.join(", ")}.`,
        { homes },
      ),
    };
  }
  return { ok: true, scene: hits[0]! };
}

export async function writeSceneText(scene: SceneFile, text: string): Promise<void> {
  const tmp = `${scene.file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, scene.file);
}

/** A scene name reads from the scenes directories; anything with a slash or `.json` is a file path, read-only. */
export function isFileArg(arg: string): boolean {
  return arg.includes("/") || arg.endsWith(".json");
}

export async function readArg(ctx: ToolContext, arg: string): Promise<string> {
  if (arg === "-") {
    if (!ctx.readStdin) throw new UsageError("stdin is not available here");
    return ctx.readStdin();
  }
  return readFile(arg, "utf8");
}

async function notFound(ctx: ToolContext, target: string): Promise<ToolResult> {
  const stem = target.endsWith(".json") && !target.includes("/") ? target.slice(0, -5) : null;
  const isScene = stem !== null && (await listSceneFiles(ctx)).some((f) => f.name === stem);
  return failure(
    isScene
      ? `Not found: ${target}. To read the scene, pass its name: ${stem}.`
      : `Not found: ${target}.`,
  );
}

export type SceneSource =
  | { ok: true; text: string; scene: SceneFile | null }
  | { ok: false; result: ToolResult };

/** The directory a read scene's prefabs live beside: its scenes directory, a file argument's own, none for stdin. */
export function sceneDirOf(source: { scene: SceneFile | null }, arg: string): string | undefined {
  if (source.scene) return dirname(source.scene.file);
  return arg === "-" ? undefined : dirname(arg);
}

/** A scene name, or a file path or `-` (read-only: `scene` is null). */
export async function readSource(ctx: ToolContext, arg: string): Promise<SceneSource> {
  if (isFileArg(arg) || arg === "-") {
    try {
      return { ok: true, text: await readArg(ctx, arg), scene: null };
    } catch (e) {
      if (e instanceof UsageError) return { ok: false, result: usage(e.message) };
      if ((e as { code?: string }).code === "ENOENT")
        return { ok: false, result: await notFound(ctx, arg) };
      throw e;
    }
  }
  const located = await locateScene(ctx, arg);
  if (!located.ok) return located;
  return { ok: true, text: await readFile(located.scene.file, "utf8"), scene: located.scene };
}

type Parsed = {
  name: string;
  text: string;
  def: SceneDefinition;
  registry: Registry;
  /** The prefabs in `prefabs/` beside the scene's file; empty for stdin. */
  prefabs: PrefabLibrary;
};

/**
 * The prefab library of the scenes directory `dir`, judged by `registry`. A
 * prefab file that doesn't parse is left out; validating a scene that uses
 * it then reports `prefab-unknown`.
 */
export async function prefabsOf(
  dir: string | undefined,
  registry: Registry,
): Promise<PrefabLibrary> {
  if (dir === undefined) return new Map();
  return (await readPrefabFiles(dir, registry)).prefabs;
}

/**
 * Parses a scene with its game's registry. `under` is the game a scene
 * without a `game` key runs under; it is a usage error on a scene that
 * names another.
 */
async function parseWithGame(
  ctx: ToolContext,
  name: string,
  text: string,
  under: Registry | undefined,
  dir: string | undefined,
): Promise<({ ok: true } & Parsed) | { ok: false; result: ToolResult }> {
  const judged = judgeScene(ctx, text, under);
  if (!judged.ok) return { ok: false, result: issuesFailure(name, [judged.issue]) };
  if (under && judged.game !== undefined && judged.game !== under.id) {
    return {
      ok: false,
      result: usage(
        `--game ${under.id}: ${name} is for game "${judged.game}"; --game only picks a game for a scene without one`,
      ),
    };
  }
  const parsed = parseScene(text, judged.registry);
  if (!parsed.ok) return { ok: false, result: issuesFailure(name, parsed.issues) };
  const prefabs = await prefabsOf(dir, judged.registry);
  return { ok: true, name, text, def: parsed.def, registry: judged.registry, prefabs };
}

/**
 * Parses scene text that came from somewhere other than a scenes directory
 * (a git revision); `dir` is where its prefabs are read from.
 */
export function parseSceneText(
  ctx: ToolContext,
  name: string,
  text: string,
  dir?: string,
): Promise<({ ok: true } & Parsed) | { ok: false; result: ToolResult }> {
  return parseWithGame(ctx, name, text, undefined, dir);
}

export type OpenedScene = ({ ok: true } & Parsed) | { ok: false; result: ToolResult };

/** Reads and parses a scene by name, file path or `-`, for commands that never write. */
export async function openScene(
  ctx: ToolContext,
  arg: string | undefined,
  cmd: string,
  under?: Registry,
): Promise<OpenedScene> {
  if (!arg) return { ok: false, result: usage(`scene ${cmd} <scene|file|->`) };
  const source = await readSource(ctx, arg);
  if (!source.ok) return source;
  return parseWithGame(ctx, arg, source.text, under, sceneDirOf(source, arg));
}

export type LoadedScene =
  | ({ ok: true; scene: SceneFile } & Parsed)
  | { ok: false; result: ToolResult };

/** Reads and parses a scene by name, for commands that write it back. */
export async function loadScene(
  ctx: ToolContext,
  name: string | undefined,
  cmd: string,
): Promise<LoadedScene> {
  if (!name) return { ok: false, result: usage(`scene ${cmd} <scene>`) };
  if (isFileArg(name) || name === "-")
    return {
      ok: false,
      result: usage(`scene ${cmd} takes a scene name; file paths are read-only`),
    };
  const located = await locateScene(ctx, name);
  if (!located.ok) return located;
  const parsed = await parseWithGame(
    ctx,
    name,
    await readFile(located.scene.file, "utf8"),
    undefined,
    dirname(located.scene.file),
  );
  return parsed.ok ? { ...parsed, scene: located.scene } : parsed;
}

export function issuesFailure(scene: string, issues: SceneIssue[]): ToolResult {
  return {
    exitCode: 1,
    data: { ok: false, scene, issues },
    text: [`${scene}: failed to parse`, ...issues.map(issueLine)].join("\n"),
  };
}

export function issueLine(i: SceneIssue): string {
  const where = i.line !== undefined ? `:${i.line}` : "";
  const ids = i.entityIds.length > 0 ? ` [${i.entityIds.join(", ")}]` : "";
  const hint = i.hint ? `\n    hint: ${i.hint}` : "";
  return `  ${i.severity} ${i.code}${where}${ids} ${i.message}${hint}`;
}
