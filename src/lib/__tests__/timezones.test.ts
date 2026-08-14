import { describe, expect, it } from "vite-plus/test";

import {
  currentOffsetMinutes,
  formatUtcOffset,
  isValidTimezone,
  timezoneOffsetLabel,
  timezonesWithinOffset,
} from "@/lib/timezones";

// Fixed instants dodge DST flakiness: January (northern winter) and July.
const JANUARY = new Date("2026-01-15T12:00:00Z");
const JULY = new Date("2026-07-15T12:00:00Z");

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimezone("Europe/Madrid")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("currentOffsetMinutes", () => {
  it("resolves whole-hour offsets", () => {
    expect(currentOffsetMinutes("UTC", JANUARY)).toBe(0);
    expect(currentOffsetMinutes("Europe/Madrid", JANUARY)).toBe(60);
    expect(currentOffsetMinutes("America/New_York", JANUARY)).toBe(-300);
  });

  it("tracks DST — the whole reason offsets are derived, not stored", () => {
    expect(currentOffsetMinutes("Europe/Madrid", JULY)).toBe(120);
    expect(currentOffsetMinutes("America/New_York", JULY)).toBe(-240);
  });

  it("resolves half-hour and 45-minute zones", () => {
    expect(currentOffsetMinutes("Asia/Kolkata", JANUARY)).toBe(330);
    expect(currentOffsetMinutes("Asia/Kathmandu", JANUARY)).toBe(345);
  });

  it("returns null for names Intl rejects", () => {
    expect(currentOffsetMinutes("Not/AZone", JANUARY)).toBeNull();
  });
});

describe("formatUtcOffset", () => {
  it("renders hours, minutes, and the zero case", () => {
    expect(formatUtcOffset(0)).toBe("UTC±0");
    expect(formatUtcOffset(120)).toBe("UTC+2");
    expect(formatUtcOffset(-240)).toBe("UTC-4");
    expect(formatUtcOffset(330)).toBe("UTC+5:30");
    expect(formatUtcOffset(-570)).toBe("UTC-9:30");
  });
});

describe("timezoneOffsetLabel", () => {
  it("labels a zone by its current offset", () => {
    expect(timezoneOffsetLabel("Europe/Madrid", JANUARY)).toBe("UTC+1");
    expect(timezoneOffsetLabel("Asia/Kolkata", JANUARY)).toBe("UTC+5:30");
    expect(timezoneOffsetLabel("Nope/Nope", JANUARY)).toBeNull();
  });
});

describe("timezonesWithinOffset", () => {
  it("keeps zones inside the window and drops the rest", () => {
    const names = timezonesWithinOffset(0, 180, JANUARY);
    expect(names).toContain("Europe/Madrid"); // +1h in January
    expect(names).toContain("Europe/London"); // ±0 in January
    expect(names).not.toContain("Asia/Tokyo"); // +9h
    expect(names).not.toContain("America/New_York"); // -5h in January
  });

  it("centers on the caller's offset, not UTC", () => {
    const names = timezonesWithinOffset(-300, 60, JANUARY); // EST viewer, ±1h
    expect(names).toContain("America/New_York");
    expect(names).toContain("America/Chicago"); // -6h
    expect(names).not.toContain("Europe/Madrid");
  });

  it("treats the dateline pair as far apart — coarse by design", () => {
    const names = timezonesWithinOffset(13 * 60, 120, JANUARY);
    expect(names).toContain("Pacific/Auckland"); // +13 in January
    expect(names).not.toContain("Pacific/Pago_Pago"); // -11
  });
});
