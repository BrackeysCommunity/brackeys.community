import type { GameStoreState, Vec2 } from "../types";
import { UI_LAYER_RESIZE } from "./layer";
import type { UiContext } from "./types";

const toText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v as string | number | boolean | bigint | symbol);
};

/** Keeps `el.textContent` equal to `format(select(state))`. */
export function bindText<T>(
  el: HTMLElement,
  ctx: UiContext,
  select: (s: GameStoreState) => T,
  format: (v: T) => string = toText,
): () => void {
  return ctx.watch(select, (value) => {
    const text = format(value);
    if (el.textContent !== text) el.textContent = text;
  });
}

/**
 * Keeps `el` at a world point (through worldToClient and the camera), e.g. a
 * label over an entity. `el` is placed at the layer's top-left corner and
 * moved with a transform whenever `watchView` calls, and whenever a store
 * change moves the point `at()` returns; it is hidden while `at()` is null.
 */
export function bindToWorld(el: HTMLElement, ctx: UiContext, at: () => Vec2 | null): () => void {
  const shownVisibility = el.style.visibility;
  Object.assign(el.style, { position: "absolute", left: "0px", top: "0px" });

  let placed: Vec2 | null = null;
  const place = (viewMoved: boolean) => {
    const p = at();
    if (!p) {
      placed = null;
      el.style.visibility = "hidden";
      return;
    }
    // A store change that left both the view and the point alone has nothing to move.
    if (!viewMoved && placed && placed.x === p.x && placed.y === p.y) return;
    placed = { x: p.x, y: p.y };
    const client = ctx.game.worldToClient(p);
    const origin = ctx.root.getBoundingClientRect();
    const transform = `translate(${client.x - origin.left}px, ${client.y - origin.top}px)`;
    if (el.style.transform !== transform) el.style.transform = transform;
    el.style.visibility = shownVisibility;
  };

  const unwatchView = watchView(ctx, () => place(true));
  const unwatchPoint = ctx.watch(
    (s) => s,
    () => place(false),
  );
  return () => {
    unwatchView();
    unwatchPoint();
  };
}

/**
 * Calls `fn` now and whenever where the world shows on screen may have
 * moved: when the camera changes and when the layer follows a canvas resize.
 * For DOM sized or placed by `worldToClient`. Returns the unsubscribe.
 */
export function watchView(ctx: UiContext, fn: () => void): () => void {
  const onView = () => fn();
  const unwatch = ctx.watch((s) => s.camera, onView);
  ctx.root.addEventListener(UI_LAYER_RESIZE, onView);
  return () => {
    unwatch();
    ctx.root.removeEventListener(UI_LAYER_RESIZE, onView);
  };
}
