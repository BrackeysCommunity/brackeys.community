import type { GameInstance, GameStoreState } from "../types";
import type { MountUi, UiContext, UiHandle } from "./types";

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

/** The overlay a MountUi draws into: absolutely positioned over `canvas`, resized with it. */
export function createUiLayer(canvas: HTMLCanvasElement): {
  root: HTMLElement;
  destroy(): void;
} {
  if (!canvas.parentElement) throw new Error("createUiLayer: the canvas isn't in a document");
  const root = canvas.ownerDocument.createElement("div");
  root.setAttribute("data-jams-ui", "");
  Object.assign(root.style, { position: "absolute", pointerEvents: "none", margin: "0" });

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
  canvas.after(root);
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

/** createUiLayer + the context + mount; the returned function unmounts and removes the layer. */
export function mountUi<G>(
  game: GameInstance,
  canvas: HTMLCanvasElement,
  mount: MountUi<G>,
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

  const view = canvas.ownerDocument.defaultView;
  const ctx: UiContext<G> = {
    root: layer.root,
    canvas,
    game,
    slice: () => (store.state.game ?? null) as G | null,
    watch,
    settings: game.project()?.settings ?? {},
    reducedMotion:
      typeof view?.matchMedia === "function" &&
      view.matchMedia("(prefers-reduced-motion: reduce)").matches,
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

  let unmounted = false;
  return () => {
    if (unmounted) return;
    unmounted = true;
    try {
      handle.destroy();
    } finally {
      release();
    }
  };
}
