/** The dialogue box and text log: DOM helpers a game's `MountUi` mounts over the canvas. */
import type { DialogueLogEntry, DialogueView } from "../dialogue/runner";
import { DIALOGUE_ADVANCE_COMMAND, DIALOGUE_CHOOSE_COMMAND } from "../game/commands";
import type { GameCommand } from "../game/types";
import type { DialogueLine } from "../project/kinds/dialogue";
import { parseRichText, richPlainText, type RichLine } from "../text/rich";
import type { StringTable } from "../text/strings";
import { isEditableTarget } from "../tool-router";
import type { UiActionEvent } from "../types";
import { followLocale, onLocale, styleElement, UI_FONT_FAMILY, UI_THEME, uiInset } from "./bind";
import {
  renderRichText,
  renderRichTextPartly,
  richTextLength,
  setAssetBackground,
} from "./rich-dom";
import type { UiContext, UiHandle } from "./types";

export type DialogueBoxOptions = {
  /** Characters per second; Infinity, or reduced motion, shows lines whole. Default 40. */
  speed?: number;
  /**
   * UI-only actions that advance and move between choices; default
   * "confirm", "up", "down". While the game binds nothing to one, Enter and
   * Space advance and ArrowUp and ArrowDown move in its place.
   */
  actions?: { advance?: string; up?: string; down?: string };
  portraits?: boolean;
  className?: string;
};

export type TextLogOptions = {
  /** A UI-only action that shows and hides it. */
  toggle?: string;
  max?: number;
};

const DEFAULT_SPEED = 40;
/** The portrait slot's side, px; an atlas frame scales to fill it. */
const PORTRAIT_PX = 96;

/** The custom property on the UI root holding the shown box's height plus a gap. */
export const DIALOGUE_INSET = "--jams-dialogue-inset";

/**
 * Zero-specificity defaults, so a game's own class or stylesheet wins.
 * Colours and size read custom properties a host may set on any ancestor.
 */
const BOX_CSS = `
:where([data-jams-dialogue]) {
  position: absolute;
  left: ${uiInset("left")};
  right: ${uiInset("right")};
  bottom: ${uiInset("bottom")};
  max-width: 720px;
  max-height: calc(100% - var(--jams-ui-safe-top, 0px) - var(--jams-ui-safe-bottom, 0px) - 32px);
  overflow-y: auto;
  margin-inline: auto;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  box-sizing: border-box;
  padding: 12px 16px;
  border-radius: ${UI_THEME.radius};
  background: ${UI_THEME.bg};
  color: ${UI_THEME.fg};
  font-family: ${UI_FONT_FAMILY};
  font-size: var(--jams-dialogue-font-size, 18px);
  line-height: 1.4;
  cursor: pointer;
  user-select: none;
}
:where([data-jams-dialogue])[hidden] { display: none; }
:where([data-jams-dialogue-portrait]) {
  flex: none; width: ${PORTRAIT_PX}px; height: ${PORTRAIT_PX}px; display: grid; place-items: center;
}
:where([data-jams-dialogue-portrait])[hidden] { display: none; }
:where([data-jams-dialogue-portrait-art]) { width: 100%; height: 100%; }
:where([data-jams-dialogue-body]) { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
:where([data-jams-dialogue-speaker]) { font-weight: bold; color: ${UI_THEME.accent}; }
:where([data-jams-dialogue-line]) { min-height: 2.8em; white-space: pre-wrap; overflow-wrap: anywhere; }
:where([data-jams-dialogue-hint]) { align-self: flex-end; opacity: 0.7; font-size: 0.75em; }
:where([data-jams-dialogue-choices]) { display: flex; flex-direction: column; gap: 4px; }
:where([data-jams-dialogue-choices]) button {
  font: inherit;
  color: inherit;
  text-align: start;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: calc(${UI_THEME.radius} - 2px);
  background: ${UI_THEME.choice};
  cursor: pointer;
  pointer-events: auto;
}
:where([data-jams-dialogue-choices]) button[data-selected] {
  border-color: ${UI_THEME.accent};
  background: ${UI_THEME.choiceSelected};
}
:where([data-jams-dialogue-choices]) button:focus-visible {
  outline: 2px solid ${UI_THEME.accent};
  outline-offset: 1px;
}
:where([data-jams-dialogue-choices]) button:disabled { opacity: 0.45; cursor: default; }
:where([data-jams-sr-only]) {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`;

