/**
 * The title and result screens: a panel of plain DOM over the canvas,
 * shown while the menu or result scene is loaded. Start and Back to menu
 * send the scene's one command; the game asks for the next scene itself.
 * Continue loads the newest save through the instance's slots. Credits
 * opens the host's credits page (`UiContext.links.credits`) in a new tab
 * where it has one, and Install shows the browser's install prompt while
 * the host offers one (`UiContext.install`).
 * Nothing here is built, and the instance isn't read, while a level plays.
 */
import type { GameInstance, SaveSummary, UiActionEvent, UiContext, UiHandle } from "@jams/engine";

import type { TacticsFlowSlice, TacticsProgress } from "../runtime";

export const MENU_CLS = {
  root: "tactics-menu",
  panel: "tactics-menu-panel",
  title: "tactics-menu-title",
  line: "tactics-menu-line",
  note: "tactics-menu-note",
  error: "tactics-menu-error",
  save: "tactics-menu-save",
  actions: "tactics-menu-actions",
  button: "tactics-menu-button",
} as const;

const css = `
.${MENU_CLS.root} {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: rgb(8 10 20 / 0.45);
  color: #f4f1e8;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  pointer-events: auto;
}
.${MENU_CLS.panel} {
  min-width: min(320px, 100%);
  max-width: 420px;
  padding: 20px 24px;
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 8px;
  background: rgb(20 22 34 / 0.92);
  text-align: center;
}
.${MENU_CLS.title} { margin: 0 0 8px; font-size: 26px; font-weight: 700; letter-spacing: 0.02em; }
.${MENU_CLS.line} { margin: 4px 0; }
.${MENU_CLS.note} { margin: 12px 0 0; font-size: 12px; opacity: 0.75; }
.${MENU_CLS.save} { margin: 8px 0 0; font-size: 12px; }
.${MENU_CLS.error} { margin: 8px 0 0; font-size: 12px; color: #ffb4a8; }
.${MENU_CLS.actions} { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.${MENU_CLS.button} {
  font: inherit;
  font-weight: 600;
  padding: 8px 16px;
  border: 1px solid rgb(255 255 255 / 0.3);
  border-radius: 6px;
  background: #2f6cf0;
  color: #fff;
  cursor: pointer;
  text-decoration: none;
}
.${MENU_CLS.button}[data-kind="secondary"] { background: transparent; }
.${MENU_CLS.button}[aria-disabled="true"] { opacity: 0.45; cursor: default; }
.${MENU_CLS.button}:focus-visible { outline: 2px solid #ffd75e; outline-offset: 2px; }
`;

const SAVE_LINE_ID = "tactics-menu-save-line";

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A unit's name from its entity id: `blue-knight-1/unit` is "Blue knight 1". */
export const unitName = (id: string): string =>
  titleCase((id.split("/")[0] ?? id).replace(/^[a-z0-9-]+:/, "").replaceAll("-", " "));

/**
 * A listed scene's title, else its id. The flow source's list comes first;
 * a game with none (the editor's Play runs one scene) reads the project's
 * scene list, so the title screen names levels the same way everywhere.
 */
export function sceneTitle(game: Pick<GameInstance, "flow" | "project">, scene: string): string {
  const listed = game.flow.scenes.length > 0 ? game.flow.scenes : game.project()?.flow?.scenes;
  return listed?.find((s) => s.scene === scene)?.title ?? scene;
}

/** "Turn" counts the turn a level ended in; one turn is one blue and one red move. */
const turnsText = (n: number) => (n === 1 ? "1 turn" : `${n} turns`);

/** The result scene's lines, from the progress the level's end wrote. */
export function resultLines(
  progress: TacticsProgress,
  titleOf: (scene: string) => string,
  levels: number,
): { heading: string; lines: string[] } {
  const last = progress.last;
  if (!last) return { heading: "No level played yet", lines: [] };
  const level = titleOf(last.level);
  const won = last.result === "won";
  const lines = [
    won
      ? `${level} won in ${turnsText(last.turns)}`
      : `${level} lost after ${turnsText(last.turns)}`,
  ];
  if (won && progress.roster.length > 0)
    lines.push(`Still standing: ${progress.roster.map(unitName).join(", ")}`);
  lines.push(`Levels cleared: ${progress.cleared.length} of ${levels}`);
  return { heading: won ? "Victory" : "Defeat", lines };
}

