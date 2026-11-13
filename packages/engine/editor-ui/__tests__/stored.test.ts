import { describe, expect, it } from "vite-plus/test";

import type { EditorStorage } from "../host";
import { isRecord, readStored, storedFlag, storedFlags, writeStored } from "../session/stored";

function memory(init: Record<string, string> = {}): EditorStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

const throwing: EditorStorage = {
  get: () => {
    throw new Error("denied");
  },
  set: () => {
    throw new Error("denied");
  },
};

describe("stored editor state", () => {
  it("reads what it wrote, through the parser", () => {
    const storage = memory();
    writeStored(storage, "k", { a: true, b: false });
    expect(storage.data.get("k")).toBe('{"a":true,"b":false}');
    expect(readStored(storage, "k", {}, storedFlags)).toEqual({ a: true, b: false });
  });

  it("falls back when the storage is absent, refuses, or holds nothing usable", () => {
    const fallback = { x: true };
    expect(readStored(null, "k", fallback, storedFlags)).toBe(fallback);
    expect(readStored(throwing, "k", fallback, storedFlags)).toBe(fallback);
    expect(readStored(memory(), "k", fallback, storedFlags)).toBe(fallback);
    expect(readStored(memory({ k: "{not json" }), "k", fallback, storedFlags)).toBe(fallback);
    expect(readStored(memory({ k: "[1,2]" }), "k", fallback, storedFlags)).toBe(fallback);
    expect(readStored(memory({ k: '"type"' }), "k", 0, () => null)).toBe(0);
  });

  it("swallows a refused or absent write", () => {
    expect(() => writeStored(throwing, "k", 1)).not.toThrow();
    expect(() => writeStored(null, "k", 1)).not.toThrow();
  });

  it("keeps only the boolean entries of a flag map", () => {
    expect(storedFlags({ a: true, b: "yes", c: false, d: null })).toEqual({ a: true, c: false });
    expect(storedFlags(null)).toBeNull();
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("reads a stored boolean, and nothing else, as a flag", () => {
    expect(readStored(memory({ k: "true" }), "k", false, storedFlag)).toBe(true);
    expect(readStored(memory({ k: "false" }), "k", true, storedFlag)).toBe(false);
    expect(readStored(memory({ k: '"true"' }), "k", false, storedFlag)).toBe(false);
    expect(storedFlag(1)).toBeNull();
  });
});
