import type { AssetUrl, MountUi } from "@jams/engine";
import type { DebugLayerFactory } from "@jams/engine/debug";
import {
  createRegistry,
  type GameDefinition,
  type ProjectRuntimeView,
  type Registry,
} from "@jams/engine/game";
import {
  byCodeUnit,
  parseProjectFile,
  type AssetSidecar,
  type HeldFile,
  type KindRegistry,
  type ProjectView,
} from "@jams/engine/project";
import {
  parsePrefab,
  parseSceneOrThrow,
  prefabLibrary,
  type Prefab,
  type PrefabLibrary,
  type SceneDefinition,
} from "@jams/engine/scene";
import { useCallback, useEffect, useState } from "react";

/** What a hosted game's `load` resolves to: everything a host builds the game with. */
export type HostedGameModules = {
  game: GameDefinition;
  registry: Registry;
  /** The game's DOM UI, mounted over the canvas; null when its project file names none. */
  ui: MountUi | null;
  /** The project's first scene by path. */
  scene: SceneDefinition;
  prefabs: PrefabLibrary;
  /** What its game code reads as `EngineContext.project`: its game settings, data tables, input map and art. */
  project: ProjectRuntimeView;
  /** Where its textures come from, for `createGame`'s `assets` with a loader over `url`; null when it has none to fetch. */
  assets: { view: ProjectView; kinds: KindRegistry; url: AssetUrl } | null;
};

/** A project under `src/games/` the site plays: found from its `jams.project.json`, its code loaded on demand. */
export type HostedGame = {
  id: string;
  name: string;
  /** Loads the game, its UI, scene, prefabs and project view; the same promise every call once it resolves. */
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
  /** `/src/games/<dir>/game-settings.json`, `input-map.json` and `data/*.json`: the docs its project view reads. */
  docs?: Readonly<Record<string, Lazy>>;
  /** `/src/games/<dir>/**\/*.asset.json`: the docs' ids, and each binary's hash, size and meta. */
  sidecars?: Readonly<Record<string, Lazy>>;
  /** `/src/games/<dir>/**\/*.png` and the other texture files, eager: each one's URL as the build serves it. */
  urls?: Readonly<Record<string, string>>;
  /** `/src/games/<dir>/debug/index.ts`; empty outside dev builds. */
  debug?: Readonly<Record<string, Lazy>>;
};

/** The module paths the site loads a game's code from, relative to its project file. */
const STANDARD = { game: "./index.ts", ui: "./ui/index.ts" } as const;

const PROJECT_FILE = /^\/src\/games\/([^/]+)\/jams\.project\.json$/;

/** A scene file: one extension, since checks, input scripts, recordings and sidecars all add their own. */
const SCENE_FILE = /\/scenes\/[^/.]+\.json$/;

/** The files the `urls` glob holds: a texture held without its URL couldn't be fetched, so it's left out. */
const TEXTURE_FILE = /\.(?:png|jpe?g|webp|gif)$/i;

const SIDECAR = ".asset.json";

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

/** The JSON values of the entries of `map` under `root`, by path. */
const valuesUnder = (map: Readonly<Record<string, Lazy>>, root: string) =>
  Promise.all(under(map, root).map(async ([path, get]) => [path, jsonValue(await get())] as const));

/**
 * The project under `root` as the scene CLI reads its files, through
 * `heldProject`: its docs with their sidecars, and each binary by its
 * sidecar, a texture's bytes at the URL the build serves it from.
 */
