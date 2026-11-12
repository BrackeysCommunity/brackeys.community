import type { GameInstance, GameStoreState } from "../types";

/** What a game's DOM UI is given when a host mounts it over the canvas. */
export type UiContext<G = unknown> = {
  /**
   * A div over the canvas with the canvas's box; pointer-events none, so
   * children opt in with "auto". A host whose own chrome floats over the
   * canvas sets `--jams-ui-safe-top`, `-right`, `-bottom` and `-left` (px
   * from each edge of the layer that chrome covers) on an ancestor; HUD
   * panels offset by them, e.g. `top: calc(var(--jams-ui-safe-top, 0px) + 8px)`.
   */
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
  /**
   * Pages the host ships beside the game, as URLs a link can open; absent
   * where the host has none. An exported build sets `credits` to its
   * `credits.html`.
   */
  links?: { credits?: string };
  /**
   * The browser's install prompt where the host can offer one (an exported
   * build with the PWA on); absent elsewhere. An Install button shows while
   * `current()` is a function.
   */
  install?: {
    /** Shows the browser's prompt, resolving true once it was accepted; null while the browser offers none. */
    current(): (() => Promise<boolean>) | null;
    /** Calls `fn` whenever `current()` turns from null to a function or back; returns the unsubscribe. */
    onChange(fn: () => void): () => void;
  };
};

/**
 * What a mounted UI hands back: `destroy` removes everything it added.
 * `cancel` is offered Escape in play (`GameInstance.cancel`) after the
 * game's own attachment; it returns true when it used it (cleared a
 * selection), so play goes on instead of stopping.
 */
export type UiHandle = { destroy(): void; cancel?(): boolean };

/** A game's DOM UI, named by the project file's `ui` key. */
export type MountUi<G = unknown> = (ctx: UiContext<G>) => UiHandle;
