import { describe, expect, it } from "vite-plus/test";

import { hostName, jamLinkParams, jamMonthDay, jamSlug, jamUrl } from "../jam-links";

/** The short month label the UTC calendar puts a date in, independent of
 * the runner's timezone. */
function utcShortMonth(d: Date): string {
  return d.toLocaleString(undefined, { month: "short", timeZone: "UTC" }).toUpperCase();
}

describe("jamUrl", () => {
  it("builds the itch.io jam permalink", () => {
    expect(jamUrl("brackeys-13")).toBe("https://itch.io/jam/brackeys-13");
  });
});

describe("jamSlug", () => {
  it("prefers the scraped slug", () => {
    expect(jamSlug({ jamId: 402922, slug: "brackeys-15" })).toBe("brackeys-15");
  });

  it("falls back to the numeric id when a caller holds no slug", () => {
    // e.g. a jam reached through a LEFT JOIN that didn't select it.
    expect(jamSlug({ jamId: 402922, slug: null })).toBe("402922");
    expect(jamSlug({ jamId: 402922 })).toBe("402922");
  });

  it("treats an empty slug as absent", () => {
    expect(jamSlug({ jamId: 7, slug: "" })).toBe("7");
  });

  it("builds the route params object the router expects", () => {
    expect(jamLinkParams({ jamId: 7, slug: "tiny-jam" })).toEqual({ jamSlug: "tiny-jam" });
  });
});

describe("hostName", () => {
  it("returns the lead host", () => {
    expect(hostName({ hosts: [{ name: "Brackeys" }, { name: "Someone" }] })).toBe("Brackeys");
  });

  it("falls back to COMMUNITY when a scraped jam has no host", () => {
    expect(hostName({ hosts: [] })).toBe("COMMUNITY");
  });

  it("honors a caller-supplied fallback voice", () => {
    // The archive table renders an em dash in its host column.
    expect(hostName({ hosts: [] }, "—")).toBe("—");
  });
});

describe("jamMonthDay", () => {
  it("returns a TBA placeholder pair when the date is missing", () => {
    expect(jamMonthDay(null)).toEqual({ month: "TBA", day: "—" });
  });

  it("returns the placeholder pair for unparseable strings", () => {
    expect(jamMonthDay("not-a-date")).toEqual({ month: "TBA", day: "—" });
  });

  it("accepts ISO strings", () => {
    const d = new Date("2026-04-24T09:00:00Z");
    expect(jamMonthDay(d.toISOString())).toEqual({ month: utcShortMonth(d), day: "24" });
  });

  it("uppercases the month label", () => {
    expect(jamMonthDay(new Date("2026-04-24T09:00:00Z")).month).toMatch(/^[A-Z]+$/);
  });

  it("pairs the month label with the day number in the same (UTC) calendar", () => {
    // Regression: the month came from a *local* toLocaleString while the
    // day came from getUTCDate(). West of UTC this date is still Apr 30
    // locally, so the block rendered "APR" above the day "1".
    const d = new Date("2026-05-01T02:00:00Z");
    expect(jamMonthDay(d)).toEqual({ month: utcShortMonth(d), day: "1" });
  });

  it("holds at the other boundary too (east-of-UTC end of month)", () => {
    // 2026-04-30T22:00Z is already May 1 in e.g. Europe/Berlin.
    const d = new Date("2026-04-30T22:00:00Z");
    expect(jamMonthDay(d)).toEqual({ month: utcShortMonth(d), day: "30" });
  });
});