const LOG_CSS = `
:where([data-jams-text-log]) {
  position: absolute;
  top: ${uiInset("top")};
  right: ${uiInset("right")};
  width: min(360px, calc(100% - 32px));
  max-height: 50%;
  overflow-y: auto;
  box-sizing: border-box;
  margin: 0;
  padding: 8px 12px;
  border-radius: ${UI_THEME.radius};
  background: ${UI_THEME.bg};
  color: ${UI_THEME.fg};
  font-family: ${UI_FONT_FAMILY};
  font-size: 14px;
  line-height: 1.4;
}
:where([data-jams-text-log])[hidden] { display: none; }
:where([data-jams-text-log]) ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
:where([data-jams-text-log-speaker]) { font-weight: bold; color: ${UI_THEME.accent}; margin-inline-end: 0.4em; }
`;

/** A line's or choice's text: a string key through the table, else the literal `say`. */
function lineMarkup(
  item: Pick<DialogueLine, "text" | "say">,
  strings: StringTable,
  vars?: Readonly<Record<string, string>>,
): readonly RichLine[] {
  const source = item.text !== undefined ? strings.get(item.text, vars) : (item.say ?? "");
  return parseRichText(source, vars).lines;
}

/** A frame loop over the document's window, falling back to timers where it has no animation frames. */
function frameLoop(win: Window & typeof globalThis): {
  next(fn: () => void): void;
  cancel(): void;
  now(): number;
} {
  let handle: number | null = null;
  let viaFrame = false;
  return {
    next(fn) {
      if (handle !== null) return;
      const run = () => {
        handle = null;
        fn();
      };
      viaFrame = typeof win.requestAnimationFrame === "function";
      handle = viaFrame ? win.requestAnimationFrame(run) : win.setTimeout(run, 16);
    },
    cancel() {
      if (handle === null) return;
      if (viaFrame) win.cancelAnimationFrame(handle);
      else win.clearTimeout(handle);
      handle = null;
    },
    now: () => win.performance?.now() ?? Date.now(),
  };
}

