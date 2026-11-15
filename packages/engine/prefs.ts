/**
 * Player preferences (bus volumes, the locale, calibrated latency), kept
 * in the player's browser or by the host and never sent anywhere: the
 * remap store's three shapes.
 */
import type { JsonValue } from "./game/types";

/** Where a player's preferences persist between sessions, by game. */
export interface PrefsStore {
  load(gameId: string): Readonly<Record<string, JsonValue>>;
  save(gameId: string, prefs: Readonly<Record<string, JsonValue>>): void;
}

/** Preferences kept for this page's life: tests, and hosts that don't persist them. */
export function memoryPrefsStore(): PrefsStore {
  const saved = new Map<string, Readonly<Record<string, JsonValue>>>();
  return {
    load: (gameId) => structuredClone(saved.get(gameId) ?? {}),
    save: (gameId, prefs) => void saved.set(gameId, structuredClone(prefs)),
  };
}

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Preferences in `localStorage` under `<prefix><gameId>`. Every access is in
 * try/catch: storage that is missing, blocked or full, or a stored value
 * that isn't a JSON object, loads as none and never throws.
 */
export function browserPrefsStore(prefix = "jams-engine:prefs:"): PrefsStore {
  const storage = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    load: (gameId) => {
      try {
        const raw = storage()?.getItem(`${prefix}${gameId}`);
        if (raw == null) return {};
        const prefs: unknown = JSON.parse(raw);
        return isRecord(prefs) ? prefs : {};
      } catch {
        return {};
      }
    },
    save: (gameId, prefs) => {
      try {
        storage()?.setItem(`${prefix}${gameId}`, JSON.stringify(prefs));
      } catch {
        // A preference that can't persist still applies for this session.
      }
    },
  };
}

/** How long a snapshot store waits after the last change before handing preferences back. */
const SNAPSHOT_PREFS_SAVE_DELAY_MS = 500;

/**
 * Preferences a host keeps for the game: `load` reads the snapshot it
 * handed over at start (none when it isn't a JSON object), then the latest
 * change; `save` hands the latest back through `save` once no change has
 * come for `SNAPSHOT_PREFS_SAVE_DELAY_MS`, so a run of changes posts once.
 */
export function snapshotPrefsStore(
  initial: unknown,
  save: (gameId: string, prefs: Readonly<Record<string, JsonValue>>) => void,
): PrefsStore {
  let snapshot: Readonly<Record<string, JsonValue>> = isRecord(initial)
    ? structuredClone(initial)
    : {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    load: () => structuredClone(snapshot),
    save: (gameId, prefs) => {
      const held = structuredClone(prefs);
      snapshot = held;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        save(gameId, structuredClone(held));
      }, SNAPSHOT_PREFS_SAVE_DELAY_MS);
    },
  };
}
