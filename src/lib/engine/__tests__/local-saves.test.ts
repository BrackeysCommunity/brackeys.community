// @vitest-environment jsdom
import { formatSaveFile, type SaveFile } from "@jams/engine/game";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { PREFS_MAX_BYTES, SITE_SAVE_LIMITS } from "../limits";
import {
  LOCAL_SAVES_DB,
  localPlayPrefs,
  localPlaySaves,
  prefsKey,
  prefsRefusal,
  SIGNED_OUT_SAVES_DESCRIBE,
} from "../local-saves";

function saveText(slot: string, data: unknown = null): string {
  const file: SaveFile = {
    kind: "save",
    v: 1,
    game: "tactics",
    gameVersion: 1,
    engine: "0.14.1",
    release: null,
    project: null,
    slot,
    meta: { scene: "one", savedAt: 0, playTicks: 0 },
    depth: "progress",
    persist: null,
    scene: { id: "one", runHash: "", sublevels: [] },
    data: data as SaveFile["data"],
  };
  return formatSaveFile(file);
}

/** A save of exactly `bytes` UTF-8 bytes. */
function saveOfBytes(slot: string, bytes: number): string {
  const base = saveText(slot, "");
  return saveText(slot, "x".repeat(bytes - new TextEncoder().encode(base).length));
}

type FakeReq = {
  result?: unknown;
  error?: unknown;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
  onblocked?: () => void;
};

const settle = (req: FakeReq, result: unknown) => {
  setTimeout(() => {
    req.result = result;
    req.onsuccess?.();
  }, 0);
  return req;
};

