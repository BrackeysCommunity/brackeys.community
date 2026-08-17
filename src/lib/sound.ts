import { bind, play, setEnabled, setVolume, sounds, type SoundName } from "cuelume";

/**
 * The app's interaction-sound layer. Nothing outside this module imports
 * `cuelume` directly: the palette lives here, volume tuning happens here, and
 * so does the one cue cuelume has no attribute for — a hush when the pointer
 * pulls away from a button.
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
const PULL_AWAY_SOUND: SoundName = "whisper";
/** The pull-away sits under the press cue so an abandoned press ends on a
 * hush rather than a second equal beep. */
const PULL_AWAY_VOLUME = 0.45;
/** Same figure cuelume throttles its own hover cue by. */
const PULL_AWAY_GAP_MS = 150;

/**
 * Cue bundles for the shared primitives. Spread these _before_ `{...props}`
 * so a call site can override a cue or drop it entirely. Empty values mean
 * "the default sound for this interaction"; a sound name overrides it.
 *
 * The bundles that replace a button's click cue carry explicit `undefined`s
 * for `press`/`release`. That is what lets them win when they land on
 * something that is *already* a `Button` — a dropdown trigger rendered as
 * one — since the Button spreads its own cues before `{...props}`. On a bare
 * element the `undefined`s simply render nothing.
 */
export const BUTTON_CUES = {
  "data-cuelume-hover": HOVER_SOUND,
  "data-cuelume-press": "",
  "data-cuelume-release": "",
  "data-sound-pull-away": "",
} as const;

/** Danger actions: one grave tone on click instead of the press/release
 * pair, and a heavier pull-away, so a destructive control never sounds
 * like an ordinary one. */
export const DESTRUCTIVE_BUTTON_CUES = {
  "data-cuelume-hover": HOVER_SOUND,
  "data-cuelume-press": undefined,
  "data-cuelume-release": undefined,
  "data-cuelume-toggle": "error",
  "data-sound-pull-away": "droplet",
} as const;

/** Anything that opens or advances a surface rather than committing an
 * action: dropdown triggers, submenu triggers, stepper and tab strips. */
export const PAGE_CUES = {
  "data-cuelume-hover": HOVER_SOUND,
  "data-cuelume-press": undefined,
  "data-cuelume-release": undefined,
  "data-cuelume-toggle": "page",
  "data-sound-pull-away": "",
} as const;

export const HOVER_CUE = {
  "data-cuelume-hover": HOVER_SOUND,
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
 * attribute: document-level listeners, fine mouse pointers only, globally
 * throttled. `pointerout` rather than `pointerleave` because `pointerleave`
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
        event.target instanceof Element ? event.target.closest("[data-sound-pull-away]") : null;
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
      const element = event.target.closest("[data-sound-pull-away]");
      if (element !== pressedElement) return;

      const related = event.relatedTarget;
      if (related instanceof Node && element.contains(related)) return;
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

      const now = performance.now();
      if (now - lastPullAwayAt < PULL_AWAY_GAP_MS) return;
      lastPullAwayAt = now;

      const requested = element.getAttribute("data-sound-pull-away");
      play(isSoundName(requested) ? requested : PULL_AWAY_SOUND, { volume: PULL_AWAY_VOLUME });
    },
    true,
  );
}

/** Wires document-level delegation and sets the base volume. Idempotent:
 * both binds no-op on a second call, so React strict-mode remounts are fine. */
export function initSound() {
  bind();
  bindPullAway();
  setVolume(BASE_VOLUME);
}

/** Mirrors the app's `muted` preference. cuelume never touches storage —
 * persistence stays with `AppSettingsProvider`. */
export function setSoundEnabled(enabled: boolean) {
  setEnabled(enabled);
}