async function projectRuntime(
  root: string,
  file: { id: string; name: string },
  globs: HostedGameGlobs,
  registry: Registry,
): Promise<Pick<HostedGameModules, "project" | "assets">> {
  const [{ heldProject, parseSidecar }, docs, sidecars] = await Promise.all([
    import("@jams/engine/project"),
    valuesUnder(globs.docs ?? {}, root),
    valuesUnder(globs.sidecars ?? {}, root),
  ]);
  const sidecarOf = new Map<string, AssetSidecar>();
  for (const [path, raw] of sidecars) {
    const parsed = parseSidecar(raw);
    if (parsed.ok) sidecarOf.set(path.slice(0, -SIDECAR.length), parsed.sidecar);
  }
  const files: HeldFile[] = docs.map(([path, json]) => ({
    path: path.slice(root.length),
    json,
    sidecar: sidecarOf.get(path) ?? null,
  }));
  const urls = new Map<string, string>();
  for (const [path, sidecar] of sidecarOf) {
    if (sidecar.sha256 === undefined) continue;
    const url = globs.urls?.[path];
    if (url === undefined && TEXTURE_FILE.test(path)) continue;
    files.push({ path: path.slice(root.length), sidecar });
    if (url !== undefined) urls.set(sidecar.sha256, url);
  }
  const { view, kinds, runtime } = heldProject(files, registry, {
    projectId: file.id,
    name: file.name,
  });
  const assets =
    urls.size > 0
      ? { view, kinds, url: ((_, entry) => urls.get(entry.sha256) ?? "") as AssetUrl }
      : null;
  return { project: runtime, assets };
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

    let scene: SceneDefinition | null = null;
    for (const [path, loadScene] of under(globs.scenes, `${root}scenes/`)) {
      if (!SCENE_FILE.test(path)) continue;
      const raw = jsonValue(await loadScene());
      if (isRecord(raw) && "kind" in raw) continue;
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
    const { project, assets } = await projectRuntime(root, file, globs, registry);
    return { game, registry, ui, scene, prefabs, project, assets };
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
  docs: import.meta.glob([
    "/src/games/*/game-settings.json",
    "/src/games/*/input-map.json",
    "/src/games/*/data/*.json",
    "!/src/games/*/data/*.asset.json",
  ]),
  sidecars: import.meta.glob(["/src/games/*/**/*.asset.json", "!/src/games/*/**/__tests__/**"]),
  urls: import.meta.glob(
    ["/src/games/*/**/*.{png,jpg,jpeg,webp,gif}", "!/src/games/*/**/__tests__/**"],
    { eager: true, query: "?url", import: "default" },
  ),
  debug: import.meta.env.DEV ? import.meta.glob("/src/games/*/debug/index.ts") : {},
};

/** The code each hosted game last loaded with, by id; kept across hot updates of this module. */
type LoadedCode = Map<string, Pick<HostedGameModules, "game" | "ui">>;

const hotData = import.meta.hot?.data as { loadedCode?: LoadedCode } | undefined;
const loadedCode: LoadedCode = hotData?.loadedCode ?? new Map();
if (hotData) hotData.loadedCode = loadedCode;

/** `game` with each load's game and UI recorded in `into`. */
function tracked(game: HostedGame, into: LoadedCode): HostedGame {
  return {
    ...game,
    load: () =>
      game.load().then((modules) => {
        into.set(game.id, { game: modules.game, ui: modules.ui });
        return modules;
      }),
  };
}

let hosted: readonly HostedGame[] | null = null;

/** The games under `src/games/` the site plays, in path order. */
export function hostedGames(): readonly HostedGame[] {
  hosted ??= hostedGamesFrom(SITE_GLOBS).map((g) => (hotData ? tracked(g, loadedCode) : g));
  return hosted;
}

/** The hosted game with project id `id`, or null. */
export function hostedGame(id: string): HostedGame | null {
  return hostedGames().find((g) => g.id === id) ?? null;
}

/** What `load` resolved to, or why it failed; `retry` runs it again. */
export type Loaded<T> = { value: T | null; error: string | null; retry: () => void };

/** `load()`'s result once it settles, run again on `retry` and whenever `load` changes. */
export function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{
    load: () => Promise<T>;
    attempt: number;
    value: T | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    load().then(
      (value) => {
        if (live) setSettled({ load, attempt, value, error: null });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (live) setSettled({ load, attempt, value: null, error: message });
      },
    );
    return () => {
      live = false;
    };
  }, [load, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = settled?.load === load && settled.attempt === attempt ? settled : null;
  return { value: current?.value ?? null, error: current?.error ?? null, retry };
}

/** The game the room plays without `?game=`. */
export const DEFAULT_GAME = "platformer";

/**
 * Whether a hot update changed a loaded game's code: each game in `was`
 * loaded again through `find` (the updated module's games) gives another
 * game or UI, or no longer loads. A scene, prefab or doc edit leaves both
 * the same module instances.
 */
export async function gameCodeChanged(
  was: ReadonlyMap<string, Pick<HostedGameModules, "game" | "ui">>,
  find: (id: string) => HostedGame | null,
): Promise<boolean> {
  for (const [id, before] of was) {
    const now = await find(id)
      ?.load()
      .catch(() => null);
    if (!now || now.game !== before.game || now.ui !== before.ui) return true;
  }
  return false;
}

// The dev server writes scene, prefab and doc files as people edit; accepting
// them here stops those updates before they reach GameCanvas and remount the
// game or the editor. A change to a game's code is passed on to the importers.
if (import.meta.hot && hotData) {
  const hot = import.meta.hot;
  hot.accept((next) => {
    const was = new Map(loadedCode);
    const find = (next as { hostedGame?: typeof hostedGame } | undefined)?.hostedGame;
    if (!find) return hot.invalidate("hosted-games failed to update");
    void gameCodeChanged(was, find).then((changed) => {
      if (changed) hot.invalidate("a hosted game's code changed");
    });
  });
}