/** The active line, speaker and choices; types out at speed and only ever sends @dialogue-advance and @dialogue-choose. */
export function createDialogueBox(ctx: UiContext, opts: DialogueBoxOptions = {}): UiHandle {
  const doc = ctx.root.ownerDocument;
  const win = doc.defaultView as Window & typeof globalThis;
  const speed = opts.speed !== undefined && opts.speed > 0 ? opts.speed : DEFAULT_SPEED;
  const actions = {
    advance: opts.actions?.advance ?? "confirm",
    up: opts.actions?.up ?? "up",
    down: opts.actions?.down ?? "down",
  };
  const showPortraits = opts.portraits ?? true;

  const box = doc.createElement("div");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "false");
  box.dataset.jamsDialogue = "";
  if (opts.className) box.className = opts.className;
  box.style.pointerEvents = "auto";
  box.hidden = true;

  const portrait = doc.createElement("div");
  portrait.dataset.jamsDialoguePortrait = "";
  portrait.setAttribute("aria-hidden", "true");
  const art = doc.createElement("div");
  art.dataset.jamsDialoguePortraitArt = "";
  portrait.append(art);
  const body = doc.createElement("div");
  body.dataset.jamsDialogueBody = "";
  const speaker = doc.createElement("div");
  speaker.dataset.jamsDialogueSpeaker = "";
  // The typed line is for the eye; the live region announces the whole line once.
  const line = doc.createElement("div");
  line.dataset.jamsDialogueLine = "";
  line.setAttribute("aria-hidden", "true");
  const live = doc.createElement("div");
  live.dataset.jamsSrOnly = "";
  live.dataset.jamsDialogueLive = "";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  const hint = doc.createElement("div");
  hint.dataset.jamsDialogueHint = "";
  hint.setAttribute("aria-hidden", "true");
  hint.textContent = "▼";
  const choicesEl = doc.createElement("div");
  choicesEl.dataset.jamsDialogueChoices = "";
  choicesEl.setAttribute("role", "group");
  body.append(speaker, line, live, choicesEl, hint);
  box.append(styleElement(doc, BOX_CSS), portrait, body);
  ctx.root.append(box);

  const frames = frameLoop(win);
  let view: Readonly<DialogueView> | null = null;
  let lineKey = "";
  let rich: readonly RichLine[] = [];
  let total = 0;
  let shown = 0;
  let typingSince: number | null = null;
  /** The view a command was sent for; nothing more is sent until the next one arrives. */
  let sentFor: Readonly<DialogueView> | null = null;
  let buttons: HTMLButtonElement[] = [];
  let selected = -1;
  let returnFocus: HTMLElement | null = null;

  const active = () => view !== null && view.ended === null;
  const choicesShown = () => active() && typingSince === null && buttons.length > 0;

  const send = (command: GameCommand) => {
    if (!view || sentFor === view) return;
    sentFor = view;
    if (!ctx.game.send(command)) sentFor = null;
  };

  const focusInBox = () => box.contains(doc.activeElement);

  /** Whether the game binds nothing to `action`, so the box's own keys stand in for it. */
  const unbound = (action: string) => (ctx.game.input.bindings()[action]?.length ?? 0) === 0;
  /** Whether the key `code` drives one of the game's actions, which the box then leaves it to. */
  const keyBound = (code: string) =>
    code !== "" &&
    Object.values(ctx.game.input.bindings()).some((list) =>
      list.some((b) => b.device === "key" && b.code === code),
    );
  /** Focus the box's own keys answer to: on the page, the canvas or what holds it, never a field or another control. */
  const pageHolds = (target: EventTarget | null) =>
    target instanceof win.Node &&
    !isEditableTarget(target) &&
    (target.contains(ctx.canvas) || box.contains(target));

  /** Hands focus back to where it was before the choices took it, else the canvas. */
  const releaseFocus = () => {
    const back = returnFocus?.isConnected ? returnFocus : ctx.canvas;
    returnFocus = null;
    back.focus({ preventScroll: true });
    const still = doc.activeElement as HTMLElement | null;
    if (still && box.contains(still)) still.blur();
  };

  const markSelected = () => {
    buttons.forEach((b, i) => {
      if (i === selected) b.dataset.selected = "";
      else delete b.dataset.selected;
    });
  };

  /** Scrolls the box, never the page, so a focused choice is in view. */
  const reveal = (button: HTMLElement) => {
    const at = button.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (at.top < view.top) box.scrollTop -= view.top - at.top;
    else if (at.bottom > view.bottom) box.scrollTop += at.bottom - view.bottom;
  };

  const focusChoice = (at: number) => {
    selected = at;
    markSelected();
    const button = buttons[at];
    if (!button) return;
    if (!focusInBox()) {
      const from = doc.activeElement;
      returnFocus = from instanceof win.HTMLElement && from !== doc.body ? from : null;
    }
    button.focus({ preventScroll: true });
    reveal(button);
  };

  const choose = (at: number, player?: number) => {
    const button = buttons[at];
    const index = Number(button?.dataset.jamsChoice);
    if (!button || button.disabled || !Number.isInteger(index)) return;
    send({
      name: DIALOGUE_CHOOSE_COMMAND,
      args: { choice: index },
      ...(player !== undefined && { player }),
    });
  };

  const drawLine = () =>
    renderRichTextPartly(line, rich, ctx, typingSince === null ? Infinity : shown);

  const drawChoices = () => {
    const strings = ctx.strings();
    const keep = buttons[selected]?.dataset.jamsChoice;
    buttons = [];
    selected = -1;
    const choices = active() && typingSince === null ? (view?.choices ?? []) : [];
    for (const choice of choices) {
      const button = doc.createElement("button");
      button.type = "button";
      button.dataset.jamsChoice = String(choice.index);
      button.disabled = !choice.enabled;
      renderRichText(button, lineMarkup(choice, strings), ctx);
      const at = buttons.length;
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        choose(at);
      });
      button.addEventListener("focus", () => {
        selected = at;
        markSelected();
      });
      buttons.push(button);
    }
    const kept = buttons.findIndex((b) => b.dataset.jamsChoice === keep && !b.disabled);
    selected = kept >= 0 ? kept : buttons.findIndex((b) => !b.disabled);
    markSelected();
    const hadFocus = focusInBox();
    const appeared = choicesEl.childElementCount === 0 && buttons.length > 0;
    choicesEl.replaceChildren(...buttons);
    choicesEl.hidden = buttons.length === 0;
    if (hadFocus) {
      const button = buttons[selected];
      if (button) {
        button.focus({ preventScroll: true });
        reveal(button);
      } else releaseFocus();
    } else if (
      appeared &&
      selected >= 0 &&
      (unbound(actions.up) || unbound(actions.down)) &&
      pageHolds(doc.activeElement ?? doc.body)
    ) {
      focusChoice(selected);
    }
    // Kept in its row while a line types, so the box doesn't change height as each line finishes.
    hint.hidden = !active() || view?.choices != null;
    hint.style.visibility = typingSince === null ? "" : "hidden";
  };

  const finishLine = () => {
    frames.cancel();
    if (typingSince === null) return;
    typingSince = null;
    shown = total;
    drawLine();
    drawChoices();
  };

  const type = () => {
    if (typingSince === null) return;
    const count = Math.floor(((frames.now() - typingSince) * speed) / 1000);
    if (count >= total) {
      finishLine();
      return;
    }
    if (count !== shown) {
      shown = count;
      drawLine();
    }
    frames.next(type);
  };

  // Captions read this to sit above the box rather than under it.
  const syncInset = () => {
    if (box.hidden) ctx.root.style.removeProperty(DIALOGUE_INSET);
    else ctx.root.style.setProperty(DIALOGUE_INSET, `${box.offsetHeight + 8}px`);
  };
  const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncInset);
  resized?.observe(box);

  const draw = (restart: boolean) => {
    if (!view || !active()) {
      frames.cancel();
      typingSince = null;
      lineKey = "";
      box.hidden = true;
      line.replaceChildren();
      live.textContent = "";
      drawChoices();
      syncInset();
      return;
    }
    const strings = ctx.strings();
    followLocale(box, ctx);
    const current = view.current;
    rich = lineMarkup(current, strings, current.vars);
    total = richTextLength(rich);

    const name = current.speakerName === undefined ? "" : strings.get(current.speakerName);
    speaker.textContent = name;
    speaker.hidden = name === "";
    if (name) box.setAttribute("aria-label", name);
    else box.removeAttribute("aria-label");
    const text = richPlainText(rich);
    live.textContent = name && text ? `${name}: ${text}` : text;

    const shows = showPortraits ? current.portrait : undefined;
    art.removeAttribute("style");
    portrait.hidden =
      !shows || !setAssetBackground(art, ctx, shows.asset, shows.frame, PORTRAIT_PX);

    if (restart) {
      frames.cancel();
      shown = 0;
      typingSince = ctx.reducedMotion || speed === Infinity || total === 0 ? null : frames.now();
    } else {
      shown = Math.min(shown, total);
    }
    box.hidden = false;
    drawLine();
    drawChoices();
    syncInset();
    if (typingSince !== null) frames.next(type);
  };

  const advance = (player?: number, fromPointer = false) => {
    if (!view || !active()) return;
    if (typingSince !== null) {
      finishLine();
      return;
    }
    if (choicesShown()) {
      if (!fromPointer && selected >= 0) choose(selected, player);
      return;
    }
    if (view.choices !== null) return;
    send({ name: DIALOGUE_ADVANCE_COMMAND, ...(player !== undefined && { player }) });
  };

  const move = (by: 1 | -1) => {
    if (!choicesShown()) return;
    const n = buttons.length;
    const from = selected >= 0 ? selected : by > 0 ? -1 : n;
    for (let step = 1; step <= n; step++) {
      const at = (((from + by * step) % n) + n) % n;
      if (!buttons[at]?.disabled) {
        focusChoice(at);
        return;
      }
    }
  };

  const unwatch = ctx.watch(
    (s) => s.dialogue,
    (next) => {
      view = next;
      sentFor = null;
      const key = next ? `${next.dialogue}\n${next.node}\n${next.line}\n${next.log.length}` : "";
      const restart = key !== lineKey;
      lineKey = key;
      draw(restart);
    },
  );
  const unlocale = onLocale(ctx, () => draw(false));

  const offAction = ctx.game.input.onAction(
    (e: UiActionEvent) => {
      if (!e.down) return;
      if (e.action === actions.advance) {
        if (!e.repeat) advance(e.player, e.device === "pointer" || e.device === "touch");
      } else if (e.action === actions.up) move(-1);
      else if (e.action === actions.down) move(1);
    },
    { actions: [actions.advance, actions.up, actions.down] },
  );

  // Focus inside the box keeps the keys from the game's input target, so the arrows move between choices here.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (!choicesShown() || !focusInBox()) return;
    e.preventDefault();
    e.stopPropagation();
    move(e.key === "ArrowUp" ? -1 : 1);
  };
  /**
   * Enter, Space and the arrows for the actions the game binds nothing to,
   * as in a project without game code; a key one of its actions uses stays its.
   */
  const onPageKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!active() || !pageHolds(e.target) || keyBound(e.code)) return;
    if (e.key === "Enter" || e.key === " ") {
      // A focused choice takes Enter and Space as its own click.
      if (!unbound(actions.advance) || e.target instanceof win.HTMLButtonElement) return;
      e.preventDefault();
      if (!e.repeat) advance();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const up = e.key === "ArrowUp";
      if (!unbound(up ? actions.up : actions.down) || !choicesShown()) return;
      e.preventDefault();
      move(up ? -1 : 1);
    }
  };
  const onClick = (e: MouseEvent) => {
    if (e.button === 0) advance(undefined, true);
  };
  box.addEventListener("keydown", onKey);
  box.addEventListener("click", onClick);
  doc.addEventListener("keydown", onPageKey);

  return {
    destroy() {
      frames.cancel();
      unwatch();
      unlocale();
      offAction();
      box.removeEventListener("keydown", onKey);
      box.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onPageKey);
      resized?.disconnect();
      if (focusInBox()) releaseFocus();
      box.remove();
      ctx.root.style.removeProperty(DIALOGUE_INSET);
    },
  };
}

