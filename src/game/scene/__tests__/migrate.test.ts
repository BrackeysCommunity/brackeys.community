import { describe, expect, it } from "vite-plus/test";

import { MIGRATIONS, migrate } from "../migrate";

describe("migrate", () => {
  it("passes a current document through", () => {
    const raw = { v: 1, name: "x" };
    expect(migrate(raw)).toEqual({ ok: true, raw, from: 1 });
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it("rejects a missing or invalid v as schema", () => {
    for (const raw of [{}, { v: "1" }, { v: 0 }, { v: 1.5 }, [], null]) {
      const r = migrate(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issue.code).toBe("schema");
    }
  });

  it("refuses a newer version", () => {
    const r = migrate({ v: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issue.code).toBe("version-newer");
      expect(r.issue.path).toBe("/v");
    }
  });

  it("runs each step in order up to the target", () => {
    const steps = {
      1: (raw: unknown) => ({ ...(raw as object), v: 2, a: true }),
      2: (raw: unknown) => ({ ...(raw as object), v: 3, b: true }),
    };
    expect(migrate({ v: 1 }, steps, 3)).toEqual({
      ok: true,
      raw: { v: 3, a: true, b: true },
      from: 1,
    });
    const gap = migrate({ v: 1 }, { 1: steps[1] }, 3);
    expect(gap.ok === false && gap.issue.message).toContain("v2 to v3");
  });
});
