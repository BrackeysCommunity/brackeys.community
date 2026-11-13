import { afterEach, beforeEach, expect, vi } from "vite-plus/test";

import { createGame } from "../../engine";
import type { GameDefinition } from "../../game/types";
import { createKindRegistry, type KindRegistry } from "../../project/kinds";
import type { ProjectView } from "../../project/types";
import { projectView } from "../../project/view";
import type { AssetLoader } from "../../render/asset-loader";
import type { SceneRuntimeHandle } from "../../runtime/types";
import type { GameInstance, SceneSource } from "../../types";

/** A loader with nothing to fetch, every load done at once; `overrides` replace its methods. */
export function noopLoader(overrides: Partial<AssetLoader> = {}): AssetLoader {
  return {
    get: () => null,
    onLoad: () => () => {},
    load: async () => ({ failed: [] }),
    retain() {},
    release() {},
    trim() {},
    stats: () => ({ textures: 0, bytes: 0, resident: [] }),
    destroy() {},
    ...overrides,
  };
}

/** A project with no assets, as the view bundles are computed over. */
export const emptyProjectView = (kinds: KindRegistry): ProjectView =>
  projectView(
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {},
      history: {},
      code: {},
      build: {},
    },
    kinds,
  );

/** The game's running scene; throws when none is. */
export function world(game: GameInstance): SceneRuntimeHandle {
  const rt = game.runtime() as SceneRuntimeHandle | null;
  if (!rt) throw new Error("no scene is running");
  return rt;
}

export type LiveGameOptions = {
  source: SceneSource;
  /** Fetches bundles over an empty project; without it nothing is fetched. */
  loader?: AssetLoader;
  /** Runs once the game starts, before its start scene loads: for listeners that must see that load. */
  beforeLoad?: (game: GameInstance) => void;
};

/**
 * Installs the suite's hooks (fake timers, stubbed frames and media queries,
 * a fresh canvas, every game destroyed after each test) and returns a
 * starter: a dev game on `source`'s start scene. The suite still mocks
 * `../renderer` itself, since `vi.mock` is hoisted per file.
 */
export function installLiveGames(): (
  def: GameDefinition,
  opts: LiveGameOptions,
) => Promise<GameInstance> {
  const games: GameInstance[] = [];
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.useFakeTimers();
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  return async (def, { source, loader, beforeLoad }) => {
    const kinds = createKindRegistry(def);
    const game = await createGame(canvas, {
      game: def,
      dev: true,
      ...(loader ? { assets: { loader, view: emptyProjectView(kinds), kinds } } : {}),
      flow: { source, loading: false },
    });
    games.push(game);
    game.start();
    beforeLoad?.(game);
    const done = game.flow.restart();
    await vi.runAllTimersAsync();
    expect(await done).toMatchObject({ ok: true, scene: source.start() });
    return game;
  };
}
