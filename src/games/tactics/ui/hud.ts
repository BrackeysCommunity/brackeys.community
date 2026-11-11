/**
 * The skirmish's HUD: a turn banner, the selected unit's card, an order menu
 * and the board's cell highlights, over the canvas through the engine's UI
 * seam. It reads the game's slice, drives the cursor from UI actions and
 * canvas clicks, and changes the game only by sending commands.
 */
import type { UiActionEvent, UiContext, UiHandle } from "@jams/engine";

import type { TacticsSlice } from "../types";
import { cellAttr, createCellLayer, EMPTY_HIGHLIGHTS, highlightsFor } from "./cells";
import {
  boardView,
  initialCursor,
  PLAYER_SIDE,
  stepCursor,
  type BoardView,
  type CursorInput,
  type CursorState,
  type Order,
} from "./cursor";
import { CLS, createStyles } from "./styles";

/** The UI actions the HUD listens to; all of them are the game's `ui: true` actions. */
export const HUD_ACTIONS = ["cursor", "confirm", "cancel", "end-turn", "next-unit"] as const;

type MenuOrder = Order | "wait" | "end-turn";
const MENU: readonly { order: MenuOrder; label: string }[] = [
  { order: "move", label: "Move" },
  { order: "attack", label: "Attack" },
  { order: "wait", label: "Wait" },
  { order: "end-turn", label: "End turn" },
];

/** How far a stick or d-pad axis has to go before the cursor steps. */
const NUDGE_AT = 0.5;
const axisSign = (v: number) => (v >= NUDGE_AT ? 1 : v <= -NUDGE_AT ? -1 : 0);

export function bannerText(slice: TacticsSlice | null): string {
  if (!slice) return "Setting up the board";
  if (slice.result === "won") return "Victory: the red side has fallen";
  if (slice.result === "lost") return "Defeat: the blue side has fallen";
  if (slice.side !== PLAYER_SIDE) return `Turn ${slice.turn} · The red side acts`;
  return `Turn ${slice.turn} · Your orders`;
}

