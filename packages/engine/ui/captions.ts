import type { DialogueView } from "../dialogue/runner";
import type { JsonValue } from "../game/types";
import { PREF_KEYS, setPref, type PrefsStore } from "../prefs";
import { plainText } from "../text/rich";
import type { GameEventMap } from "../types";
import { followLocale, onLocale, styleElement, UI_FONT_FAMILY, UI_THEME, uiInset } from "./bind";
import { DIALOGUE_INSET } from "./dialogue";
import type { UiContext, UiHandle } from "./types";

/** How long a caption shows when `createCaptions` names no `ms`. */
export const CAPTION_MS_DEFAULT = 2500;
/** The most captions shown at once; a newer one pushes the oldest out. */
const CAPTIONS_SHOWN_MAX = 3;

/** `GameInstance.captions`: whether the player wants sounds and voiced lines captioned. */
export type GameCaptions = {
  enabled(): boolean;
  /** Saved in the prefs under "captions"; raises `captions:change` when it changes. */
  set(on: boolean): void;
};

export type CaptionsPreferenceOptions = {
  prefs: PrefsStore;
  /** The id the game's prefs are saved under, read at each access. */
  gameId: () => string;
  /** Called after `set` changes the choice. */
  changed: (enabled: boolean) => void;
  /** Whether the OS asks for captions, where the host can tell; no browser exposes that to a page today. */
  requested?: () => boolean;
};

/** How `createCaptions` tells the preference it is mounted, so an unset choice reads as on. */
const MOUNTED = Symbol("captions mounted");
type MountedCaptions = GameCaptions & { [MOUNTED]?: (delta: 1 | -1) => void };

/**
 * The player's captions choice over the prefs: what they saved, else on
 * where the OS asks or while a `createCaptions` is mounted, else off.
 */
export function captionsPreference(opts: CaptionsPreferenceOptions): GameCaptions {
  const saved = (): JsonValue | undefined => opts.prefs.load(opts.gameId())[PREF_KEYS.captions];
  let mounted = 0;
  const enabled = (): boolean => {
    const value = saved();
    return typeof value === "boolean" ? value : opts.requested?.() === true || mounted > 0;
  };
  const pref: MountedCaptions = {
    enabled,
    set(on) {
      const was = enabled();
      setPref(opts.prefs, opts.gameId(), PREF_KEYS.captions, on);
      if (was !== on) opts.changed(on);
    },
    [MOUNTED](delta) {
      const was = enabled();
      mounted += delta;
      const now = enabled();
      if (was !== now) opts.changed(now);
    },
  };
  return pref;
}

export type CaptionsOptions = {
  /** How long each caption shows, ms; default 2,500. */
  ms?: number;
};

type Shown = { key: string; el: HTMLElement; timer: ReturnType<typeof setTimeout> };

/** Zero-specificity defaults for the region and each caption, so a game's own class or stylesheet wins. */
const CAPTION_CSS = `
:where([data-jams-captions]) {
  position: absolute;
  left: ${uiInset("left")};
  right: ${uiInset("right")};
  bottom: ${uiInset("bottom", `var(${DIALOGUE_INSET}, 0px)`)};
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-family: ${UI_FONT_FAMILY};
  font-weight: 500;
  font-size: 15px;
  line-height: 1.35;
  text-align: center;
}
:where([data-jams-caption]) {
  max-width: 100%;
  padding: 2px 8px;
  border-radius: ${UI_THEME.radius};
  color: ${UI_THEME.fg};
  background: ${UI_THEME.bg};
  white-space: pre-line;
}
`;

/**
 * Each played sound's caption and each voiced line's text (`audio:caption`),
 * in a polite live region along the bottom of the layer. While it is
 * mounted, captions are on unless the player turned them off
 * (`GameInstance.captions`). A key already showing restarts its time rather
 * than showing twice. It takes no pointer input.
 */
export function createCaptions(ctx: UiContext, opts: CaptionsOptions = {}): UiHandle {
  const ms = opts.ms ?? CAPTION_MS_DEFAULT;
  const doc = ctx.root.ownerDocument;
  const region = doc.createElement("div");
  region.setAttribute("data-jams-captions", "");
  region.setAttribute("aria-live", "polite");
  region.style.pointerEvents = "none";
  followLocale(region, ctx);
  const sheet = styleElement(doc, CAPTION_CSS);
  ctx.root.append(sheet, region);

  let shown: Shown[] = [];

  // A voiced line's caption is its text key; its `{name}` values ride the dialogue view.
  let line: DialogueView["current"] | null = null;
  const unwatch = ctx.watch(
    (s) => s.dialogue?.current ?? null,
    (next) => {
      line = next;
    },
  );
  const textOf = (key: string) => {
    const vars = line?.text === key ? line.vars : undefined;
    return plainText(ctx.strings().get(key, vars), vars);
  };

  function remove(entry: Shown): void {
    clearTimeout(entry.timer);
    entry.el.remove();
    shown = shown.filter((s) => s !== entry);
  }

  function clear(): void {
    for (const entry of shown) {
      clearTimeout(entry.timer);
      entry.el.remove();
    }
    shown = [];
  }

  function show({ key }: GameEventMap["audio:caption"]): void {
    if (!ctx.game.captions.enabled()) return;
    const again = shown.find((s) => s.key === key);
    if (again) {
      clearTimeout(again.timer);
      again.timer = setTimeout(() => remove(again), ms);
      return;
    }
    while (shown.length >= CAPTIONS_SHOWN_MAX) {
      const oldest = shown[0];
      if (!oldest) break;
      remove(oldest);
    }
    const el = doc.createElement("div");
    el.setAttribute("data-jams-caption", key);
    el.dir = ctx.strings().direction;
    el.textContent = textOf(key);
    region.append(el);
    const entry: Shown = { key, el, timer: setTimeout(() => remove(entry), ms) };
    shown.push(entry);
  }

  const onPreference = ({ enabled }: GameEventMap["captions:change"]) => {
    if (!enabled) clear();
  };
  const unlocale = onLocale(ctx, () => {
    followLocale(region, ctx);
    const direction = ctx.strings().direction;
    for (const entry of shown) {
      entry.el.dir = direction;
      entry.el.textContent = textOf(entry.key);
    }
  });

  ctx.game.on("audio:caption", show);
  ctx.game.on("captions:change", onPreference);
  const preference = ctx.game.captions as MountedCaptions;
  preference[MOUNTED]?.(1);

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ctx.game.off("audio:caption", show);
      ctx.game.off("captions:change", onPreference);
      preference[MOUNTED]?.(-1);
      unlocale();
      unwatch();
      clear();
      region.remove();
      sheet.remove();
    },
  };
}
