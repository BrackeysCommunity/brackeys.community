import type { MountUi } from "@jams/engine";
import type { DebugLayerFactory } from "@jams/engine/debug";
import { createRegistry, type GameDefinition, type Registry } from "@jams/engine/game";
import { byCodeUnit, createKindRegistry, parseProjectFile } from "@jams/engine/project";
import {
  parsePrefab,
  parseSceneOrThrow,
  prefabLibrary,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
} from "@jams/engine/scene";

/** What a hosted game's `load` resolves to: everything a host builds the game with. */
export type HostedGameModules = {
  game: GameDefinition;
  registry: Registry;
  /** The game's DOM UI, mounted over the canvas; null when its project file names none. */
  ui: MountUi | null;
  /** The project's first scene by path. */
  scene: SceneDefinition;
  prefabs: PrefabLibrary;
};

/** A project under `src/games/` the site plays: found from its `jams.project.json`, its code loaded on demand. */
export type HostedGame = {
  id: string;
  name: string;
  /** Loads the game, its UI, scene and prefabs; the same promise every call once it resolves. */
  load(): Promise<HostedGameModules>;
  /** The layers its `debug/index.ts` exports (as `<NAME>_DEBUG_LAYERS`), [] without one; dev builds only. */
  debugLayers(): Promise<readonly DebugLayerFactory[]>;
};

type Lazy = () => Promise<unknown>;

/** The site's glob maps, keyed by absolute path from the repo root (`/src/games/<dir>/…`). */
export type HostedGameGlobs = {
  /** `/src/games/<dir>/jams.project.json`, eager. */
  projects: Readonly<Record<string, unknown>>;
  /** `/src/games/<dir>/index.ts`. */
  games: Readonly<Record<string, Lazy>>;
  /** `/src/games/<dir>/ui/index.ts`. */
  uis: Readonly<Record<string, Lazy>>;
  /** `/src/games/<dir>/scenes/*.json`. */
  scenes: Readonly<Record<string, Lazy>>;
  /** `/src/games/<dir>/scenes/prefabs/*.json`. */
  prefabs: Readonly<Record<string, Lazy>>;
  /** `/src/games/<dir>/debug/index.ts`; empty outside dev builds. */
  debug?: Readonly<Record<string, Lazy>>;
};

/** The module paths the site loads a game's code from, relative to its project file. */
const STANDARD = { game: "./index.ts", ui: "./ui/index.ts" } as const;

const PROJECT_FILE = /^\/src\/games\/([^/]+)\/jams\.project\.json$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** A JSON module's value: Vite hands JSON imports over as `{ default }`. */
const jsonValue = (mod: unknown): unknown =>
  isRecord(mod) && "default" in mod ? mod.default : mod;

/** The entries of `map` under `dir`, in path order. */
const under = (map: Readonly<Record<string, Lazy>>, dir: string): [string, Lazy][] =>
  Object.entries(map)
    .filter(([path]) => path.startsWith(dir))
    .sort(([a], [b]) => byCodeUnit(a, b));

function exported(mod: unknown, name: string, what: string, project: string): unknown {
  const value = isRecord(mod) ? mod[name] : undefined;
  if (value === undefined)
    throw new Error(`project "${project}": its ${what} module exports no "${name}"`);
  return value;
}

/** Retried after a failure, shared once it resolves. */
function once<T>(run: () => Promise<T>): () => Promise<T> {
  let held: Promise<T> | null = null;
  return () => {
    held ??= run().catch((error: unknown) => {
      held = null;
      throw error;
    });
    return held;
  };
}

