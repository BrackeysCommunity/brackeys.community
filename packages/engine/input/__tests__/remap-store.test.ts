// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { browserRemapStore, matchCapturePress, memoryRemapStore, type RemapState } from "../remap";

const STATE: RemapState = {
  v: 1,
  players: {
    0: { jump: [{ device: "key", code: "KeyK" }] },
    1: {
      jump: [{ device: "pad", button: "south" }],
      fire: [{ device: "pointer", button: "primary" }],
    },
  },
};

function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("memoryRemapStore", () => {
  it("saves and loads a copy per game", () => {
    const store = memoryRemapStore();
    expect(store.load("g")).toBeNull();
    store.save("g", STATE);
    const loaded = store.load("g");
    expect(loaded).toEqual(STATE);
    expect(loaded).not.toBe(STATE);
    expect(store.load("other")).toBeNull();
  });
});

describe("browserRemapStore", () => {
  it("saves and loads under the prefix and game id", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const store = browserRemapStore();
    store.save("platformer", STATE);
    expect(storage.getItem("jams-engine:remap:platformer")).toBe(JSON.stringify(STATE));
    expect(store.load("platformer")).toEqual(STATE);
    expect(browserRemapStore().load("platformer")).toEqual(STATE);
    expect(store.load("other")).toBeNull();

    const custom = browserRemapStore("mine:");
    custom.save("platformer", { v: 1, players: {} });
    expect(storage.getItem("mine:platformer")).toBe('{"v":1,"players":{}}');
  });

  it("is an empty store, never throwing, when localStorage throws", () => {
    const boom = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom });
    const store = browserRemapStore();
    expect(() => store.save("g", STATE)).not.toThrow();
    expect(store.load("g")).toBeNull();
  });

  it("is an empty store when reading localStorage itself throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      const store = browserRemapStore();
      expect(() => store.save("g", STATE)).not.toThrow();
      expect(store.load("g")).toBeNull();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("is an empty store when there is no localStorage", () => {
    vi.stubGlobal("localStorage", undefined);
    const store = browserRemapStore();
    expect(() => store.save("g", STATE)).not.toThrow();
    expect(store.load("g")).toBeNull();
  });

  it("loads a corrupt or foreign value as none", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const store = browserRemapStore();
    const corrupt = [
      "{not json",
      "null",
      "[]",
      '"text"',
      '{"v":2,"players":{}}',
      '{"v":1}',
      '{"v":1,"players":[]}',
      '{"v":1,"players":{"x":{}}}',
      '{"v":1,"players":{"-1":{}}}',
      '{"v":1,"players":{"0":{"jump":{}}}}',
      '{"v":1,"players":{"0":{"jump":[{"code":"KeyK"}]}}}',
      '{"v":1,"players":{"0":{"jump":[{"device":"wheel"}]}}}',
    ];
    for (const raw of corrupt) {
      storage.setItem("jams-engine:remap:g", raw);
      expect(store.load("g"), raw).toBeNull();
    }
  });
});

describe("matchCapturePress", () => {
  it("binds the next key, pad button or pointer press", () => {
    expect(matchCapturePress({ device: "key", code: "KeyZ" })).toEqual({
      kind: "bind",
      binding: { device: "key", code: "KeyZ" },
    });
    expect(matchCapturePress({ device: "pad", button: "south" })).toEqual({
      kind: "bind",
      binding: { device: "pad", button: "south" },
    });
    expect(matchCapturePress({ device: "pad", button: 20 })).toEqual({
      kind: "bind",
      binding: { device: "pad", button: 20 },
    });
    expect(matchCapturePress({ device: "pointer", button: 2 })).toEqual({
      kind: "bind",
      binding: { device: "pointer", button: "secondary" },
    });
    expect(matchCapturePress({ device: "pointer", button: "middle" })).toEqual({
      kind: "bind",
      binding: { device: "pointer", button: "middle" },
    });
  });

  it("cancels on Escape, even when keys aren't asked for", () => {
    expect(matchCapturePress({ device: "key", code: "Escape" })).toEqual({ kind: "cancel" });
    expect(matchCapturePress({ device: "key", code: "Escape" }, ["pad"])).toEqual({
      kind: "cancel",
    });
  });

  it("keeps waiting on repeats, unknown codes and devices not asked for", () => {
    const wait = { kind: "wait" };
    expect(matchCapturePress({ device: "key", code: "KeyA", repeat: true })).toEqual(wait);
    expect(matchCapturePress({ device: "key", code: "Unidentified" })).toEqual(wait);
    expect(matchCapturePress({ device: "key", code: "KeyA" }, ["pad"])).toEqual(wait);
    expect(matchCapturePress({ device: "pointer", button: 0 }, ["key", "pad"])).toEqual(wait);
    expect(matchCapturePress({ device: "pointer", button: 3 })).toEqual(wait);
    expect(matchCapturePress({ device: "pad", button: -1 })).toEqual(wait);
    expect(matchCapturePress({ device: "pad", button: "turbo" as "south" })).toEqual(wait);
  });
});
