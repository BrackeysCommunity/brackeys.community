import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vite-plus/test";

import { isUniqueViolation } from "@/lib/pg-errors";

/**
 * The regression this guards shipped silently. Three call sites tested
 * `"code" in err && err.code === "23505"` against the outer error, which
 * stopped matching once drizzle began wrapping failures — so every retry
 * path behind the check went unreachable and unique violations surfaced raw
 * from production inserts.
 *
 * The wrapped cases construct a real `DrizzleQueryError` rather than an
 * object shaped like one. A hand-rolled stand-in is what let this through in
 * the first place: it would have kept passing against the old outer-only
 * check, because the mock is written to whatever the test author assumed the
 * shape was.
 */

/** What `pg` raises for a unique violation, trimmed to what we read. */
function pgUniqueViolation() {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "projects_slug_key",
  });
}

describe("isUniqueViolation", () => {
  it("matches a bare driver error", () => {
    expect(isUniqueViolation(pgUniqueViolation())).toBe(true);
  });

  it("matches through a real DrizzleQueryError wrapper", () => {
    const wrapped = new DrizzleQueryError(
      'insert into "project"."projects" ...',
      [],
      pgUniqueViolation(),
    );

    // The wrapper carries no `code` of its own — the whole reason the
    // outer-only check failed.
    expect((wrapped as unknown as { code?: unknown }).code).toBeUndefined();
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("matches when the driver error is wrapped more than once", () => {
    const inner = new DrizzleQueryError("insert ...", [], pgUniqueViolation());
    const outer = new Error("sync failed", { cause: inner });

    expect(isUniqueViolation(outer)).toBe(true);
  });

  it("does not match a different postgres code", () => {
    const foreignKey = Object.assign(new Error("fk"), { code: "23503" });

    expect(isUniqueViolation(foreignKey)).toBe(false);
    expect(isUniqueViolation(new DrizzleQueryError("insert ...", [], foreignKey))).toBe(false);
  });

  it("does not match an ordinary error, or a non-error", () => {
    expect(isUniqueViolation(new Error("nope"))).toBe(false);
    expect(isUniqueViolation(new DrizzleQueryError("insert ...", [], new Error("nope")))).toBe(
      false,
    );
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("terminates on a cause cycle rather than spinning", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;

    expect(isUniqueViolation(a)).toBe(false);
  });
});