function logEntry(
  doc: Document,
  entry: DialogueLogEntry,
  strings: StringTable,
  ctx: UiContext,
): HTMLLIElement {
  const item = doc.createElement("li");
  item.dataset.jamsTextLogEntry = `${entry.node}:${entry.line}`;
  if (entry.speaker !== undefined) {
    const who = doc.createElement("span");
    who.dataset.jamsTextLogSpeaker = "";
    who.textContent = strings.get(entry.speaker);
    item.append(who);
  }
  const text = doc.createElement("span");
  renderRichText(text, lineMarkup(entry, strings, entry.vars), ctx);
  item.append(text);
  return item;
}

/** The lines shown so far in the active conversation. */
export function createTextLog(ctx: UiContext, opts: TextLogOptions = {}): UiHandle {
  const doc = ctx.root.ownerDocument;
  const max = opts.max !== undefined && opts.max > 0 ? Math.floor(opts.max) : Infinity;

  const root = doc.createElement("section");
  root.dataset.jamsTextLog = "";
  root.style.pointerEvents = "auto";
  root.tabIndex = -1;
  const list = doc.createElement("ol");
  root.append(styleElement(doc, LOG_CSS), list);
  ctx.root.append(root);

  let open = opts.toggle === undefined;
  let entries: readonly DialogueLogEntry[] = [];

  const draw = () => {
    const strings = ctx.strings();
    followLocale(root, ctx);
    const shown = entries.length > max ? entries.slice(entries.length - max) : entries;
    const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 4;
    list.replaceChildren(...shown.map((entry) => logEntry(doc, entry, strings, ctx)));
    root.hidden = !open || shown.length === 0;
    if (atBottom) root.scrollTop = root.scrollHeight;
  };

  const unwatch = ctx.watch(
    (s) => s.dialogue?.log,
    (log) => {
      entries = log ?? [];
      draw();
    },
  );
  const unlocale = onLocale(ctx, draw);
  const toggle = opts.toggle;
  const offAction =
    toggle === undefined
      ? () => {}
      : ctx.game.input.onAction(
          (e) => {
            if (!e.down || e.repeat) return;
            open = !open;
            draw();
          },
          { actions: [toggle] },
        );

  return {
    destroy() {
      unwatch();
      unlocale();
      offAction();
      root.remove();
    },
  };
}
