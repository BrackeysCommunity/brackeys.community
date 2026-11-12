import type { Vec2 } from "./types";

/** A template about to be placed: where (world metres) and at what rotation. */
export type PlacementGhost<T> = { template: T; at: Vec2; /** Radians. */ rotation: number };

export type PlacementCheck = { valid: boolean; reason?: string };

/** How the host draws the ghost; each is called only when the ghost's visibility or pose changes. */
export type PlacementDraw<T> = {
  show(ghost: PlacementGhost<T>): void;
  pose(ghost: PlacementGhost<T>): void;
  hide(): void;
};

export type PlacementToolOptions<T> = {
  draw: PlacementDraw<T>;
  validate(ghost: PlacementGhost<T>): PlacementCheck;
  /** Runs only after `validate` passed. */
  commit(ghost: PlacementGhost<T>): void;
  /** Templates that turn; omitted, every one does. */
  rotatable?(template: T): boolean;
  /** Radians per `rotate` unit; default 0.15 (about 8.6° per wheel notch). */
  rotateStep?: number;
};

export type PlacementTool<T> = {
  selected: () => T | null;
  /** Picks a template at rotation 0 and shows its ghost where the pointer last was. */
  select: (template: T) => void;
  /** Drops the template and hides the ghost. */
  clear: () => void;
  /** Follows the pointer, in world metres; with `show` false the ghost stays hidden (the host isn't placing now). */
  move: (at: Vec2, show?: boolean) => void;
  /** Turns the ghost by `delta` steps, for a rotatable template. */
  rotate: (delta: number) => void;
  /** Hides the ghost and keeps the template, until the next `move`. */
  hide: () => void;
  ghost: () => PlacementGhost<T> | null;
  /** Validates the ghost and commits it when valid. */
  place: () => PlacementCheck;
  destroy: () => void;
};

export const DEFAULT_ROTATE_STEP = 0.15;

/**
 * Select a template, move its ghost with the pointer, rotate it, place it:
 * validate, then commit. The host decides what a placement makes (a body
 * mid-game, an `add` op in the editor) and how the ghost is drawn.
 */
export function createPlacementTool<T>(opts: PlacementToolOptions<T>): PlacementTool<T> {
  const step = opts.rotateStep ?? DEFAULT_ROTATE_STEP;
  let template: T | null = null;
  let at: Vec2 = { x: 0, y: 0 };
  let rotation = 0;
  let shown = false;

  const ghost = (): PlacementGhost<T> | null =>
    template === null ? null : { template, at: { ...at }, rotation };

  function show(): void {
    const g = ghost();
    if (!g) return;
    opts.draw.show(g);
    shown = true;
  }

  function hide(): void {
    if (shown) opts.draw.hide();
    shown = false;
  }

  return {
    selected: () => template,
    select(next) {
      template = next;
      rotation = 0;
      show();
    },
    clear() {
      template = null;
      hide();
    },
    move(next, visible = true) {
      at = { x: next.x, y: next.y };
      if (!visible || template === null) return hide();
      if (shown) opts.draw.pose(ghost()!);
      else show();
    },
    rotate(delta) {
      if (template === null || opts.rotatable?.(template) === false) return;
      rotation += delta * step;
      if (shown) opts.draw.pose(ghost()!);
    },
    hide,
    ghost,
    place() {
      const g = ghost();
      if (!g) return { valid: false, reason: "Nothing selected" };
      const check = opts.validate(g);
      if (!check.valid) return check;
      opts.commit(g);
      return { valid: true };
    },
    destroy: hide,
  };
}
