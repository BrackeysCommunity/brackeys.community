import {
  indexedDbSaveStore,
  localStorageSaveStore,
  memorySaveStore,
  type SaveStore,
} from "@jams/engine";
import { makeIssue, type SceneIssue } from "@jams/engine/scene";

import { formatBytes } from "@/lib/format-bytes";
import { SITE } from "@/lib/legal-meta";

import { PREFS_MAX_BYTES, SITE_SAVE_EXPIRY_DAYS, SITE_SAVE_LIMITS } from "./limits";

/** What a signed-out player's save menu says on the play page. */
export const SIGNED_OUT_SAVES_DESCRIBE = `Saves stay in this browser on ${SITE.name} until you clear its site data. Sign in to keep them on your account.`;
/** What a signed-in player's save menu says on the play page. */
export const SIGNED_IN_SAVES_DESCRIBE = `Saved to your ${SITE.name} account: up to ${SITE_SAVE_LIMITS.maxSlots} saves of ${formatBytes(SITE_SAVE_LIMITS.maxBytes)} for this game. Saves you don't use for ${SITE_SAVE_EXPIRY_DAYS} days are deleted.`;

/** The IndexedDB database signed-out saves live in, one key range per project. */
export const LOCAL_SAVES_DB = "jams-play-saves";
/** The `localStorage` prefix signed-out saves fall back to where IndexedDB won't open. */
export const LOCAL_SAVES_PREFIX = "jams-play-saves:";

const PROBE_GAME = "jams-play:probe";
const PROBE_SLOT = "probe";

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** A size over a limit, rounded up so it never reads as the limit itself. */
const overBytes = (bytes: number): string => formatBytes(Math.ceil(bytes / 1024) * 1024);

/**
 * Why a save can't be written under the site's caps, in the site's words, or
 * null. Size is judged first, so an oversized save never lists the slots; an
 * overwrite of a held slot is never refused for the count.
 */
export async function siteSaveRefusal(
  write: { slot: string; text: string },
  slots: () => Promise<readonly string[]>,
): Promise<SceneIssue | null> {
  const bytes = utf8Bytes(write.text);
  if (bytes > SITE_SAVE_LIMITS.maxBytes) {
    return makeIssue("save-too-large", {
      message: `This save is ${overBytes(bytes)}; saves on ${SITE.name} are limited to ${formatBytes(SITE_SAVE_LIMITS.maxBytes)}.`,
      hint: "Save less state in snapshot(), or give the game its own save backend (saves.store).",
      expected: String(SITE_SAVE_LIMITS.maxBytes),
      got: String(bytes),
      detail: { bytes, maxBytes: SITE_SAVE_LIMITS.maxBytes },
    });
  }
  const held = await slots();
  if (!held.includes(write.slot) && held.length >= SITE_SAVE_LIMITS.maxSlots) {
    return makeIssue("save-slot-limit", {
      message: `You have ${SITE_SAVE_LIMITS.maxSlots} saves for this game, the most ${SITE.name} keeps. Delete one to save again.`,
      detail: { slots: held.length, maxSlots: SITE_SAVE_LIMITS.maxSlots },
    });
  }
  return null;
}

/** Why a preferences value can't be kept in this browser, or null. */
export function prefsRefusal(value: unknown): SceneIssue | null {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    return makeIssue("save-store-failed", { message: "These settings can't be stored." });
  }
  const bytes = utf8Bytes(text);
  if (bytes <= PREFS_MAX_BYTES) return null;
  return makeIssue("save-store-failed", {
    message: `These settings take ${overBytes(bytes)}; ${SITE.name} keeps at most ${formatBytes(PREFS_MAX_BYTES)} of them in this browser.`,
    detail: { bytes, maxBytes: PREFS_MAX_BYTES },
  });
}

function hasIndexedDb(): boolean {
  try {
    return typeof globalThis.indexedDB !== "undefined" && globalThis.indexedDB !== null;
  } catch {
    return false;
  }
}

function localStorageWorks(): boolean {
  try {
    const storage = globalThis.localStorage;
    const key = `${LOCAL_SAVES_PREFIX}probe`;
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** `localStorage` when a write there works, else memory. */
const storageOrMemory = (): SaveStore =>
  localStorageWorks() ? localStorageSaveStore({ prefix: LOCAL_SAVES_PREFIX }) : memorySaveStore();

/** IndexedDB when a probe write lands, else the next fallback, decided once. */
async function pickStore(): Promise<SaveStore> {
  if (!hasIndexedDb()) return storageOrMemory();
  const idb = indexedDbSaveStore({ db: LOCAL_SAVES_DB });
  const probe = await idb.write(PROBE_GAME, PROBE_SLOT, "1");
  if (!probe.ok) return storageOrMemory();
  await idb.remove(PROBE_GAME, PROBE_SLOT);
  return idb;
}

/**
 * A signed-out player's saves for one project in this browser: the engine's
 * IndexedDB store in `jams-play-saves`, else `localStorage`, else memory,
 * held to `SITE_SAVE_LIMITS`. Saves are kept by project, whatever game id a
 * call names; the host has already checked it is the release's.
 */
export function localPlaySaves(projectId: string): SaveStore {
  let picked: SaveStore | null = hasIndexedDb() ? null : storageOrMemory();
  let picking: Promise<SaveStore> | null = null;
  const store = async (): Promise<SaveStore> => {
    if (picked) return picked;
    picking ??= pickStore().then((s) => (picked = s));
    return picking;
  };
  const slotsOf = async () => (await (await store()).list(projectId)).map((s) => s.slot);
  return {
    kind: "browser",
    get describe() {
      return picked?.kind === "memory" ? picked.describe : SIGNED_OUT_SAVES_DESCRIBE;
    },
    limits: SITE_SAVE_LIMITS,
    list: async () => (await store()).list(projectId),
    read: async (_gameId, slot) => (await store()).read(projectId, slot),
    async write(_gameId, slot, text) {
      const refused = await siteSaveRefusal({ slot, text }, slotsOf);
      if (refused) return { ok: false, issue: refused };
      return (await store()).write(projectId, slot, text);
    },
    remove: async (_gameId, slot) => (await store()).remove(projectId, slot),
  };
}

export type LocalPlayPrefs = {
  load(): { remap: unknown; prefs: unknown };
  save(store: "remap" | "prefs", value: unknown): void;
};

/** The `localStorage` key of one project's remaps or other preferences. */
export const prefsKey = (projectId: string, store: "remap" | "prefs"): string =>
  `jams-play:${projectId}:${store}`;

function readPrefs(key: string): unknown {
  try {
    const text = globalThis.localStorage.getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/**
 * A signed-out player's remaps and preferences for one project in this
 * browser's `localStorage`, each store at most `PREFS_MAX_BYTES`. A value
 * over it, or one storage refuses, is not kept; `null` clears the store.
 */
export function localPlayPrefs(projectId: string): LocalPlayPrefs {
  return {
    load: () => ({
      remap: readPrefs(prefsKey(projectId, "remap")),
      prefs: readPrefs(prefsKey(projectId, "prefs")),
    }),
    save(store, value) {
      if (prefsRefusal(value)) return;
      try {
        const key = prefsKey(projectId, store);
        if (value === null) globalThis.localStorage.removeItem(key);
        else globalThis.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage that refuses keeps the previous value; the game plays on.
      }
    },
  };
}
