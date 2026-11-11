/**
 * Cell highlights as DOM: one element per highlighted cell, each kept over
 * its cell's centre with `bindToWorld` and sized to a cell on screen through
 * two CSS variables the layer keeps current.
 */
import { bindToWorld, watchView, type UiContext } from "@jams/engine";
import type { Cell } from "@jams/engine/game";

import { PLAYER_SIDE, type BoardView, type CursorState } from "./cursor";
import { CLS } from "./styles";

export type HighlightKind = "fog" | "reach" | "attack" | "target" | "cursor";
export type Highlights = Readonly<Record<HighlightKind, readonly Cell[]>>;

/** Kinds back to front; the stylesheet stacks them in this order. */
const KINDS: readonly HighlightKind[] = ["fog", "reach", "attack", "target", "cursor"];
/** Kinds that pulse unless the page prefers reduced motion. */
const pulses = (k: HighlightKind) => k === "reach" || k === "attack" || k === "target";

export const EMPTY_HIGHLIGHTS: Highlights = {
  fog: [],
  reach: [],
  attack: [],
  target: [],
  cursor: [],
};

/** What to highlight for a cursor state: fog always, then the selected unit's reach and strike cells under its menu order. */
export function highlightsFor(s: CursorState, v: BoardView): Highlights {
  const unit = s.mode === "selected" || s.mode === "target" ? s.unit : null;
  const own = unit !== null && v.slice.units[unit]?.side === PLAYER_SIDE;
  return {
    fog: v.fog(),
    reach: own && s.order !== "attack" ? v.reach(unit) : [],
    attack: own && s.order !== "move" ? v.attackCells(unit) : [],
    target: s.mode === "target" && s.targetCell ? [s.targetCell] : [],
    cursor: [s.cell],
  };
}

export const cellAttr = (c: Cell): string => `${c[0]},${c[1]}`;

export type CellLayer = {
  render(h: Highlights, view: BoardView | null): void;
  destroy(): void;
};

export function createCellLayer(
  ctx: UiContext,
  parent: HTMLElement,
  opts: { pulse: boolean },
): CellLayer {
  const doc = parent.ownerDocument;
  const layer = doc.createElement("div");
  layer.className = CLS.cells;
  layer.setAttribute("aria-hidden", "true");
  parent.appendChild(layer);

  let view: BoardView | null = null;
  const centre = (c: Cell) => {
    if (!view) return null;
    const [x, y] = view.board.geometry.center(c);
    return { x, y };
  };

  const measure = () => {
    if (!view) return;
    const size = view.slice.grid.cell;
    const a = ctx.game.worldToClient({ x: 0, y: 0 });
    const b = ctx.game.worldToClient({ x: size, y: size });
    layer.style.setProperty("--tactics-cell-w", `${b.x - a.x}px`);
    layer.style.setProperty("--tactics-cell-h", `${b.y - a.y}px`);
  };
  const unwatchView = watchView(ctx, measure);

  const shown = new Map<string, { el: HTMLElement; unbind: () => void }>();

  function add(kind: HighlightKind, cell: Cell): { el: HTMLElement; unbind: () => void } {
    const el = doc.createElement("div");
    el.className = `${CLS.cell} ${CLS.cell}-${kind}`;
    if (opts.pulse && pulses(kind)) el.classList.add(CLS.pulse);
    el.dataset.highlight = kind;
    el.dataset.cell = cellAttr(cell);
    const at: Cell = [cell[0], cell[1]];
    const unbind = bindToWorld(el, ctx, () => centre(at));
    return { el, unbind };
  }

  return {
    render(h, next) {
      view = next;
      measure();
      const wanted = new Map<string, [HighlightKind, Cell]>();
      if (view)
        for (const kind of KINDS)
          for (const c of h[kind]) wanted.set(`${kind}:${cellAttr(c)}`, [kind, c]);
      for (const [key, entry] of shown) {
        if (wanted.has(key)) continue;
        entry.unbind();
        entry.el.remove();
        shown.delete(key);
      }
      for (const [key, [kind, cell]] of wanted) {
        if (shown.has(key)) continue;
        const entry = add(kind, cell);
        shown.set(key, entry);
        layer.appendChild(entry.el);
      }
    },
    destroy() {
      for (const { unbind } of shown.values()) unbind();
      shown.clear();
      unwatchView();
      layer.remove();
    },
  };
}
