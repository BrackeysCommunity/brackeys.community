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
 * moved with a transform; it re-runs whenever `watchView` calls, and is
 * hidden while `at()` is null.
 */
export function bindToWorld(el: HTMLElement, ctx: UiContext, at: () => Vec2 | null): () => void {
  const shownVisibility = el.style.visibility;
  Object.assign(el.style, { position: "absolute", left: "0px", top: "0px" });

  const place = () => {
    const p = at();
    if (!p) {
      el.style.visibility = "hidden";
      return;
    }
    const client = ctx.game.worldToClient(p);
    const origin = ctx.root.getBoundingClientRect();
    const transform = `translate(${client.x - origin.left}px, ${client.y - origin.top}px)`;
    if (el.style.transform !== transform) el.style.transform = transform;
    el.style.visibility = shownVisibility;
  };

  return watchView(ctx, place);
}

/**
 * Calls `fn` now and whenever where the world shows on screen may have
 * moved: on every store change (the camera's among them) and when the layer
 * follows a canvas resize. For DOM sized or placed by `worldToClient`.
 * Returns the unsubscribe.
 */
export function watchView(ctx: UiContext, fn: () => void): () => void {
  const onResize = () => fn();
  const unwatch = ctx.watch((s) => s, onResize);
  ctx.root.addEventListener(UI_LAYER_RESIZE, onResize);
  return () => {
    unwatch();
    ctx.root.removeEventListener(UI_LAYER_RESIZE, onResize);
  };
}