/** The save Continue loads: the one saved last, autosaves included; a tie goes to the first slot by name. */
export function newestSave(saves: readonly SaveSummary[]): SaveSummary | null {
  let newest: SaveSummary | null = null;
  for (const s of saves) {
    if (
      !newest ||
      s.meta.savedAt > newest.meta.savedAt ||
      (s.meta.savedAt === newest.meta.savedAt && s.slot < newest.slot)
    )
      newest = s;
  }
  return newest;
}

export function createTacticsMenu(
  ctx: UiContext<TacticsFlowSlice>,
  opts: { levels: readonly string[] },
): UiHandle {
  const doc = ctx.root.ownerDocument;
  let root: HTMLElement | null = null;
  let shown: string | null = null;
  let offAction: (() => void) | null = null;
  let primary: HTMLButtonElement | null = null;
  let destroyed = false;
  // The menu's view of the saves: read again each time the menu screen comes up.
  let saved: { newest: SaveSummary | null; loading: boolean; error: string | null } = {
    newest: null,
    loading: false,
    error: null,
  };
  let listing = 0;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const titleOf = (scene: string) => sceneTitle(ctx.game, scene);
  const saveTitle = (s: SaveSummary) =>
    s.meta.title ? `${titleOf(s.meta.scene)} · ${s.meta.title}` : titleOf(s.meta.scene);

  function button(label: string, command: string | null, pending: boolean): HTMLButtonElement {
    const b = el("button", MENU_CLS.button, label);
    b.type = "button";
    if (command === null || pending) b.setAttribute("aria-disabled", "true");
    if (command !== null) b.dataset.command = command;
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-disabled") === "true" || command === null) return;
      if (ctx.game.send({ name: command })) b.setAttribute("aria-disabled", "true");
    });
    return b;
  }

  function menuPanel(flow: NonNullable<TacticsFlowSlice["flow"]>): HTMLElement {
    const panel = el("section", MENU_CLS.panel);
    const title = el("h1", MENU_CLS.title, "Tactics");
    title.id = "tactics-menu-title";
    panel.setAttribute("aria-labelledby", title.id);
    const next = opts.levels.find((l) => !flow.progress.cleared.includes(l)) ?? null;
    const line = el(
      "p",
      MENU_CLS.line,
      next ? `Next: ${titleOf(next)}` : "Every level cleared: play them again",
    );
    const actions = el("div", MENU_CLS.actions);
    primary = button(next ? "Start" : "Play again", "start", flow.next !== null);
    actions.append(primary, continueButton(flow));
    const install = ctx.install?.current();
    if (install) actions.append(installButton(install));
    const credits = ctx.links?.credits;
    if (credits) actions.append(creditsLink(credits));
    panel.append(title, line, actions);
    if (saved.newest) {
      const where = el("p", MENU_CLS.save, `Last save: ${saveTitle(saved.newest)}`);
      where.id = SAVE_LINE_ID;
      panel.append(where);
    }
    if (saved.error) {
      const error = el("p", MENU_CLS.error, saved.error);
      error.setAttribute("role", "alert");
      panel.append(error);
    }
    const store = ctx.game.saves?.store.describe;
    if (store) panel.append(el("p", MENU_CLS.note, store));
    return panel;
  }

  function continueButton(flow: NonNullable<TacticsFlowSlice["flow"]>): HTMLButtonElement {
    const newest = saved.newest;
    const b = el("button", MENU_CLS.button, saved.loading ? "Loading…" : "Continue");
    b.type = "button";
    b.dataset.kind = "secondary";
    b.dataset.action = "continue";
    const off = !newest || saved.loading || flow.next !== null;
    b.setAttribute("aria-disabled", String(off));
    if (saved.loading) b.setAttribute("aria-busy", "true");
    if (newest) {
      b.dataset.slot = newest.slot;
      b.setAttribute("aria-describedby", SAVE_LINE_ID);
    }
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-disabled") === "true" || !newest) return;
      void resume(newest.slot);
    });
    return b;
  }

  function installButton(install: () => Promise<boolean>): HTMLButtonElement {
    const b = el("button", MENU_CLS.button, "Install");
    b.type = "button";
    b.dataset.kind = "secondary";
    b.dataset.action = "install";
    b.addEventListener("click", () => void install());
    return b;
  }

  /** The build's credits page, in a new tab so the game keeps its place. */
  function creditsLink(href: string): HTMLAnchorElement {
    const a = el("a", MENU_CLS.button, "Credits");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.dataset.kind = "secondary";
    a.dataset.action = "credits";
    return a;
  }

  async function resume(slot: string): Promise<void> {
    saved = { ...saved, loading: true, error: null };
    rerender();
    const loaded = await ctx.game.saves.load(slot);
    if (destroyed) return;
    saved = {
      ...saved,
      loading: false,
      error: loaded.ok ? null : `That save couldn't be loaded: ${loaded.issue.message}`,
    };
    rerender();
  }

  /** Reads the slots for Continue; a later read wins over one still in flight. */
  async function listSaves(): Promise<void> {
    const ask = ++listing;
    let newest: SaveSummary | null = null;
    try {
      newest = newestSave((await ctx.game.saves?.list()) ?? []);
    } catch {
      newest = null;
    }
    if (destroyed || ask !== listing) return;
    saved = { ...saved, newest };
    rerender();
  }

  function resultPanel(flow: NonNullable<TacticsFlowSlice["flow"]>): HTMLElement {
    const panel = el("section", MENU_CLS.panel);
    const { heading, lines } = resultLines(flow.progress, titleOf, opts.levels.length);
    const title = el("h1", MENU_CLS.title, heading);
    title.id = "tactics-result-title";
    panel.setAttribute("aria-labelledby", title.id);
    panel.append(title, ...lines.map((l) => el("p", MENU_CLS.line, l)));
    const actions = el("div", MENU_CLS.actions);
    primary = button("Back to menu", "menu", flow.next !== null);
    actions.append(primary);
    panel.append(actions);
    return panel;
  }

  function hide(): void {
    listing++;
    saved = { newest: null, loading: false, error: null };
    offAction?.();
    offAction = null;
    root?.remove();
    root = null;
    primary = null;
    shown = null;
  }

  // A pad's confirm presses the screen's button; a focused button already answers Enter itself.
  const onAction = (e: UiActionEvent) => {
    if (e.player !== 0 || !e.down || e.repeat || e.device === "pointer") return;
    if (root?.contains(doc.activeElement)) return;
    primary?.click();
  };

  function focusedKey(): string | null {
    const active = doc.activeElement as HTMLElement | null;
    if (!active || !root?.contains(active)) return null;
    if (active.dataset.action) return `[data-action="${active.dataset.action}"]`;
    if (active.dataset.command) return `[data-command="${active.dataset.command}"]`;
    return null;
  }

  function rerender(): void {
    shown = null;
    render(ctx.slice());
  }

  function render(slice: TacticsFlowSlice | null): void {
    const flow = slice?.flow;
    if (!flow || flow.screen === "level") return hide();
    const key = JSON.stringify([flow.screen, flow.scene, flow.next, flow.progress]);
    if (key === shown) return;
    const refocus = !root || root.dataset.screen !== flow.screen;
    if (refocus && flow.screen === "menu") void listSaves();
    if (!root) {
      root = el("div", MENU_CLS.root);
      const style = el("style");
      style.textContent = css;
      root.appendChild(style);
      ctx.root.appendChild(root);
      offAction = ctx.game.input.onAction(onAction, { actions: ["confirm"] });
    }
    // A redraw of the same screen keeps focus on the button that had it.
    const had = refocus ? null : focusedKey();
    root.dataset.screen = flow.screen;
    const panel = flow.screen === "menu" ? menuPanel(flow) : resultPanel(flow);
    root.querySelector(`.${MENU_CLS.panel}`)?.remove();
    root.appendChild(panel);
    shown = key;
    if (had) panel.querySelector<HTMLElement>(had)?.focus({ preventScroll: true });
    else if (refocus && flow.next === null) primary?.focus({ preventScroll: true });
  }

  const unwatch = ctx.watch(
    (s) => s.game,
    () => render(ctx.slice()),
  );
  const offInstall = ctx.install?.onChange(() => {
    if (root) rerender();
  });

  return {
    destroy() {
      destroyed = true;
      unwatch();
      offInstall?.();
      hide();
    },
  };
}
