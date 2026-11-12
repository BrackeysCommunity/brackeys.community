import {
  MAX_BROWSER_SAVE_LIMITS,
  parseSaveFile,
  type SaveLimits,
  type SaveMeta,
} from "../game/save-file";
import { makeIssue } from "../scene/issues";
import { locatePointer } from "../scene/parse";
import type { SceneIssue } from "../scene/types";

/** Where a game's saves live: the game's own backend, the host's, the browser's, or memory. */
export interface SaveStore {
  readonly kind: "game" | "host" | "browser" | "memory";
  /** Plain words a game page and a save menu show: where saves live and how long they last. */
  readonly describe: string;
  /** A store may be stricter than the game's limits. */
  readonly limits?: Partial<SaveLimits>;
  list(gameId: string): Promise<readonly SaveSummary[]>;
  read(gameId: string, slot: string): Promise<string | null>;
  write(gameId: string, slot: string, text: string): Promise<SaveWriteResult>;
  remove(gameId: string, slot: string): Promise<void>;
}

export type SaveSummary = { slot: string; meta: SaveMeta; bytes: number };

/** A write's result: `save-too-large`, `save-slot-limit` or `save-store-failed` when it didn't land. */
export type SaveWriteResult = { ok: true; bytes: number } | { ok: false; issue: SceneIssue };

export const DEFAULT_LOCAL_STORAGE_PREFIX = "jams-engine:save:";
export const DEFAULT_INDEXED_DB_NAME = "jams-engine-saves";

export const BROWSER_SAVES_DESCRIBE = "Saves stay in this browser until you clear its site data.";
export const MEMORY_SAVES_DESCRIBE = "Saves last until this tab closes.";

/** The UTF-8 length of a save's text, what every limit is judged on. */
export const textBytes = (text: string): number => new TextEncoder().encode(text).length;

const kb = (bytes: number): string => `${Math.ceil(bytes / 1024)} KB`;

/** The line of `pointer` in a save's text, when the text has one. */
const placed = (text: string, pointer: string) => {
  const line = locatePointer(text, pointer);
  return line === undefined ? { path: pointer } : { path: pointer, line };
};

/**
 * Why a save of `bytes` to `slot` can't be written under `limits`, or null.
 * Size is judged first, so an oversized save never reads the slot list;
 * `slots` is asked for only then. A new slot past `maxSlots` is refused; an
 * overwrite never is.
 */
export async function saveLimitIssue(
  limits: SaveLimits,
  write: { slot: string; text: string; bytes: number },
  slots: () => Promise<readonly string[]>,
): Promise<SceneIssue | null> {
  if (write.bytes > limits.maxBytes) {
    return makeIssue("save-too-large", {
      message: `This save is ${kb(write.bytes)}; saves for this game are limited to ${kb(limits.maxBytes)}. Save less state in snapshot() or raise \`saves.limits.maxBytes\` for your own backend.`,
      ...placed(write.text, ""),
      expected: String(limits.maxBytes),
      got: String(write.bytes),
      detail: { bytes: write.bytes, maxBytes: limits.maxBytes },
    });
  }
  const held = await slots();
  if (!held.includes(write.slot) && held.length >= limits.maxSlots) {
    return makeIssue("save-slot-limit", {
      message: `This game keeps at most ${limits.maxSlots} saves; delete one to save again.`,
      ...placed(write.text, "/slot"),
      detail: { slots: held.length, maxSlots: limits.maxSlots },
    });
  }
  return null;
}

/** `save-store-failed` for a store call that threw or refused. */
export function storeFailed(what: string, slot: string, error: unknown, text?: string): SceneIssue {
  const why = error instanceof Error ? error.message : String(error);
  return makeIssue("save-store-failed", {
    message: `${what} slot "${slot}" failed: ${why}`,
    ...(text === undefined ? {} : placed(text, "/slot")),
  });
}

