import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { initSound, setSoundEnabled, setSoundVolume } from "@/lib/sound";

/** The stored motion preference. `system` defers to the OS-level
 * `prefers-reduced-motion`; `reduced`/`full` are explicit overrides. */
export type MotionPref = "system" | "reduced" | "full";

/** Copy for the tri-state, shared by the settings pane that edits it and
 * the header readout that only reports it. */
export const MOTION_OPTIONS: { value: MotionPref; label: string; description: string }[] = [
  { value: "system", label: "System", description: "Follow the OS setting" },
  { value: "full", label: "On", description: "Always animate" },
  { value: "reduced", label: "Off", description: "Skip decorative motion" },
];

export const MOTION_LABEL: Record<MotionPref, string> = {
  system: "System",
  full: "On",
  reduced: "Off",
};

interface AppSettingsValue {
  /** The stored tri-state preference — what the settings UIs edit. */
  motionPref: MotionPref;
  setMotionPref: (next: MotionPref) => void;
  /** The effective value — the stored pref coalesced with the native
   * `prefers-reduced-motion` query. When true, components should opt out
   * of decorative motion (skip shared-layout transitions, drop
   * framer-motion animations, pause background canvases, etc). */
  reduceMotion: boolean;
  /** App-wide mute toggle for the interaction cues in `@/lib/sound`.
   * Persisted here; the sound layer itself stores nothing. */
  muted: boolean;
  setMuted: (next: boolean) => void;
  /** Cue loudness, 0–1, where 1 is the app's tuned level rather than
   * cuelume's raw output. Independent of `muted`: turning sound back on
   * restores the volume it was at. */
  volume: number;
  setVolume: (next: number) => void;
  /** Whether prose is rendered with profanity asterisked out. Ships on:
   * the person who never opens settings is the one to protect, and the
   * person who wants it raw is the one who will go looking. Read through
   * `useCensored` rather than directly — the hook also holds the render
   * back until hydration, since the server can't know this. */
  censorProfanity: boolean;
  setCensorProfanity: (next: boolean) => void;
}

const Ctx = createContext<AppSettingsValue | null>(null);

const REDUCE_MOTION_KEY = "brackeys-reduce-motion";
const MUTED_KEY = "brackeys-muted";
const VOLUME_KEY = "brackeys-volume";
const CENSOR_KEY = "brackeys-censor-profanity";
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** Read the stored motion preference. Legacy boolean values migrate at
 * read time: `"1"` (explicit opt-out) becomes `"reduced"`; `"0"`,
 * missing, or garbage become `"system"` — the old default state is
 * indistinguishable from never-touched. SSR-safe. */
function readMotionPref(): MotionPref {
  if (typeof window === "undefined") return "system";
  try {
    const raw = localStorage.getItem(REDUCE_MOTION_KEY);
    if (raw === "1" || raw === "reduced") return "reduced";
    if (raw === "full") return "full";
    return "system";
  } catch {
    return "system";
  }
}

/** Read a boolean preference from `localStorage`, defaulting to
 * `false` when missing or unparseable. SSR-safe. */
function readBool(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Read a boolean preference that defaults to `true`. Only an explicit
 * `"0"` turns it off, so a missing key reads as on. SSR-safe. */
function readBoolOn(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

/** Read the stored 0–1 volume, defaulting to full when missing or
 * unparseable. SSR-safe. */
function readVolume(): number {
  if (typeof window === "undefined") return 1;
  try {
    // `Number(null)` is 0, so a missing key has to be ruled out before
    // parsing — otherwise a first-time visitor lands on silent.
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
  } catch {
    return 1;
  }
}

function writeString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage full or unavailable
  }
}

function subscribeNativeReduce(onChange: () => void): () => void {
  const mql = window.matchMedia?.(REDUCE_QUERY);
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getNativeReduceSnapshot(): boolean {
  return window.matchMedia?.(REDUCE_QUERY).matches ?? false;
}

/** App-wide settings provider for non-theme prefs (motion + mute).
 * Theme is its own context (`AppThemeProvider`); the settings modal
 * pulls from both. */
export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  // Synchronous initializers rather than hydrate-on-mount: the pre-paint
  // script in `__root.tsx` already stamped the DOM attribute, and a
  // motion-on first render would flash animations at reduced-motion users.
  const [motionPref, setMotionPrefState] = useState<MotionPref>(readMotionPref);
  const [muted, setMutedState] = useState(() => readBool(MUTED_KEY));
  const [volume, setVolumeState] = useState(readVolume);
  const [censorProfanity, setCensorProfanityState] = useState(() => readBoolOn(CENSOR_KEY));

  const nativeReduced = useSyncExternalStore(
    subscribeNativeReduce,
    getNativeReduceSnapshot,
    () => false,
  );

  const reduceMotion = motionPref === "reduced" || (motionPref === "system" && nativeReduced);

  // Mirror the effective value to the document so CSS rules can disable
  // decorative animation globally (view transitions, scanlines, …). The
  // inline script stamps the same attribute pre-paint; this keeps it live.
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false";
  }, [reduceMotion]);

  // Interaction sounds: one document-wide delegation, then the stored mute
  // and volume mirrored onto it. Both initialize synchronously from storage,
  // so a persisted preference lands before anything is clickable.
  useEffect(() => {
    initSound();
  }, []);

  useEffect(() => {
    setSoundEnabled(!muted);
  }, [muted]);

  useEffect(() => {
    setSoundVolume(volume);
  }, [volume]);

  const setMotionPref = useCallback((next: MotionPref) => {
    setMotionPrefState(next);
    writeString(REDUCE_MOTION_KEY, next);
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeString(MUTED_KEY, next ? "1" : "0");
  }, []);

  const setCensorProfanity = useCallback((next: boolean) => {
    setCensorProfanityState(next);
    writeString(CENSOR_KEY, next ? "1" : "0");
  }, []);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.min(Math.max(next, 0), 1);
    setVolumeState(clamped);
    // Also applied here, not just in the effect above: the settings slider
    // plays a cue to preview the level it just set, and that call happens in
    // the same handler — before any effect has run.
    setSoundVolume(clamped);
    writeString(VOLUME_KEY, String(clamped));
  }, []);

  return (
    <Ctx.Provider
      value={{
        motionPref,
        setMotionPref,
        reduceMotion,
        muted,
        setMuted,
        volume,
        setVolume,
        censorProfanity,
        setCensorProfanity,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppSettings(): AppSettingsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return ctx;
}

/** The same value, or null outside the provider. For the one consumer that
 * must not crash a subtree over a cosmetic preference — see `useCensored`. */
export function useOptionalAppSettings(): AppSettingsValue | null {
  return useContext(Ctx);
}

/** The effective reduced-motion boolean — stored pref coalesced with the
 * native query. Ours, not framer's: framer's hook of the same name only
 * knows the OS setting. */
export function useReducedMotion(): boolean {
  return useAppSettings().reduceMotion;
}
