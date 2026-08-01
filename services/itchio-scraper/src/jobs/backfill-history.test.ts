import { describe, expect, test } from "bun:test";

import { isIngestComplete } from "./backfill-history.ts";

describe("isIngestComplete", () => {
  test("a jam with entries persisted is complete", () => {
    expect(isIngestComplete({ status: "over", entriesCount: 42, hasEntries: true })).toBe(true);
  });

  test("a jam reporting zero entries has nothing further to fetch", () => {
    expect(isIngestComplete({ status: "over", entriesCount: 0, hasEntries: false })).toBe(true);
    expect(isIngestComplete({ status: "over", entriesCount: null, hasEntries: false })).toBe(true);
  });

  test("a non-terminal jam is the nightly cron's job, not the backfill's", () => {
    expect(isIngestComplete({ status: "in-progress", entriesCount: 10, hasEntries: false })).toBe(
      true,
    );
  });

  test("an over jam whose entries never landed must be re-ingested", () => {
    expect(isIngestComplete({ status: "over", entriesCount: 42, hasEntries: false })).toBe(false);
  });
});
