import { describe, expect, test } from "bun:test";

import { BUCKET_MS, planWindow, snowflakeAt, snowflakeTime, splitParts } from "./buckets.ts";

const HOUR = 3_600_000;
const at = (iso: string) => Date.parse(iso);

describe("snowflakes", () => {
  test("round-trip a time", () => {
    const ms = at("2026-10-26T15:19:59.583Z");
    expect(snowflakeTime(snowflakeAt(ms))).toBe(ms);
  });

  test("match Discord's documented example", () => {
    expect(new Date(snowflakeTime("175928847299117063")).toISOString()).toBe(
      "2016-04-30T11:18:25.796Z",
    );
  });
});

describe("planWindow", () => {
  test("splits a window into a partial head, whole closed buckets and the open bucket", () => {
    const now = at("2026-10-26T15:30:00Z");
    const spans = planWindow(now, 6 * HOUR);
    expect(
      spans.map((s) => [new Date(s.from).toISOString().slice(11, 16), s.bucket !== null]),
    ).toEqual([
      ["09:30", false],
      ["10:00", true],
      ["12:00", true],
      ["14:00", false],
    ]);
    expect(spans.at(-1)!.to).toBe(now);
    for (let i = 1; i < spans.length; i++) expect(spans[i].from).toBe(spans[i - 1].to);
  });

  test("has no head when the window starts on a bucket boundary", () => {
    const now = at("2026-10-26T16:30:00Z");
    const spans = planWindow(now, 2.5 * HOUR);
    expect(spans[0]).toEqual({
      from: at("2026-10-26T14:00:00Z"),
      to: at("2026-10-26T16:00:00Z"),
      bucket: at("2026-10-26T14:00:00Z"),
    });
  });

  test("is a single uncached span when the window fits inside the open bucket", () => {
    const now = at("2026-10-26T15:30:00Z");
    expect(planWindow(now, HOUR)).toEqual([{ from: now - HOUR, to: now, bucket: null }]);
  });

  test("buckets are BUCKET_MS long and UTC-aligned", () => {
    for (const span of planWindow(at("2026-10-26T15:30:00Z"), 24 * HOUR)) {
      if (span.bucket === null) continue;
      expect(span.to - span.from).toBe(BUCKET_MS);
      expect(span.from % BUCKET_MS).toBe(0);
    }
  });
});

test("splitParts keeps order and the remainder", () => {
  expect(splitParts([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});