/** Enough of IndexedDB for the engine's save backend: one object store of string keys. */
function fakeIndexedDb(opts: { failOpen?: boolean } = {}) {
  const dbs = new Map<string, Map<string, Map<string, unknown>>>();
  const opened: string[] = [];
  const factory = {
    open(name: string) {
      opened.push(name);
      const req: FakeReq = {};
      if (opts.failOpen) {
        req.error = new DOMException("denied", "InvalidStateError");
        setTimeout(() => req.onerror?.(), 0);
        return req;
      }
      const fresh = !dbs.has(name);
      if (fresh) dbs.set(name, new Map());
      const stores = dbs.get(name)!;
      const db = {
        objectStoreNames: { contains: (s: string) => stores.has(s) },
        createObjectStore: (s: string) => stores.set(s, new Map()),
        onversionchange: null,
        transaction: (s: string) => ({
          objectStore: () => {
            const rows = stores.get(s)!;
            const inRange = (r: { lower: string; upper: string }) =>
              [...rows.keys()].filter((k) => k >= r.lower && k <= r.upper).sort();
            return {
              getAllKeys: (r: { lower: string; upper: string }) => settle({}, inRange(r)),
              getAll: (r: { lower: string; upper: string }) =>
                settle(
                  {},
                  inRange(r).map((k) => rows.get(k)),
                ),
              get: (k: string) => settle({}, rows.get(k)),
              put: (v: unknown, k: string) => settle({}, void rows.set(k, v)),
              delete: (k: string) => settle({}, void rows.delete(k)),
            };
          },
        }),
      };
      setTimeout(() => {
        req.result = db;
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
  return { factory, dbs, opened };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  } as Storage;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("IDBKeyRange", {
    bound: (lower: string, upper: string) => ({ lower, upper }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localPlaySaves", () => {
  it("keeps a project's saves in the jams-play-saves database, by project", async () => {
    const idb = fakeIndexedDb();
    vi.stubGlobal("indexedDB", idb.factory);
    const store = localPlaySaves("proj-1");
    const text = saveText("slot-1");
    expect(await store.write("tactics", "slot-1", text)).toEqual({
      ok: true,
      bytes: new TextEncoder().encode(text).length,
    });
    expect(await store.read("tactics", "slot-1")).toBe(text);
    expect((await store.list("tactics")).map((s) => s.slot)).toEqual(["slot-1"]);
    expect(idb.opened.every((n) => n === LOCAL_SAVES_DB)).toBe(true);
    const rows = idb.dbs.get(LOCAL_SAVES_DB)!.get("saves")!;
    expect([...rows.keys()]).toEqual(["proj-1:slot-1"]);
    await store.remove("tactics", "slot-1");
    expect(await store.read("tactics", "slot-1")).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("reports the site's limits and the signed-out sentence", () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb().factory);
    const store = localPlaySaves("proj-1");
    expect(store.kind).toBe("browser");
    expect(store.limits).toEqual(SITE_SAVE_LIMITS);
    expect(store.describe).toBe(SIGNED_OUT_SAVES_DESCRIBE);
    expect(SIGNED_OUT_SAVES_DESCRIBE).toBe(
      "Saves stay in this browser on jams.team until you clear its site data. Sign in to keep them on your account.",
    );
  });

  it("refuses a save over 32 KiB and a fifth slot in the site's words", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDb().factory);
    const store = localPlaySaves("proj-1");
    const big = await store.write("tactics", "slot-1", saveOfBytes("slot-1", 33 * 1024));
    expect(big.ok).toBe(false);
    if (!big.ok) {
      expect(big.issue.code).toBe("save-too-large");
      expect(big.issue.message).toBe(
        "This save is 33 KB; saves on jams.team are limited to 32 KB.",
      );
    }
    expect((await store.write("tactics", "a", saveOfBytes("a", 32 * 1024))).ok).toBe(true);
    for (const slot of ["b", "c", "d"])
      expect((await store.write("tactics", slot, saveText(slot))).ok).toBe(true);
    const fifth = await store.write("tactics", "e", saveText("e"));
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) {
      expect(fifth.issue.code).toBe("save-slot-limit");
      expect(fifth.issue.message).toBe(
        "You have 4 saves for this game, the most jams.team keeps. Delete one to save again.",
      );
    }
    expect((await store.write("tactics", "d", saveText("d", 1))).ok).toBe(true);
  });

  it("falls back to localStorage when the database won't open", async () => {
    const idb = fakeIndexedDb({ failOpen: true });
    vi.stubGlobal("indexedDB", idb.factory);
    const store = localPlaySaves("proj-1");
    const text = saveText("slot-1");
    expect((await store.write("tactics", "slot-1", text)).ok).toBe(true);
    expect(localStorage.getItem("jams-play-saves:proj-1:slot-1")).toBe(text);
    expect(store.describe).toBe(SIGNED_OUT_SAVES_DESCRIBE);
    await store.list("tactics");
    expect(idb.opened.length).toBe(1);
  });

  it("falls back to memory, and says so, when the browser keeps nothing", async () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const store = localPlaySaves("proj-1");
    expect(store.describe).toBe("Saves last until this tab closes.");
    const text = saveText("slot-1");
    expect((await store.write("tactics", "slot-1", text)).ok).toBe(true);
    expect(await store.read("tactics", "slot-1")).toBe(text);
  });
});

describe("localPlayPrefs", () => {
  it("keeps remaps and preferences under the project's keys", () => {
    const prefs = localPlayPrefs("proj-1");
    expect(prefs.load()).toEqual({ remap: null, prefs: null });
    prefs.save("remap", { v: 1, players: {} });
    prefs.save("prefs", { volume: 0.5 });
    expect(localStorage.getItem(prefsKey("proj-1", "remap"))).toBe('{"v":1,"players":{}}');
    expect(prefsKey("proj-1", "prefs")).toBe("jams-play:proj-1:prefs");
    expect(prefs.load()).toEqual({ remap: { v: 1, players: {} }, prefs: { volume: 0.5 } });
    prefs.save("prefs", null);
    expect(localStorage.getItem("jams-play:proj-1:prefs")).toBeNull();
  });

  it("keeps nothing over 16 KiB, and reads a broken value as none", () => {
    const prefs = localPlayPrefs("proj-1");
    prefs.save("prefs", "x".repeat(PREFS_MAX_BYTES));
    expect(localStorage.getItem("jams-play:proj-1:prefs")).toBeNull();
    expect(prefsRefusal("x".repeat(PREFS_MAX_BYTES))?.message).toBe(
      "These settings take 17 KB; jams.team keeps at most 16 KB of them in this browser.",
    );
    expect(prefsRefusal({ ok: true })).toBeNull();
    localStorage.setItem("jams-play:proj-1:remap", "{not json");
    expect(prefs.load().remap).toBeNull();
  });

  it("survives storage that throws on every access", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    const prefs = localPlayPrefs("proj-1");
    expect(() => prefs.save("remap", { v: 1 })).not.toThrow();
    expect(prefs.load()).toEqual({ remap: null, prefs: null });
  });
});
