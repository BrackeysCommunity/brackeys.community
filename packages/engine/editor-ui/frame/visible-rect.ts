import type { Aabb } from "../../editor/index";
import type { GameInstance, Vec2 } from "../../index";

/** Screen px of the canvas the frame's chrome covers on each side. */
export type CanvasInsets = { left: number; right: number; top: number; bottom: number };

/** The canvas's size in screen px and what the chrome covers of it. */
export type VisibleArea = { width: number; height: number; insets: CanvasInsets };

/**
 * What to hand `game.frame` and then `game.panBy` so `rect` fits the part of
 * the canvas the chrome leaves visible: the rect grown on each axis by the
 * covered fraction, and a pan of half the difference of the opposite insets.
 * An area too small to show anything frames the whole canvas instead.
 */
export function visibleFrame(rect: Aabb, area: VisibleArea): { rect: Aabb; pan: Vec2 } {
  const { width, height } = area;
  const insets = coverable(area);
  const seenX = width - insets.left - insets.right;
  const seenY = height - insets.top - insets.bottom;
  const growX = seenX > 0 ? width / seenX : 1;
  const growY = seenY > 0 ? height / seenY : 1;
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  const halfW = ((rect.maxX - rect.minX) * growX) / 2;
  const halfH = ((rect.maxY - rect.minY) * growY) / 2;
  return {
    rect: { minX: cx - halfW, minY: cy - halfH, maxX: cx + halfW, maxY: cy + halfH },
    pan: { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 },
  };
}

/** The insets that leave something visible; a side that would cover it all counts as none. */
function coverable({ width, height, insets }: VisibleArea): CanvasInsets {
  const x = width - insets.left - insets.right > 0;
  const y = height - insets.top - insets.bottom > 0;
  if (x && y) return insets;
  return {
    left: x ? insets.left : 0,
    right: x ? insets.right : 0,
    top: y ? insets.top : 0,
    bottom: y ? insets.bottom : 0,
  };
}

export type FramingGame = Pick<GameInstance, "frame" | "panBy">;

export type PanningGame = Pick<GameInstance, "screenToWorld" | "panBy" | "getStore">;

const areas = new WeakMap<object, () => VisibleArea | null>();

/**
 * Tells `frameInView` and `revealInView` where `game`'s canvas is visible; the frame keeps it
 * current while mounted. Returns the unregister.
 */
export function setVisibleArea(game: object, read: () => VisibleArea | null): () => void {
  areas.set(game, read);
  return () => {
    if (areas.get(game) === read) areas.delete(game);
  };
}

/**
 * Frames `rect` in the part of `game`'s canvas the editor's columns and bars
 * leave visible. Every framing path (the frame command, a problem, a prefab)
 * goes through here; without a frame mounted it is `game.frame`.
 */
export function frameInView(game: FramingGame, rect: Aabb): void {
  const area = areas.get(game)?.() ?? null;
  if (!area) {
    game.frame(rect);
    return;
  }
  const fit = visibleFrame(rect, area);
  game.frame(fit.rect);
  if (Math.abs(fit.pan.x) >= 0.5 || Math.abs(fit.pan.y) >= 0.5) game.panBy(fit.pan);
}

/**
 * Pans `game`, never zooming, so `rect` sits in the middle of the part of the
 * canvas the chrome leaves visible when any of it lies outside that part; true
 * when it panned. Without a frame mounted there is nothing to measure, so it
 * leaves the view alone.
 */
export function revealInView(game: PanningGame, rect: Aabb): boolean {
  const area = areas.get(game)?.() ?? null;
  if (!area) return false;
  const insets = coverable(area);
  const seen = {
    left: insets.left,
    top: insets.top,
    right: area.width - insets.right,
    bottom: area.height - insets.bottom,
  };
  const { scale } = game.getStore().state.camera;
  const origin = game.screenToWorld({ x: 0, y: 0 });
  const box = {
    left: (rect.minX - origin.x) * scale,
    top: (rect.minY - origin.y) * scale,
    right: (rect.maxX - origin.x) * scale,
    bottom: (rect.maxY - origin.y) * scale,
  };
  if (
    box.left >= seen.left &&
    box.right <= seen.right &&
    box.top >= seen.top &&
    box.bottom <= seen.bottom
  )
    return false;
  game.panBy({
    x: (seen.left + seen.right - box.left - box.right) / 2,
    y: (seen.top + seen.bottom - box.top - box.bottom) / 2,
  });
  return true;
}
