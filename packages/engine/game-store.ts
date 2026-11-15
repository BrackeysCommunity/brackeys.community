/**
 * One JSON value per game, kept on the player's side and never sent
 * anywhere: for this page's life, in `localStorage`, or by a host. The
 * remap and preference stores are built from these.
 */

/** Where one value per game persists between sessions. */
export interface GameStore<T> {
  load(gameId: string): T | null;
  save(gameId: string, value: T): void;
}

/** Values kept for this page's life: tests, and hosts that don't persist them. */
export function memoryGameStore<T>(): GameStore<T> {
  const saved = new Map<string, T>();
  return {
    load: (gameId) => {
      const value = saved.get(gameId);
      return value === undefined ? null : structuredClone(value);
    },
    save: (gameId, value) => void saved.set(gameId, structuredClone(value)),
  };
}

/**
 * Values in `localStorage` under `${prefix}${gameId}`. Every access is in
 * try/catch: storage that is missing, blocked or full, or a stored value
 * that isn't valid JSON of the right shape, loads as none and never throws.
 */
export function browserGameStore<T>(
  prefix: string,
  valid: (value: unknown) => value is T,
): GameStore<T> {
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
        if (raw == null) return null;
        const value: unknown = JSON.parse(raw);
        return valid(value) ? value : null;
      } catch {
        return null;
      }
    },
    save: (gameId, value) => {
      try {
        storage()?.setItem(`${prefix}${gameId}`, JSON.stringify(value));
      } catch {
        // A value that can't persist still applies for this session.
      }
    },
  };
}

/** How long a snapshot store waits after the last change before handing the value back. */
export const SNAPSHOT_SAVE_DELAY_MS = 500;

/**
 * Values a host keeps for the game: `load` reads the snapshot it handed
 * over at start (none when `valid` refuses it), then the latest change;
 * `save` hands the latest back through `save` once no change has come for
 * `SNAPSHOT_SAVE_DELAY_MS`, so a run of changes posts once.
 */
export function snapshotGameStore<T>(
  initial: unknown,
  valid: (value: unknown) => value is T,
  save: (gameId: string, value: T) => void,
): GameStore<T> {
  let snapshot: T | null = valid(initial) ? structuredClone(initial) : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    load: () => (snapshot === null ? null : structuredClone(snapshot)),
    save: (gameId, value) => {
      const held = structuredClone(value);
      snapshot = held;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        save(gameId, structuredClone(held));
      }, SNAPSHOT_SAVE_DELAY_MS);
    },
  };
}