/** What a concrete store keeps per game: each slot's text. Any call may throw. */
export type SaveBackend = {
  entries(gameId: string): Promise<readonly { slot: string; text: string }[]>;
  read(gameId: string, slot: string): Promise<string | null>;
  write(gameId: string, slot: string, text: string): Promise<void>;
  remove(gameId: string, slot: string): Promise<void>;
};

/** A slot's summary, or null for a text that isn't a readable save. */
function summaryOf(slot: string, text: string): SaveSummary | null {
  const parsed = parseSaveFile(text);
  return parsed.ok ? { slot, meta: parsed.file.meta, bytes: textBytes(text) } : null;
}

/**
 * A `SaveStore` over `backend`, every call in try/catch: a list or read
 * that throws is empty, a remove that throws does nothing, a write that
 * throws is `save-store-failed`. `ceiling`, when given, is the most the
 * store holds whatever the game asks for.
 */
export function storeOver(
  backend: () => SaveBackend,
  meta: {
    kind: SaveStore["kind"];
    describe: () => string;
    ceiling?: SaveLimits;
    limits?: Partial<SaveLimits>;
  },
): SaveStore {
  const slotsOf = async (gameId: string) => (await backend().entries(gameId)).map((e) => e.slot);
  return {
    kind: meta.kind,
    get describe() {
      return meta.describe();
    },
    ...(meta.limits ? { limits: meta.limits } : {}),
    async list(gameId) {
      try {
        const out: SaveSummary[] = [];
        for (const { slot, text } of await backend().entries(gameId)) {
          const summary = summaryOf(slot, text);
          if (summary) out.push(summary);
        }
        return out.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
      } catch {
        return [];
      }
    },
    async read(gameId, slot) {
      try {
        return await backend().read(gameId, slot);
      } catch {
        return null;
      }
    },
    async write(gameId, slot, text) {
      const bytes = textBytes(text);
      try {
        if (meta.ceiling) {
          const refused = await saveLimitIssue(meta.ceiling, { slot, text, bytes }, () =>
            slotsOf(gameId),
          );
          if (refused) return { ok: false, issue: refused };
        }
        await backend().write(gameId, slot, text);
        return { ok: true, bytes };
      } catch (error) {
        return { ok: false, issue: storeFailed("writing", slot, error, text) };
      }
    },
    async remove(gameId, slot) {
      try {
        await backend().remove(gameId, slot);
      } catch {
        // A save that can't be removed stays listed; the game keeps running.
      }
    },
  };
}

/** Each game's slots in a map on this closure. */
export function memoryBackend(): SaveBackend {
  const games = new Map<string, Map<string, string>>();
  const slotsOf = (gameId: string) => {
    let slots = games.get(gameId);
    if (!slots) games.set(gameId, (slots = new Map()));
    return slots;
  };
  return {
    entries: async (gameId) => [...slotsOf(gameId)].map(([slot, text]) => ({ slot, text })),
    read: async (gameId, slot) => slotsOf(gameId).get(slot) ?? null,
    write: async (gameId, slot, text) => void slotsOf(gameId).set(slot, text),
    remove: async (gameId, slot) => void slotsOf(gameId).delete(slot),
  };
}

/** `${prefix}${gameId}:${slot}` keys in `storage`, read each call so a revoked one throws then. */
export function localStorageBackend(prefix: string, storage: () => Storage): SaveBackend {
  const keyOf = (gameId: string, slot: string) => `${prefix}${gameId}:${slot}`;
  return {
    async entries(gameId) {
      const s = storage();
      const head = `${prefix}${gameId}:`;
      const out: { slot: string; text: string }[] = [];
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (key === null || !key.startsWith(head)) continue;
        const text = s.getItem(key);
        if (text !== null) out.push({ slot: key.slice(head.length), text });
      }
      return out;
    },
    read: async (gameId, slot) => storage().getItem(keyOf(gameId, slot)),
    write: async (gameId, slot, text) => storage().setItem(keyOf(gameId, slot), text),
    remove: async (gameId, slot) => storage().removeItem(keyOf(gameId, slot)),
  };
}

