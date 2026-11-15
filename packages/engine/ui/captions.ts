import type { DialogueView } from "../dialogue/runner";
import type { JsonValue } from "../game/types";
import { PREF_KEYS, setPref, type PrefsStore } from "../prefs";
import { plainText } from "../text/rich";
import type { GameEventMap } from "../types";
import { followLocale, onLocale, UI_FONT_FAMILY, uiInset } from "./bind";
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
  /**
   * Whether the OS asks for captions, where the host can tell; no browser
   * exposes that to a page today, so without it the default is off.
   */
  requested?: () => boolean;
};

/** The player's captions choice over the prefs: what they saved, else the OS's request, else off. */
export function captionsPreference(opts: CaptionsPreferenceOptions): GameCaptions {
  const saved = (): JsonValue | undefined => opts.prefs.load(opts.gameId())[PREF_KEYS.captions];
  const enabled = (): boolean => {
    const value = saved();
    return typeof value === "boolean" ? value : (opts.requested?.() ?? false);
  };
  return {
    enabled,
    set(on) {
      const was = enabled();
      setPref(opts.prefs, opts.gameId(), PREF_KEYS.captions, on);
      if (was !== on) opts.changed(on);
    },
  };
}

export type CaptionsOptions = {
  /** How long each caption shows, ms; default 2,500. */
  ms?: number;
};

type Shown = { key: string; el: HTMLElement; timer: ReturnType<typeof setTimeout> };

/**
 * Each played sound's caption and each voiced line's text (`audio:caption`),
 * in a polite live region along the bottom of the layer, while the player's
 * captions preference is on. A key already showing restarts its time rather
 * than showing twice. It takes no pointer input.
 */
export function createCaptions(ctx: UiContext, opts: CaptionsOptions = {}): UiHandle {
  const ms = opts.ms ?? CAPTION_MS_DEFAULT;
  const doc = ctx.root.ownerDocument;
  const region = doc.createElement("div");
  region.setAttribute("data-jams-captions", "");
  region.setAttribute("aria-live", "polite");
  Object.assign(region.style, {
    position: "absolute",
    left: uiInset("left"),
    right: uiInset("right"),
    bottom: uiInset("bottom", `var(${DIALOGUE_INSET}, 0px)`),
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
    pointerEvents: "none",
    fontFamily: UI_FONT_FAMILY,
    fontWeight: "500",
    fontSize: "15px",
    lineHeight: "1.35",
    textAlign: "center",
  });
  followLocale(region, ctx);
  ctx.root.append(region);

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
    Object.assign(el.style, {
      maxWidth: "100%",
      padding: "2px 8px",
      borderRadius: "4px",
      color: "var(--jams-dialogue-fg, #ffffff)",
      background: "var(--jams-dialogue-bg, rgb(0 0 0 / 0.72))",
      whiteSpace: "pre-line",
    });
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

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ctx.game.off("audio:caption", show);
      ctx.game.off("captions:change", onPreference);
      unlocale();
      unwatch();
      clear();
      region.remove();
    },
  };
}
