/**
 * The skirmish's HUD: a turn banner, the selected unit's card, an order menu
 * and the board's cell highlights, over the canvas through the engine's UI
 * seam. It reads the game's slice, drives the cursor from UI actions and
 * canvas clicks, and changes the game only by sending commands.
 */
import type { UiActionEvent, UiContext, UiHandle } from "@jams/engine";
import { cellKey, type Cell, type CellKey } from "@jams/engine/game";

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
export const HUD_ACTIONS = [
  "cursor",
  "confirm",
  "cancel",
  "wait",
  "end-turn",
  "next-unit",
] as const;

type MenuOrder = Order | "wait" | "end-turn";
const MENU: readonly { order: MenuOrder; label: string }[] = [
  { order: "move", label: "Move" },
  { order: "attack", label: "Attack" },
  { order: "wait", label: "Wait" },
  { order: "end-turn", label: "End turn" },
];

/** How many of the slice's log lines the HUD shows; the rest stay in the slice. */
const LOG_SHOWN = 3;

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

const rangeText = ([near, far]: readonly [number, number]) =>
  near === far ? String(near) : `${near}–${far}`;

const fogCache = new WeakMap<BoardView, ReadonlySet<CellKey>>();
/** Whether no unit of the player's side sees `cell`. */
function fogged(v: BoardView, cell: Cell): boolean {
  let fog = fogCache.get(v);
  if (!fog) {
    fog = new Set(v.fog().map(cellKey));
    fogCache.set(v, fog);
  }
  return fog.has(cellKey(cell));
}

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

  const top = el("div", CLS.top);
  const side = el("div", CLS.side);
  const banner = el("div", CLS.banner);
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const card = el("section", CLS.card);
  card.setAttribute("aria-label", "Selected unit");
  card.hidden = true;

  // The last few lines for the eye; the live region below announces each new one once.
  const log = el("ol", CLS.log);
  log.setAttribute("aria-hidden", "true");
  log.hidden = true;

  side.append(card, log);
  top.append(side, banner);
  root.appendChild(top);

  const menu = el("div", CLS.menu);
  menu.setAttribute("role", "group");
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
      // Hand the keys back to the board, so the next Enter confirms there instead of pressing this again.
      releaseMenuFocus();
    });
    buttons.set(order, button);
    menu.appendChild(button);
  }
  root.appendChild(menu);

  const live = el("div", CLS.live);
  live.setAttribute("role", "log");
  live.setAttribute("aria-live", "polite");
  root.appendChild(live);

  function releaseMenuFocus(): void {
    if (!menu.contains(doc.activeElement)) return;
    ctx.canvas.focus({ preventScroll: true });
    // A canvas without a tabindex takes no focus, so the button lets go of it itself.
    const still = doc.activeElement as HTMLElement | null;
    if (still && menu.contains(still)) still.blur();
  }

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
    if (!v || !id || !unit || (unit.side !== PLAYER_SIDE && fogged(v, unit.cell))) {
      card.hidden = true;
      delete card.dataset.unit;
      return;
    }
    const cls = v.slice.classes[unit.class];
    const rows: [string, string][] = [
      ["HP", cls ? `${unit.hp}/${cls.hp}` : String(unit.hp)],
      ["Move", cls ? String(cls.move) : "?"],
      ["Range", cls ? rangeText(cls.range) : "?"],
      ["Status", statusOf(unit)],
    ];
    const heading = el("h2");
    heading.textContent = `${titleCase(unit.side)} ${unit.class}`;
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

  let shownLog: readonly string[] = [];
  function renderLog(lines: readonly string[]): void {
    const recent = lines.slice(-LOG_SHOWN);
    if (recent.length === shownLog.length && recent.every((l, i) => l === shownLog[i])) return;
    shownLog = recent;
    log.replaceChildren(
      ...recent.map((line) => {
        const item = el("li");
        item.textContent = line;
        return item;
      }),
    );
    log.hidden = recent.length === 0;
  }

  function render(): void {
    setText(banner, bannerText(view?.slice ?? null));
    setText(live, view?.slice.log.at(-1) ?? "");
    renderLog(view?.slice.log ?? []);
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

  // A focused menu button answers Enter and Space itself; the board's confirm waits until it lets go.
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
      case "wait":
        if (!e.repeat) dispatch({ type: "order", order: "wait" });
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