/** The page's `localStorage`; throws where reading it does (blocked site data, some private modes). */
export function pageLocalStorage(): Storage {
  const storage = globalThis.localStorage as Storage | undefined;
  if (!storage) throw new Error("this page has no localStorage");
  return storage;
}

const OBJECT_STORE = "saves";

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("the IndexedDB request failed"));
  });

/** The page's `indexedDB`, or null where it is missing or reading it throws. */
export function pageIndexedDb(): IDBFactory | null {
  try {
    return (globalThis.indexedDB as IDBFactory | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * One object store of save texts keyed `${gameId}:${slot}`. The database
 * opens on first use; an open that fails is tried again on the next call.
 */
export function indexedDbBackend(name: string): SaveBackend & { open(): Promise<IDBDatabase> } {
  let opening: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const factory = pageIndexedDb();
      if (!factory) throw new Error("this page has no IndexedDB");
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(OBJECT_STORE))
          req.result.createObjectStore(OBJECT_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error(`IndexedDB "${name}" wouldn't open`));
      req.onblocked = () => reject(new Error(`IndexedDB "${name}" is blocked by another tab`));
    }).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  }
  async function objects(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await open();
    return db.transaction(OBJECT_STORE, mode).objectStore(OBJECT_STORE);
  }
  const keyOf = (gameId: string, slot: string) => `${gameId}:${slot}`;
  return {
    open,
    async entries(gameId) {
      const store = await objects("readonly");
      const head = `${gameId}:`;
      const range = IDBKeyRange.bound(head, `${head}￿`);
      const [keys, values] = await Promise.all([
        request(store.getAllKeys(range)),
        request(store.getAll(range)),
      ]);
      const out: { slot: string; text: string }[] = [];
      keys.forEach((key, i) => {
        const text: unknown = values[i];
        if (typeof key === "string" && typeof text === "string")
          out.push({ slot: key.slice(head.length), text });
      });
      return out;
    },
    async read(gameId, slot) {
      const text: unknown = await request((await objects("readonly")).get(keyOf(gameId, slot)));
      return typeof text === "string" ? text : null;
    },
    async write(gameId, slot, text) {
      await request((await objects("readwrite")).put(text, keyOf(gameId, slot)));
    },
    async remove(gameId, slot) {
      await request((await objects("readwrite")).delete(keyOf(gameId, slot)));
    },
  };
}

/** Saves held in this process; what headless runs use. */
export function memorySaveStore(): SaveStore {
  const backend = memoryBackend();
  return storeOver(() => backend, { kind: "memory", describe: () => MEMORY_SAVES_DESCRIBE });
}

/**
 * `${prefix}${gameId}:${slot}` keys in `localStorage` (or `storage`), every
 * access in try/catch. It holds at most `MAX_BROWSER_SAVE_LIMITS`.
 */
export function localStorageSaveStore(opts?: { prefix?: string; storage?: Storage }): SaveStore {
  const given = opts?.storage;
  const backend = localStorageBackend(
    opts?.prefix ?? DEFAULT_LOCAL_STORAGE_PREFIX,
    given ? () => given : pageLocalStorage,
  );
  return storeOver(() => backend, {
    kind: "browser",
    describe: () => BROWSER_SAVES_DESCRIBE,
    ceiling: MAX_BROWSER_SAVE_LIMITS,
  });
}

/** One IndexedDB database of saves, keyed by game and slot. It holds at most `MAX_BROWSER_SAVE_LIMITS`. */
export function indexedDbSaveStore(opts?: { db?: string }): SaveStore {
  const backend = indexedDbBackend(opts?.db ?? DEFAULT_INDEXED_DB_NAME);
  return storeOver(() => backend, {
    kind: "browser",
    describe: () => BROWSER_SAVES_DESCRIBE,
    ceiling: MAX_BROWSER_SAVE_LIMITS,
  });
}
