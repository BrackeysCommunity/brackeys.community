import { bind, play, setEnabled, setVolume, sounds, type SoundName } from "cuelume";

/**
 * The app's interaction-sound layer. Nothing outside this module imports
 * `cuelume` directly: the palette lives here, volume tuning happens here, and
 * so do the two cues we bind ourselves — the hover tick, and a hush when the
 * pointer pulls away from a button.
 *
 * Playback is a no-op until `setSoundEnabled(true)`-equivalent state is right:
 * `AppSettingsProvider` owns that, mirroring the stored `muted` preference.
 */

export { play };
export type { SoundName };

/** Global multiplier under the mute toggle. cuelume's output stage is
 * deliberately boosted, so half reads as "present", not "quiet". */
export const BASE_VOLUME = 0.5;

const HOVER_SOUND: SoundName = "tick";
const HOVER_ATTR = "data-sound-hover";
const PULL_AWAY_SOUND: SoundName = "whisper";
const PULL_AWAY_ATTR = "data-sound-pull-away";
/** The pull-away sits under the press cue so an abandoned press ends on a
 * hush rather than a second equal beep. */
const PULL_AWAY_VOLUME = 0.45;
/** The minimum gap between two cues of the same kind. cuelume uses the same
 * figure for its own hover cue. */
const CUE_GAP_MS = 150;
/** How long after a scroll a stationary pointer still counts as having
 * arrived somewhere. Scroll events fire continuously while one is in
 * progress, so the boundary events land well inside this. */
const SCROLL_GRACE_MS = 100;

/**
 * Per-play volumes for the imperative cues, all relative to the global
 * `setVolume`. These sound on their own rather than answering a click, so
 * they sit under the click palette.
 */
const AMBIENT_VOLUME = {
  /** Overlay dismissal, accordion collapse. */
  dismiss: 0.5,
  /** Accordion / collapsible expand. */
  reveal: 0.55,
  /** Incoming notification — meant to be noticed across the room. */
  notification: 0.7,
  /** A slow user-initiated job starting. */
  progress: 0.5,
  /** A toast arriving. */
  toast: 0.6,
} as const;

/**
 * Cue bundles for the shared primitives. Spread these _before_ `{...props}`
 * so a call site can override a cue or drop it entirely. Empty values mean
 * "the default sound for this interaction"; a sound name overrides it.
 *
 * `data-cuelume-*` is the library's namespace; `data-sound-*` is ours, for
 * the two cues `bindHover` and `bindPullAway` handle below.
 *
 * The bundles that replace a button's click cue carry explicit `undefined`s
 * for `press`/`release`. That is what lets them win when they land on
 * something that is *already* a `Button` — a dropdown trigger rendered as
 * one — since the Button spreads its own cues before `{...props}`. On a bare
 * element the `undefined`s simply render nothing.
 */
export const BUTTON_CUES = {
  "data-sound-hover": HOVER_SOUND,
  "data-cuelume-press": "",
  "data-cuelume-release": "",
  "data-sound-pull-away": "",
} as const;

/** Danger actions: one grave tone on click instead of the press/release
 * pair, and a heavier pull-away, so a destructive control never sounds
 * like an ordinary one. */
export const DESTRUCTIVE_BUTTON_CUES = {
  "data-sound-hover": HOVER_SOUND,
  "data-cuelume-press": undefined,
  "data-cuelume-release": undefined,
  "data-cuelume-toggle": "error",
  "data-sound-pull-away": "droplet",
} as const;

/** Anything that opens or advances a surface rather than committing an
 * action: dropdown triggers, submenu triggers, stepper and tab strips. */
export const PAGE_CUES = {
  "data-sound-hover": HOVER_SOUND,
  "data-cuelume-press": undefined,
  "data-cuelume-release": undefined,
  "data-cuelume-toggle": "page",
  "data-sound-pull-away": "",
} as const;

/** Close controls inside an overlay. Silent on click on purpose: the
 * dismissal already sounds from the overlay root's open-change, and a close
 * X that fires press, release *and* droplet reads as a stumble. */
export const DISMISS_CUES = {
  "data-sound-hover": HOVER_SOUND,
  "data-cuelume-press": undefined,
  "data-cuelume-release": undefined,
  "data-sound-pull-away": "",
} as const;

export const HOVER_CUE = {
  "data-sound-hover": HOVER_SOUND,
} as const;

/** Nav links: a tick on hover, and on click the same `toggle` the settings
 * rows use. No press/release — that pair belongs to a control that acts in
 * place, not to a link already tearing the page down. */
