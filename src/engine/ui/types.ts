import type { GameInstance, GameStoreState } from "../types";

/** What a game's DOM UI is given when a host mounts it over the canvas. */
export type UiContext<G = unknown> = {
  /** A div over the canvas with the canvas's box; pointer-events none, so children opt in with "auto". */
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  game: GameInstance;
  /** The store's `game` field (GameRuntime.storeSlice), typed by the game; null before the first load. */
  slice(): G | null;
  /** Calls `fn` now and whenever `select`'s result changes by identity; returns the unsubscribe. */
  watch<T>(
    select: (s: GameStoreState) => T,
    fn: (value: T, prev: T | undefined) => void,
  ): () => void;
  /** game-settings' `game` block, defaults applied; {} without a project. */
  settings: Readonly<Record<string, unknown>>;
  /** True when the page prefers reduced motion; HUDs skip their own animations. */
  reducedMotion: boolean;
};

/** What a mounted UI hands back: `destroy` removes everything it added. */
export type UiHandle = { destroy(): void };

/** A game's DOM UI, named by the project file's `ui` key. */
export type MountUi<G = unknown> = (ctx: UiContext<G>) => UiHandle;
