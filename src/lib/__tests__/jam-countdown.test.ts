import { describe, expect, it } from "vite-plus/test";

import {
  durationDays,
  effectiveJamState,
  formatCountdown,
  formatJamShortDates,
  formatRelativeMs,
} from "../jam-countdown";

const NOW = new Date("2026-04-30T12:00:00Z");

describe("formatRelativeMs", () => {
  it("formats sub-hour durations as Mm only", () => {
    expect(formatRelativeMs(15 * 60_000)).toEqual({ text: "15m", past: false });
  });

  it("zero-pads minutes", () => {
    expect(formatRelativeMs(3 * 60_000)).toEqual({ text: "03m", past: false });
  });

  it("formats hours-only spans (no day, no minutes)", () => {
    const h = 5 * 3_600_000 + 13 * 60_000;
    expect(formatRelativeMs(h)).toEqual({ text: "5h 13m", past: false });
  });

  it("formats day spans as `Nd HHh` (drops minutes)", () => {
    const span = 2 * 86_400_000 + 7 * 3_600_000 + 30 * 60_000;
    expect(formatRelativeMs(span)).toEqual({ text: "2d 07h", past: false });
  });

  it("flags negative durations as past", () => {
    expect(formatRelativeMs(-90_000_000)).toEqual({ text: expect.any(String), past: true });
  });

  it("treats exactly zero as not-past", () => {
    expect(formatRelativeMs(0).past).toBe(false);
  });
});

describe("formatCountdown", () => {
  it("returns null when target is missing", () => {
    expect(formatCountdown(null, NOW)).toBeNull();
    expect(formatCountdown(undefined, NOW)).toBeNull();
  });

  it("returns null for unparseable date strings", () => {
    expect(formatCountdown("not-a-date", NOW)).toBeNull();
  });

  it("computes future deltas", () => {
    const target = new Date(NOW.getTime() + 86_400_000 + 3 * 3_600_000);
    expect(formatCountdown(target, NOW)).toEqual({ text: "1d 03h", past: false });
  });

  it("accepts ISO strings as input", () => {
    const target = new Date(NOW.getTime() + 2 * 3_600_000).toISOString();
    expect(formatCountdown(target, NOW)).toEqual({ text: "2h 00m", past: false });
  });

  it("flags past targets", () => {
    const target = new Date(NOW.getTime() - 5 * 60_000);
    expect(formatCountdown(target, NOW)?.past).toBe(true);
  });
});

describe("formatJamShortDates", () => {
  it("returns null when either bound is missing", () => {
    expect(formatJamShortDates(null, new Date())).toBeNull();
    expect(formatJamShortDates(new Date(), null)).toBeNull();
  });

  it("collapses same-month spans to a single month label", () => {
    const result = formatJamShortDates(
      new Date("2026-04-24T00:00:00Z"),
      new Date("2026-04-27T00:00:00Z"),
    );
    // Locale-dependent month abbreviation, just ensure structure
    expect(result).toMatch(/^[A-Za-z]+ 24-27$/);
  });

  it("expands across-month spans with both labels", () => {
    const result = formatJamShortDates(
      new Date("2026-02-14T00:00:00Z"),
      new Date("2026-06-09T00:00:00Z"),
    );
    expect(result).toMatch(/^[A-Za-z]+ 14 – [A-Za-z]+ 9$/);
  });
});

describe("effectiveJamState", () => {
  it("returns 'unknown' when both dates are missing", () => {
    expect(effectiveJamState(null, null, NOW)).toBe("unknown");
  });

  it("returns 'upcoming' when now is before startsAt", () => {
    const start = new Date(NOW.getTime() + 86_400_000);
    const end = new Date(NOW.getTime() + 5 * 86_400_000);
    expect(effectiveJamState(start, end, NOW)).toBe("upcoming");
  });

  it("returns 'running' when now sits inside the window", () => {
    const start = new Date(NOW.getTime() - 86_400_000);
    const end = new Date(NOW.getTime() + 86_400_000);
    expect(effectiveJamState(start, end, NOW)).toBe("running");
  });

  it("returns 'ended' when now is past endsAt", () => {
    const start = new Date(NOW.getTime() - 5 * 86_400_000);
    const end = new Date(NOW.getTime() - 86_400_000);
    expect(effectiveJamState(start, end, NOW)).toBe("ended");
  });

  it("ignores stale DB status: dates that span 'now' read as running even if scraper says upcoming", () => {
    // GameLab 3x3 case: starts_at Feb 14, ends_at Jun 9, today Apr 30,
    // scraper status="upcoming" (lagged). Expect running.
    const start = new Date("2026-02-14T16:00:00Z");
    const end = new Date("2026-06-09T16:00:00Z");
    expect(effectiveJamState(start, end, NOW)).toBe("running");
  });

  it("treats a missing endsAt with a started jam as running", () => {
    const start = new Date(NOW.getTime() - 86_400_000);
    expect(effectiveJamState(start, null, NOW)).toBe("running");
  });

  it("accepts ISO strings as inputs", () => {
    const start = new Date(NOW.getTime() - 86_400_000).toISOString();
    const end = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(effectiveJamState(start, end, NOW)).toBe("running");
  });
});

describe("durationDays", () => {
  it("returns null when either bound is missing", () => {
    expect(durationDays(null, new Date())).toBeNull();
    expect(durationDays(new Date(), null)).toBeNull();
  });

  it("rounds spans to whole days", () => {
    const start = new Date("2026-04-01T00:00:00Z");
    const end = new Date("2026-04-08T00:00:00Z");
    expect(durationDays(start, end)).toBe("7d");
  });

  it("clamps negative spans to 0d", () => {
    const start = new Date("2026-04-08T00:00:00Z");
    const end = new Date("2026-04-01T00:00:00Z");
    expect(durationDays(start, end)).toBe("0d");
  });

  it("rounds non-integer day-fractions", () => {
    const start = new Date("2026-04-01T00:00:00Z");
    const end = new Date("2026-04-01T18:00:00Z"); // 0.75d → 1d
    expect(durationDays(start, end)).toBe("1d");
  });
});
