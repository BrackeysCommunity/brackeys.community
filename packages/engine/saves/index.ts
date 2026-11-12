/** Save stores and slots: where a game's saves live and how an instance reads and writes them. */
export {
  DEFAULT_INDEXED_DB_NAME,
  DEFAULT_LOCAL_STORAGE_PREFIX,
  indexedDbSaveStore,
  localStorageSaveStore,
  memorySaveStore,
  type SaveStore,
  type SaveSummary,
  type SaveWriteResult,
} from "./store";
export { browserSaveStore } from "./browser";
export type { SaveSlots } from "./slots";
