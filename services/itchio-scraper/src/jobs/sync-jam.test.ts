import { describe, expect, test } from "bun:test";

import { canSkipMetadataRefresh, displacedSlug, type TerminalJamRow } from "./sync-jam.ts";

describe("displacedSlug", () => {
  test("parks a displaced jam under a recognizable synthetic slug", () => {
    expect(displacedSlug("days-of-horror-4", 123456)).toBe("days-of-horror-4--displaced-123456");
  });
});

describe("canSkipMetadataRefresh", () => {
  const row = (over: Partial<TerminalJamRow> = {}): TerminalJamRow => ({
    status: "over",
    missingSince: null,
    hasEntries: true,
    ...over,
  });

  test("skips the refetch for a finished jam with entries already ingested", () => {
    expect(canSkipMetadataRefresh(row())).toBe(true);
  });

  test("always refetches a jam that is still running", () => {
    // Metadata, entry list, and rating counts are all still moving.
    expect(canSkipMetadataRefresh(row({ status: "in-progress" }))).toBe(false);
    expect(canSkipMetadataRefresh(row({ status: "upcoming" }))).toBe(false);
    expect(canSkipMetadataRefresh(row({ status: "voting" }))).toBe(false);
  });

  test("always refetches a jam stamped missing", () => {
    // Its page has to be re-read to confirm it still 404s or has come back.
    expect(canSkipMetadataRefresh(row({ missingSince: new Date("2026-08-01") }))).toBe(false);
  });

  test("always refetches when no entries have been ingested yet", () => {
    expect(canSkipMetadataRefresh(row({ hasEntries: false }))).toBe(false);
  });
});