export const NAV_LINK_CUES = {
  "data-sound-hover": HOVER_SOUND,
  "data-cuelume-toggle": "",
} as const;

export const TOGGLE_CUE = {
  "data-cuelume-toggle": "",
} as const;

/** A menu item that carries a danger action — the menu equivalent of
 * `DESTRUCTIVE_BUTTON_CUES`. */
export const DESTRUCTIVE_TOGGLE_CUE = {
  "data-cuelume-toggle": "error",
} as const;

function isSoundName(value: unknown): value is SoundName {
  return typeof value === "string" && (sounds as readonly string[]).includes(value);
}

/**
 * Base UI reports *why* a popup closed. Only a dismissal the user performed
 * sounds: a programmatic close is almost always the tail of an action that
 * already made its own noise — a saved form, a confirmed alert — and
 * droplet-on-top-of-success reads as a stutter. `focus-out` and
 * `sibling-open` are incidental and stay silent too.
 */
const DISMISSAL_REASONS: readonly string[] = [
  "close-press",
  "outside-press",
  "escape-key",
  "close-watcher",
  "trigger-press",
  "swipe",
];

/** Dismissing an overlay: dialog, sheet, alert dialog, drawer. Pass the Base
 * UI close reason where there is one; vaul and other libraries that don't
 * report one pass nothing and always sound. */
export function playDismiss(reason?: string) {
  if (reason !== undefined && !DISMISSAL_REASONS.includes(reason)) return;
  play("droplet", { volume: AMBIENT_VOLUME.dismiss });
}

/** Accordion and collapsible panels: `bloom` opening, `droplet` closing —
 * the same fall the overlays use, so "something went away" is one sound
 * across the app. */
export function playReveal(open: boolean) {
  if (open) play("bloom", { volume: AMBIENT_VOLUME.reveal });
  else play("droplet", { volume: AMBIENT_VOLUME.dismiss });
}

/** A notification arrived over the stream. */
export function playNotification() {
  play("chime", { volume: AMBIENT_VOLUME.notification });
}

/**
 * A slow user-initiated job starting — work the user actually waits on, like
 * an itch.io library import. Never a sub-second mutation, where this just
 * doubles the noise of the toast that lands a moment later.
 *
 * There is deliberately no matching `ready` cue: every slow flow we have
 * finishes with a toast, and the toast already sounds. A `ready` on top of
 * it is a stutter, not a pair. `ready` stays unassigned until something
 * finishes silently.
 */
export function playJobStart() {
  play("loading", { volume: AMBIENT_VOLUME.progress });
}

/**
 * A toast arriving, played by `@/lib/toast` — nothing else should call this.
 *
 * One cue for every outcome, not `success`/`error` per kind: a toast is a
 * thing appearing, and `bloom` is that shape. The toast's own words and icon
 * carry whether it went well.
 */
export function playToast() {
  play("bloom", { volume: AMBIENT_VOLUME.toast });
}

let hoverBound = false;
/** When each element last ticked. cuelume keys its own hover throttle off a
 * single module-level timestamp, which is what this replaces. */
const lastHoverAt = new WeakMap<Element, number>();
/** Where the pointer was last actually seen. NaN until the first event, so
 * the first hover of a session always sounds. */
let lastPointerX = Number.NaN;
let lastPointerY = Number.NaN;
let lastScrollAt = -Infinity;

/**
 * The hover cue, ours rather than cuelume's `data-cuelume-hover`. Same
 * delegated shape and the same gap, but measured per element: the library's
 * one shared timestamp means a pointer sweeping a toolbar or a card grid
 * ticks on the first control and drops every one it crosses inside the
 * window.
 *
 * A cue also requires the pointer to have *moved* since we last saw it —
 * unless the page just scrolled. The browser fires a real `pointerenter`
 * whenever the element under a stationary pointer is replaced, and the two
 * ways that happens want opposite answers: a scroll carrying a fresh control
 * under the cursor is a hover, while a re-render swapping out the control
 * already there is the page catching up with a click that has already
 * sounded. Position and a scroll stamp separate them; a grace period after
 * the click can't, because a route change takes however long it takes.
 *
 * `pointerenter` doesn't bubble, so the listener has to be capture-phase to
 * see it — and that in turn makes the `relatedTarget` containment check
 * load-bearing, since a button holding an icon and a label would otherwise
 * tick again each time the pointer crossed between them.
 */
