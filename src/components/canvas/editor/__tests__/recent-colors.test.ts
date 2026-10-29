// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Only the hex check; the whole card module is slow to re-import per test.
vi.mock("../../canvas-cards", () => ({
  isHexColor: (color: string) => /^#[0-9a-fA-F]{6}$/.test(color),
}));

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

async function load() {
  return import("../recent-colors");
}

describe("recent colors", () => {
  it("keeps the newest first, without duplicates, capped at four", async () => {
    const { readRecentColors, rememberColor } = await load();
    for (const c of ["#111111", "#222222", "#333333", "#444444", "#555555", "#222222"]) {
      rememberColor(c);
    }
    expect(readRecentColors()).toEqual(["#222222", "#555555", "#444444", "#333333"]);
  });

  it("ignores anything that isn't a six-digit hex and lowercases the rest", async () => {
    const { readRecentColors, rememberColor } = await load();
    rememberColor("red");
    rememberColor("#ABCDEF");
    expect(readRecentColors()).toEqual(["#abcdef"]);
  });

  it("survives a reload and drops stored junk", async () => {
    window.localStorage.setItem("jt:canvas-recent-colors", '["#00ff00", 3, "nope"]');
    const { readRecentColors } = await load();
    expect(readRecentColors()).toEqual(["#00ff00"]);
  });

  it("tells subscribers when the list changes", async () => {
    const { rememberColor, subscribeRecentColors } = await load();
    const listener = vi.fn();
    const stop = subscribeRecentColors(listener);
    rememberColor("#123456");
    stop();
    rememberColor("#654321");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