const statusOf = (u: { moved: boolean; acted: boolean }) =>
  u.acted ? "Done" : u.moved ? "Moved" : "Ready";

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function createTacticsHud(ctx: UiContext<TacticsSlice>): UiHandle {
  const doc = ctx.root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    return node;
  };

  const root = el("div", CLS.root);
  root.dataset.motion = ctx.reducedMotion ? "reduced" : "full";
  root.appendChild(createStyles(doc));
  ctx.root.appendChild(root);

  const cells = createCellLayer(ctx, root, { pulse: !ctx.reducedMotion });

  const banner = el("div", CLS.banner);
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  root.appendChild(banner);

  const card = el("section", CLS.card);
  card.setAttribute("aria-label", "Selected unit");
  card.hidden = true;
  root.appendChild(card);

  const menu = el("div", CLS.menu);
  menu.setAttribute("role", "toolbar");
  menu.setAttribute("aria-label", "Orders");
  const buttons = new Map<MenuOrder, HTMLButtonElement>();
  for (const { order, label } of MENU) {
    const button = el("button", CLS.button);
    button.type = "button";
    button.textContent = label;
    button.dataset.order = order;
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") === "true") return;
      dispatch({ type: "order", order });
    });
    buttons.set(order, button);
    menu.appendChild(button);
  }
  root.appendChild(menu);

  const log = el("div", CLS.log);
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  root.appendChild(log);

  let view: BoardView | null = null;
  let state: CursorState = initialCursor();
  let placed = false;

  function dispatch(input: CursorInput): void {
    if (!view) return;
    const step = stepCursor(state, input, view);
    state = step.state;
    if (step.send) {
      if (!ctx.game.send(step.send)) state = stepCursor(state, { type: "sync" }, view).state;
    }
    render();
  }

  function renderCard(): void {
    const v = view;
    const id = v && (state.unit ?? v.unitAt(state.cell));
    const unit = v && id ? v.slice.units[id] : undefined;
    if (!v || !id || !unit) {
      card.hidden = true;
      return;
    }
    const cls = v.slice.classes[unit.class];
    const rows: [string, string][] = [
      ["Side", titleCase(unit.side)],
      ["HP", String(unit.hp)],
      ["Move", cls ? String(cls.move) : "?"],
      ["Range", cls ? `${cls.range[0]}–${cls.range[1]}` : "?"],
      ["Status", statusOf(unit)],
    ];
    const heading = el("h2");
    heading.textContent = `${titleCase(unit.class)} ${id}`;
    const list = el("dl");
    for (const [term, value] of rows) {
      const dt = el("dt");
      dt.textContent = term;
      const dd = el("dd");
      dd.textContent = value;
      list.append(dt, dd);
    }
    card.dataset.unit = id;
    card.replaceChildren(heading, list);
    card.hidden = false;
  }

  function renderMenu(): void {
    const v = view;
    const open = v !== null && v.canOrder() && state.mode !== "sent";
    const unit = open && state.unit !== null && v.canAct(state.unit) ? state.unit : null;
    const enabled: Record<MenuOrder, boolean> = {
      move: unit !== null && v!.reach(unit).length > 0,
      attack: unit !== null,
      wait: unit !== null,
      "end-turn": open,
    };
    for (const [order, button] of buttons) {
      button.setAttribute("aria-disabled", String(!enabled[order]));
      if (order === "move" || order === "attack")
        button.setAttribute("aria-pressed", String(state.order === order));
    }
  }

  function setText(node: HTMLElement, text: string): void {
    if (node.textContent !== text) node.textContent = text;
  }

  function render(): void {
    setText(banner, bannerText(view?.slice ?? null));
    setText(log, view?.slice.log.at(-1) ?? "");
    cells.render(view ? highlightsFor(state, view) : EMPTY_HIGHLIGHTS, view);
    root.dataset.cursor = cellAttr(state.cell);
    root.dataset.mode = state.mode;
    renderCard();
    renderMenu();
  }

  const unwatch = ctx.watch(
    (s) => s.game,
    () => {
      const slice = ctx.slice();
      view = slice ? boardView(slice) : null;
      if (view && !placed) {
        placed = true;
        const first = view.ready()[0];
        state = initialCursor(first ? view.slice.units[first]!.cell : [0, 0]);
      }
      if (view) state = stepCursor(state, { type: "sync" }, view).state;
      render();
    },
  );

  // The menu's own buttons answer Enter and Space while focused; the board's confirm and cancel wait.
  const menuFocused = () => menu.contains(doc.activeElement);
  let lastAxis = { x: 0, y: 0 };
  const onAction = (e: UiActionEvent) => {
    if (e.player !== 0) return;
    if (e.action === "cursor") {
      const next = { x: axisSign(e.vector?.x ?? 0), y: axisSign(e.vector?.y ?? 0) };
      const dx = next.x !== 0 && next.x !== lastAxis.x ? next.x : 0;
      const dy = next.y !== 0 && next.y !== lastAxis.y ? next.y : 0;
      lastAxis = next;
      if (dx !== 0 || dy !== 0) dispatch({ type: "nudge", dx, dy });
      return;
    }
    if (!e.down) return;
    switch (e.action) {
      case "confirm":
        // A pointer press is handled by the canvas's click, which knows the cell.
        if (e.device !== "pointer" && !menuFocused()) dispatch({ type: "confirm" });
        return;
      case "cancel":
        dispatch({ type: "cancel" });
        return;
      case "end-turn":
        if (!e.repeat) dispatch({ type: "order", order: "end-turn" });
        return;
      case "next-unit":
        dispatch({ type: "next-unit" });
        return;
    }
  };
  const offAction = ctx.game.input.onAction(onAction, { actions: HUD_ACTIONS });

  const cellOf = (e: MouseEvent) => {
    if (!view) return null;
    const p = ctx.game.clientToWorld(e.clientX, e.clientY);
    const cell = view.board.geometry.cellAt([p.x, p.y]);
    return view.inside(cell) ? cell : null;
  };
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const cell = cellOf(e);
    if (cell) dispatch({ type: "click", cell });
  };
  const onMove = (e: PointerEvent) => {
    const cell = cellOf(e);
    if (cell && cellAttr(cell) !== cellAttr(state.cell)) dispatch({ type: "point", cell });
  };
  ctx.canvas.addEventListener("click", onClick);
  ctx.canvas.addEventListener("pointermove", onMove);

  return {
    destroy() {
      offAction();
      ctx.canvas.removeEventListener("click", onClick);
      ctx.canvas.removeEventListener("pointermove", onMove);
      unwatch();
      cells.destroy();
      root.remove();
    },
  };
}
