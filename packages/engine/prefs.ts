/**
 * Player preferences (bus volumes, the locale, captions, calibrated
 * latency), kept in the player's browser or by the host and never sent
 * anywhere.
 */
import { browserGameStore, memoryGameStore, snapshotGameStore, type GameStore } from "./game-store";
import type { JsonValue } from "./game/types";
import { isPlainObject } from "./project/kinds/define";

type Prefs = Readonly<Record<string, JsonValue>>;

/** Where a player's preferences persist between sessions, by game. */
export interface PrefsStore {
  load(gameId: string): Readonly<Record<string, JsonValue>>;
  save(gameId: string, prefs: Readonly<Record<string, JsonValue>>): void;
}

/** The keys the engine keeps its preferences under; each bus under its own prefix, so no bus name meets another key. */
export const PREF_KEYS = {
  locale: "locale",
  captions: "captions",
  latencyMs: "audio.latencyMs",
  busKey: (bus: string): string => `audio.bus.${bus}`,
} as const;

/** Sets one preference, keeping the rest. */
export function setPref(store: PrefsStore, gameId: string, key: string, value: JsonValue): void {
  store.save(gameId, { ...store.load(gameId), [key]: value });
}

const isPrefs = (value: unknown): value is Prefs => isPlainObject(value);

const prefsStore = (store: GameStore<Prefs>): PrefsStore => ({
  load: (gameId) => store.load(gameId) ?? {},
  save: (gameId, prefs) => store.save(gameId, prefs),
});

/** Preferences kept for this page's life: tests, and hosts that don't persist them. */
export function memoryPrefsStore(): PrefsStore {
  return prefsStore(memoryGameStore());
}

/**
 * Preferences in `localStorage` under `<prefix><gameId>`. Every access is in
 * try/catch: storage that is missing, blocked or full, or a stored value
 * that isn't a JSON object, loads as none and never throws.
 */
export function browserPrefsStore(prefix = "jams-engine:prefs:"): PrefsStore {
  return prefsStore(browserGameStore(prefix, isPrefs));
}

/**
 * Preferences a host keeps for the game: `load` reads the snapshot it
 * handed over at start (none when it isn't a JSON object), then the latest
 * change; `save` hands the latest back through `save` once no change has
 * come for 500 ms, so a run of changes posts once.
 */
export function snapshotPrefsStore(
  initial: unknown,
  save: (gameId: string, prefs: Readonly<Record<string, JsonValue>>) => void,
): PrefsStore {
  return prefsStore(snapshotGameStore(initial, isPrefs, save));
}