export function bindHover() {
  if (typeof document === "undefined" || hoverBound) return;
  hoverBound = true;

  // Keeps the position current across the stretches where nothing is
  // hovered, so leaving a button and coming back to it still sounds.
  document.addEventListener(
    "pointermove",
    (event) => {
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
    },
    { capture: true, passive: true },
  );

  // Capture, because `scroll` doesn't bubble off a scroll container.
  document.addEventListener(
    "scroll",
    () => {
      lastScrollAt = performance.now();
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "pointerenter",
    (event) => {
      if (event.pointerType !== "mouse") return;
      if (!(event.target instanceof Element)) return;

      const element = event.target.closest(`[${HOVER_ATTR}]`);
      if (!element) return;

      const related = event.relatedTarget;
      if (related instanceof Node && element.contains(related)) return;
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

      const now = performance.now();
      const moved = event.clientX !== lastPointerX || event.clientY !== lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      if (!moved && now - lastScrollAt > SCROLL_GRACE_MS) return;

      if (now - (lastHoverAt.get(element) ?? -Infinity) < CUE_GAP_MS) return;
      lastHoverAt.set(element, now);

      const requested = element.getAttribute(HOVER_ATTR);
      play(isSoundName(requested) ? requested : HOVER_SOUND);
    },
    true,
  );
}

let pullAwayBound = false;
let lastPullAwayAt = -Infinity;
/** The element a mouse press started on, for as long as that press is held. */
let pressedElement: Element | null = null;
let pressedPointerId: number | null = null;

/**
 * The pull-away cue: the sound of an *abandoned press* — button held down,
 * pointer dragged off, so cuelume's `release` never fires and the press would
 * otherwise end in silence. Merely un-hovering is not enough; a plain
 * hover-out stays quiet.
 *
 * Written in cuelume's own delegated style, since it ships no leave-side
 * attribute: document-level listeners, fine mouse pointers only. Throttled
 * globally rather than per element — one abandoned press at a time is the
 * only thing that can happen anyway. `pointerout` rather than `pointerleave` because `pointerleave`
 * doesn't bubble and so can't be delegated — which makes the `relatedTarget`
 * containment check load-bearing: without it, a button holding an icon and a
 * label would fire every time the pointer crossed between them mid-press.
 *
 * Our own `data-sound-pull-away` namespace, not `data-cuelume-*`: this isn't
 * part of the library's contract.
 */
export function bindPullAway() {
  if (typeof document === "undefined" || pullAwayBound) return;
  pullAwayBound = true;

  const endPress = () => {
    pressedElement = null;
    pressedPointerId = null;
  };

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType !== "mouse") {
        endPress();
        return;
      }
      pressedElement =
        event.target instanceof Element ? event.target.closest(`[${PULL_AWAY_ATTR}]`) : null;
      pressedPointerId = event.pointerId;
    },
    true,
  );
  document.addEventListener("pointerup", endPress, true);
  document.addEventListener("pointercancel", endPress, true);

  document.addEventListener(
    "pointerout",
    (event) => {
      if (event.pointerType !== "mouse") return;
      // The whole point: no held press, no cue.
      if (!pressedElement || event.pointerId !== pressedPointerId) return;
      if (!(event.target instanceof Element)) return;

      // Leaving something other than the element being pressed — e.g. the
      // pointer was already off it and is now crossing other elements.
      const element = event.target.closest(`[${PULL_AWAY_ATTR}]`);
      if (element !== pressedElement) return;

      const related = event.relatedTarget;
      if (related instanceof Node && element.contains(related)) return;
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

      const now = performance.now();
      if (now - lastPullAwayAt < CUE_GAP_MS) return;
      lastPullAwayAt = now;

      const requested = element.getAttribute(PULL_AWAY_ATTR);
      play(isSoundName(requested) ? requested : PULL_AWAY_SOUND, { volume: PULL_AWAY_VOLUME });
    },
    true,
  );
}

/** Wires document-level delegation. Idempotent: every bind no-ops on a second
 * call, so React strict-mode remounts are fine. `bind()` still carries
 * press, release and toggle; hover is ours. Volume is not set here —
 * `AppSettingsProvider` owns it, and sets it from storage on the same
 * mount. */
export function initSound() {
  bind();
  bindHover();
  bindPullAway();
}

/** Mirrors the app's `muted` preference. cuelume never touches storage —
 * persistence stays with `AppSettingsProvider`. */
export function setSoundEnabled(enabled: boolean) {
  setEnabled(enabled);
}

/** The stored 0–1 volume preference, scaled by `BASE_VOLUME` so the slider's
 * top end is the app's tuned level rather than cuelume's raw output. */
export function setSoundVolume(volume: number) {
  setVolume(Math.min(Math.max(volume, 0), 1) * BASE_VOLUME);
}
