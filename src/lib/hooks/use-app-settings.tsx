import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

/** The stored motion preference. `system` defers to the OS-level
 * `prefers-reduced-motion`; `reduced`/`full` are explicit overrides. */
export type MotionPref = "system" | "reduced" | "full";

interface AppSettingsValue {
  /** The stored tri-state preference — what the settings UIs edit. */
  motionPref: MotionPref;
  setMotionPref: (next: MotionPref) => void;
  /** The effective value — the stored pref coalesced with the native
   * `prefers-reduced-motion` query. When true, components should opt out
   * of decorative motion (skip shared-layout transitions, drop
   * framer-motion animations, pause background canvases, etc). */
  reduceMotion: boolean;
  /** App-wide mute toggle for any future audio cues — exposed
   * here so settings can flip it without coupling to a specific
   * audio system yet. */
  muted: boolean;
  setMuted: (next: boolean) => void;
}

const Ctx = createContext<AppSettingsValue | null>(null);

const REDUCE_MOTION_KEY = "brackeys-reduce-motion";
const MUTED_KEY = "brackeys-muted";
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

  const setMotionPref = useCallback((next: MotionPref) => {
    setMotionPrefState(next);
    writeString(REDUCE_MOTION_KEY, next);
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeString(MUTED_KEY, next ? "1" : "0");
  }, []);

  return (
    <Ctx.Provider value={{ motionPref, setMotionPref, reduceMotion, muted, setMuted }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppSettings(): AppSettingsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppSettings must be used within AppSettingsProvider");
  return ctx;
}

/** The effective reduced-motion boolean — stored pref coalesced with the
 * native query. Ours, not framer's: framer's hook of the same name only
 * knows the OS setting. */
export function useReducedMotion(): boolean {
  return useAppSettings().reduceMotion;
}
