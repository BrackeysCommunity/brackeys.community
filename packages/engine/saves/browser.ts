import { MAX_BROWSER_SAVE_LIMITS } from "../game/save-file";
import {
  BROWSER_SAVES_DESCRIBE,
  DEFAULT_INDEXED_DB_NAME,
  DEFAULT_LOCAL_STORAGE_PREFIX,
  indexedDbBackend,
  localStorageBackend,
  MEMORY_SAVES_DESCRIBE,
  memoryBackend,
  pageIndexedDb,
  pageLocalStorage,
  storeOver,
  type SaveBackend,
  type SaveStore,
} from "./store";

type Picked = { backend: SaveBackend; describe: string };

const PROBE_KEY = `${DEFAULT_LOCAL_STORAGE_PREFIX}probe`;

/** `localStorage` when a write and a remove both work there, else memory. */
function storageOrMemory(): Picked {
  try {
    const storage = pageLocalStorage();
    storage.setItem(PROBE_KEY, "1");
    storage.removeItem(PROBE_KEY);
    return {
      backend: localStorageBackend(DEFAULT_LOCAL_STORAGE_PREFIX, () => storage),
      describe: BROWSER_SAVES_DESCRIBE,
    };
  } catch {
    return { backend: memoryBackend(), describe: MEMORY_SAVES_DESCRIBE };
  }
}

/**
 * IndexedDB, else `localStorage`, else memory ("Saves last until this tab
 * closes."), probed once on first use. A database that won't open falls back
 * to the next once, before its first call returns; `describe` follows what
 * the saves are actually in.
 */
export function browserSaveStore(): SaveStore {
  let picked: Picked | null = null;
  function pick(): Picked {
    if (picked) return picked;
    if (!pageIndexedDb()) return (picked = storageOrMemory());
    const idb = indexedDbBackend(DEFAULT_INDEXED_DB_NAME);
    let opened: Promise<SaveBackend> | null = null;
    /** The database, or the fallback for good once it fails to open. */
    const ready = () =>
      (opened ??= idb.open().then(
        () => idb,
        () => {
          picked = storageOrMemory();
          return picked.backend;
        },
      ));
    const deferred: SaveBackend = {
      entries: async (gameId) => (await ready()).entries(gameId),
      read: async (gameId, slot) => (await ready()).read(gameId, slot),
      write: async (gameId, slot, text) => (await ready()).write(gameId, slot, text),
      remove: async (gameId, slot) => (await ready()).remove(gameId, slot),
    };
    return (picked = { backend: deferred, describe: BROWSER_SAVES_DESCRIBE });
  }
  return storeOver(() => pick().backend, {
    kind: "browser",
    describe: () => pick().describe,
    ceiling: MAX_BROWSER_SAVE_LIMITS,
  });
}
