import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface AppSettingsValue {
  /** When true, components should opt out of decorative motion (skip
   * shared-layout transitions, drop framer-motion animations, etc).
   * Independent of the OS-level `prefers-reduced-motion` so the user
   * can override per-app. */
  reduceMotion: boolean;
  setReduceMotion: (next: boolean) => void;
  /** App-wide mute toggle for any future audio cues — exposed
   * here so settings can flip it without coupling to a specific
   * audio system yet. */
  muted: boolean;
  setMuted: (next: boolean) => void;
}

const Ctx = createContext<AppSettingsValue | null>(null);

const REDUCE_MOTION_KEY = "brackeys-reduce-motion";
const MUTED_KEY = "brackeys-muted";

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

function writeBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // storage full or unavailable
  }
}

/** App-wide settings provider for non-theme prefs (motion + mute).
 * Theme is its own context (`AppThemeProvider`); the settings modal
 * pulls from both. */
export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [muted, setMutedState] = useState(false);

  // Hydrate from storage on mount.
  useEffect(() => {
    setReduceMotionState(readBool(REDUCE_MOTION_KEY));
    setMutedState(readBool(MUTED_KEY));
  }, []);

  // Apply `data-reduce-motion` to the document so CSS rules can
  // disable transitions globally (e.g. `[data-reduce-motion="true"]
  // *:not(...) { transition: none !important }`).
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false";
  }, [reduceMotion]);

  const setReduceMotion = useCallback((next: boolean) => {
    setReduceMotionState(next);
    writeBool(REDUCE_MOTION_KEY, next);
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeBool(MUTED_KEY, next);
  }, []);

  return (
    <Ctx.Provider value={{ reduceMotion, setReduceMotion, muted, setMuted }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppSettings(): AppSettingsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return ctx;
}