function hostedFrom(
  dir: string,
  root: string,
  file: { id: string; name: string; game: { export: string }; ui?: { export: string } },
  globs: HostedGameGlobs,
  loadGame: Lazy,
  loadUi: Lazy | null,
): HostedGame {
  const load = once(async (): Promise<HostedGameModules> => {
    const [gameMod, uiMod] = await Promise.all([loadGame(), loadUi?.()]);
    const game = exported(gameMod, file.game.export, "game", file.id) as GameDefinition;
    const ui =
      file.ui && loadUi ? (exported(uiMod, file.ui.export, "ui", file.id) as MountUi) : null;
    if (ui !== null && typeof ui !== "function")
      throw new Error(`project "${file.id}": "${file.ui!.export}" isn't a MountUi function`);
    const registry = createRegistry(game);
    const kinds = createKindRegistry(game);

    let scene: SceneDefinition | null = null;
    for (const [path, loadScene] of under(globs.scenes, `${root}scenes/`)) {
      const raw = jsonValue(await loadScene());
      if (kinds.detect(path.slice(root.length), raw)?.kind !== "scene") continue;
      scene = parseSceneOrThrow(raw, registry);
      break;
    }
    if (!scene) throw new Error(`project "${file.id}" has no scene under ${dir}/scenes/`);

    const raws = await Promise.all(
      under(globs.prefabs, `${root}scenes/prefabs/`).map(async ([, get]) => jsonValue(await get())),
    );
    const prefabs = prefabLibrary(
      raws.flatMap((raw): Prefab[] => {
        const parsed = parsePrefab(raw, registry);
        return parsed.ok ? [parsed.prefab] : [];
      }),
    );
    return { game, registry, ui, scene, prefabs };
  });

  const loadDebug = globs.debug?.[`${root}debug/index.ts`];
  const debugLayers = once(async (): Promise<readonly DebugLayerFactory[]> => {
    if (!loadDebug) return [];
    const mod = await loadDebug();
    if (!isRecord(mod)) return [];
    const layers = Object.entries(mod).find(
      ([name, value]) => name.endsWith("_DEBUG_LAYERS") && Array.isArray(value),
    );
    return (layers?.[1] as readonly DebugLayerFactory[] | undefined) ?? [];
  });

  return { id: file.id, name: file.name, load, debugLayers };
}

const devWarn = (message: string) => {
  if (import.meta.env.DEV) console.warn(`[games] ${message}`);
};

/**
 * The games the site hosts, from its glob maps, in path order: each project
 * file under `src/games/<dir>/` that names a game at `./index.ts` (and a UI,
 * if any, at `./ui/index.ts`). A project whose modules sit elsewhere, or
 * whose file doesn't parse, is warned about and left out; one that names no
 * game isn't a game to host.
 */
export function hostedGamesFrom(
  globs: HostedGameGlobs,
  warn: (message: string) => void = devWarn,
): HostedGame[] {
  const out: HostedGame[] = [];
  const paths = Object.keys(globs.projects).sort(byCodeUnit);
  for (const path of paths) {
    const dir = PROJECT_FILE.exec(path)?.[1];
    if (!dir) continue;
    const root = `/src/games/${dir}/`;
    const parsed = parseProjectFile(jsonValue(globs.projects[path]));
    if (!parsed.ok) {
      warn(`${path} isn't a valid project file; the site doesn't host it`);
      continue;
    }
    const { file } = parsed;
    if (!file.game) continue;
    if (file.game.module !== STANDARD.game) {
      warn(
        `project "${file.id}" names its game at ${file.game.module}; the site hosts games only from ${STANDARD.game}`,
      );
      continue;
    }
    if (file.ui && file.ui.module !== STANDARD.ui) {
      warn(
        `project "${file.id}" names its UI at ${file.ui.module}; the site hosts UIs only from ${STANDARD.ui}`,
      );
      continue;
    }
    const loadGame = globs.games[`${root}index.ts`];
    const loadUi = file.ui ? globs.uis[`${root}ui/index.ts`] : null;
    if (!loadGame || loadUi === undefined) {
      warn(`project "${file.id}" names a module ${dir}/ doesn't have; the site doesn't host it`);
      continue;
    }
    if (out.some((g) => g.id === file.id)) {
      warn(`project id "${file.id}" is taken; the site hosts the first by path`);
      continue;
    }
    out.push(hostedFrom(dir, root, { ...file, game: file.game }, globs, loadGame, loadUi));
  }
  return out;
}

const SITE_GLOBS: HostedGameGlobs = {
  projects: import.meta.glob("/src/games/*/jams.project.json", { eager: true, import: "default" }),
  games: import.meta.glob("/src/games/*/index.ts"),
  uis: import.meta.glob("/src/games/*/ui/index.ts"),
  scenes: import.meta.glob("/src/games/*/scenes/*.json"),
  prefabs: import.meta.glob("/src/games/*/scenes/prefabs/*.json"),
  debug: import.meta.env.DEV ? import.meta.glob("/src/games/*/debug/index.ts") : {},
};

let hosted: readonly HostedGame[] | null = null;

/** The games under `src/games/` the site plays, in path order. */
export function hostedGames(): readonly HostedGame[] {
  hosted ??= hostedGamesFrom(SITE_GLOBS);
  return hosted;
}

/** The hosted game with project id `id`, or null. */
export function hostedGame(id: string): HostedGame | null {
  return hostedGames().find((g) => g.id === id) ?? null;
}

/** The game the room plays without `?game=`. */
export const DEFAULT_GAME = "platformer";

// The dev server writes scene and prefab files as people edit; accepting
// them here stops those updates before they reach GameCanvas and remount the game.
if (import.meta.hot) import.meta.hot.accept(() => {});
