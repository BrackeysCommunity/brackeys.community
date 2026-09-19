import { describe, expect, it } from "vite-plus/test";

import { marcoMacros } from "../commands";

describe("marcoMacros", () => {
  it("lists macros alphabetically, case-insensitively", () => {
    const names = marcoMacros.map((m) => m.name).filter((n) => /^[a-z0-9]/i.test(n));
    const sorted = [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    expect(names).toEqual(sorted);
  });

  it("sorts names that don't start with a letter or digit to the end", () => {
    const names = marcoMacros.map((m) => m.name);
    const firstSymbol = names.findIndex((n) => !/^[a-z0-9]/i.test(n));
    expect(firstSymbol).toBeGreaterThan(0);
    expect(names.slice(firstSymbol).every((n) => !/^[a-z0-9]/i.test(n))).toBe(true);
  });

  it("keeps every macro unique by name", () => {
    const names = marcoMacros.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
