import type { GameInstance, GameStoreState } from "../types";
import type { MountUi, UiContext, UiHandle } from "./types";

const mountedCancels = new WeakMap<GameInstance, (() => boolean)[]>();

/** Offers Escape to the UIs mounted over `game`, newest first; true when one used it. */
export function cancelMountedUi(game: GameInstance): boolean {
  const cancels = mountedCancels.get(game);
  if (!cancels) return false;
  for (let i = cancels.length - 1; i >= 0; i--) if (cancels[i]?.()) return true;
  return false;
}

function registerCancel(game: GameInstance, cancel: () => boolean): () => void {
  let cancels = mountedCancels.get(game);
  if (!cancels) mountedCancels.set(game, (cancels = []));
  cancels.push(cancel);
  return () => {
    const i = cancels.indexOf(cancel);
    if (i !== -1) cancels.splice(i, 1);
  };
}

/** Dispatched on a layer's root after it follows a resize of its canvas. */
export const UI_LAYER_RESIZE = "jams-ui-resize";

/** Calls `fn` whenever `el`'s box changes: a ResizeObserver, or the window's `resize` where none exists. */
function observeResize(el: HTMLElement, fn: () => void): () => void {
  const view = el.ownerDocument.defaultView;
  const Observer = view?.ResizeObserver;
  if (Observer) {
    const observer = new Observer(() => fn());
    observer.observe(el);
    return () => observer.disconnect();
  }
  if (!view) return () => {};
  view.addEventListener("resize", fn);
  return () => view.removeEventListener("resize", fn);
}

const EFFECT_ATTR = "data-jams-effects";

/**
 * A layer over `canvas`'s box, resized with it: a sibling right after the
 * canvas, or right after the effect overlay when one is there, so the
 * overlay stays first and paints under every other layer.
 */
function createCanvasLayer(
  canvas: HTMLCanvasElement,
  name: string,
  style: Partial<CSSStyleDeclaration>,
  opts: { first?: boolean } = {},
): { root: HTMLElement; destroy(): void } {
  if (!canvas.parentElement) throw new Error(`${name}: the canvas isn't in a document`);
  const root = canvas.ownerDocument.createElement("div");
  Object.assign(root.style, { position: "absolute", pointerEvents: "none", margin: "0", ...style });

  // A sibling shares the canvas's offset parent, so offsetLeft/Top place it over the canvas's box.
  const sync = () => {
    Object.assign(root.style, {
      left: `${canvas.offsetLeft}px`,
      top: `${canvas.offsetTop}px`,
      width: `${canvas.offsetWidth}px`,
      height: `${canvas.offsetHeight}px`,
    });
  };
  sync();
  const next = canvas.nextElementSibling;
  const anchor = !opts.first && next?.hasAttribute(EFFECT_ATTR) ? next : canvas;
  anchor.after(root);
  const unobserve = observeResize(canvas, () => {
    sync();
    root.dispatchEvent(new Event(UI_LAYER_RESIZE));
  });

  let destroyed = false;
  return {
    root,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unobserve();
      root.remove();
    },
  };
}

/**
 * The overlay a MountUi draws into: absolutely positioned over `canvas`,
 * resized with it. It isolates its children's z-indexes, so the transition
 * layer covers all of them.
 */
export function createUiLayer(canvas: HTMLCanvasElement): {
  root: HTMLElement;
  destroy(): void;
} {
  const layer = createCanvasLayer(canvas, "createUiLayer", { isolation: "isolate" });
  layer.root.setAttribute("data-jams-ui", "");
  return layer;
}

/**
 * The layer scene transitions and the loading view draw into: over
 * `canvas` like the UI layer and stacked above it and the touch controls,
 * so a fade covers the HUD.
 */
export function createTransitionLayer(canvas: HTMLCanvasElement): {
  root: HTMLElement;
  destroy(): void;
} {
  const layer = createCanvasLayer(canvas, "createTransitionLayer", { zIndex: "2" });
  layer.root.setAttribute("data-jams-transition", "");
  return layer;
}

/**
 * The layer full-canvas effects (a flash) draw into: over `canvas`, under
 * the UI layer, the touch controls and the transition layer whichever is
 * made first. It never takes input; nothing in it opts back in.
 */
export function createEffectOverlay(canvas: HTMLCanvasElement): {
  root: HTMLElement;
  destroy(): void;
} {
  const layer = createCanvasLayer(
    canvas,
    "createEffectOverlay",
    { overflow: "hidden" },
    { first: true },
  );
  layer.root.setAttribute(EFFECT_ATTR, "");
  layer.root.setAttribute("aria-hidden", "true");
  return layer;
}

/**
 * createUiLayer + the context + mount; the returned function unmounts and
 * removes the layer. `opts.links` is the host's pages, given to the UI as
 * `UiContext.links`.
 */
export function mountUi<G>(
  game: GameInstance,
  canvas: HTMLCanvasElement,
  mount: MountUi<G>,
  opts: { links?: UiContext["links"] } = {},
): () => void {
  const layer = createUiLayer(canvas);
  const store = game.getStore();
  const subscriptions = new Set<() => void>();

  function watch<T>(
    select: (s: GameStoreState) => T,
    fn: (value: T, prev: T | undefined) => void,
  ): () => void {
    let current = select(store.state);
    const unsubscribe = store.subscribe(() => {
      const next = select(store.state);
      if (Object.is(next, current)) return;
      const prev = current;
      current = next;
      fn(next, prev);
    });
    const drop = () => {
      if (!subscriptions.delete(drop)) return;
      unsubscribe();
    };
    subscriptions.add(drop);
    fn(current, undefined);
    return drop;
  }

  const ctx: UiContext<G> = {
    root: layer.root,
    canvas,
    game,
    slice: () => (store.state.game ?? null) as G | null,
    watch,
    settings: game.project()?.settings ?? {},
    reducedMotion: game.reducedMotion,
    ...(opts.links ? { links: { ...opts.links } } : {}),
  };

  const release = () => {
    for (const drop of [...subscriptions]) drop();
    layer.destroy();
  };

  let handle: UiHandle;
  try {
    handle = mount(ctx);
  } catch (err) {
    release();
    throw err;
  }

  const ui = handle;
  const unregister = ui.cancel ? registerCancel(game, () => ui.cancel?.() ?? false) : () => {};

  let unmounted = false;
  return () => {
    if (unmounted) return;
    unmounted = true;
    unregister();
    try {
      handle.destroy();
    } finally {
      release();
    }
  };
}
