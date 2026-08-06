import { describe, expect, it } from "vite-plus/test";

import {
  type JamFromList,
  jamStats,
  lifecycleProgress,
  lifecyclePoints,
  nextMilestone,
} from "@/components/jams/JamCalendarPage/helpers";

/** Only the fields these helpers read. */
function jam(fields: Partial<JamFromList>): JamFromList {
  return {
    startsAt: null,
    endsAt: null,
    votingEndsAt: null,
    joinedCount: null,
    entriesCount: null,
    ratingsCount: null,
    ...fields,
  } as JamFromList;
}

const START = new Date("2026-03-01T00:00:00Z");
const DEADLINE = new Date("2026-03-08T00:00:00Z");
const VOTING_END = new Date("2026-03-22T00:00:00Z");

const full = jam({ startsAt: START, endsAt: DEADLINE, votingEndsAt: VOTING_END });

describe("lifecyclePoints", () => {
  it("names the three events of a jam with a voting window", () => {
    expect(lifecyclePoints(full)).toEqual([
      { kind: "starting", date: START, label: "STARTS" },
      { kind: "deadline", date: DEADLINE, label: "SUBMISSIONS CLOSE" },
      { kind: "ending", date: VOTING_END, label: "VOTING ENDS" },
    ]);
  });

  it("treats the end date as a full close when there is no voting window", () => {
    // Styled like a voting end (red ■), not a submission deadline (yellow ⊙).
    expect(lifecyclePoints(jam({ startsAt: START, endsAt: DEADLINE }))).toEqual([
      { kind: "starting", date: START, label: "STARTS" },
      { kind: "ending", date: DEADLINE, label: "ENDS" },
    ]);
  });

  it("skips events the scrape doesn't have a date for", () => {
    expect(lifecyclePoints(jam({ endsAt: DEADLINE })).map((p) => p.label)).toEqual(["ENDS"]);
    expect(lifecyclePoints(jam({}))).toEqual([]);
  });

  it("accepts ISO strings, since RPC payloads carry dates as strings", () => {
    const points = lifecyclePoints(jam({ startsAt: START.toISOString() as never }));
    expect(points[0]?.date.getTime()).toBe(START.getTime());
  });
});

describe("nextMilestone", () => {
  it("is the start before the jam opens", () => {
    expect(nextMilestone(full, new Date("2026-02-20T00:00:00Z"))?.label).toBe("STARTS");
  });

  it("is the submission deadline while the jam runs", () => {
    expect(nextMilestone(full, new Date("2026-03-04T00:00:00Z"))?.label).toBe("SUBMISSIONS CLOSE");
  });

  it("is the voting end during voting", () => {
    expect(nextMilestone(full, new Date("2026-03-12T00:00:00Z"))?.label).toBe("VOTING ENDS");
  });

  it("is null once every event is in the past", () => {
    expect(nextMilestone(full, new Date("2026-04-01T00:00:00Z"))).toBeNull();
  });

  it("treats an event happening exactly now as past", () => {
    // A deadline that has just struck is no longer upcoming.
    expect(nextMilestone(full, DEADLINE)?.label).toBe("VOTING ENDS");
  });

  it("agrees with lifecyclePoints — it is a lookup into that list", () => {
    for (const now of [
      new Date("2026-02-01T00:00:00Z"),
      START,
      new Date("2026-03-05T00:00:00Z"),
      DEADLINE,
      new Date("2026-03-15T00:00:00Z"),
      VOTING_END,
    ]) {
      const expected = lifecyclePoints(full).find((p) => p.date.getTime() > now.getTime()) ?? null;
      expect(nextMilestone(full, now)).toEqual(expected);
    }
  });
});

describe("lifecycleProgress", () => {
  it("is null when the jam doesn't span two known dates", () => {
    expect(lifecycleProgress(jam({ startsAt: START }), START)).toBeNull();
    expect(lifecycleProgress(jam({}), START)).toBeNull();
  });

  it("is null for a zero-or-negative window", () => {
    // Scraped dates are occasionally nonsense; a divide-by-zero track isn't
    // something to render.
    expect(lifecycleProgress(jam({ startsAt: DEADLINE, endsAt: START }), START)).toBeNull();
  });

  it("measures the whole start → last-event window, not just submissions", () => {
    // Halfway between Mar 1 and Mar 22 is Mar 11.5.
    const progress = lifecycleProgress(full, new Date("2026-03-11T12:00:00Z"));
    expect(progress?.fill).toBeCloseTo(0.5, 5);
  });

  it("clamps outside the window", () => {
    expect(lifecycleProgress(full, new Date("2020-01-01T00:00:00Z"))?.fill).toBe(0);
    expect(lifecycleProgress(full, new Date("2030-01-01T00:00:00Z"))?.fill).toBe(1);
  });

  it("places the deadline tick only when voting is a separate window", () => {
    // Mar 8 is 7 of 21 days into the window.
    expect(lifecycleProgress(full, START)?.deadlinePct).toBeCloseTo((7 / 21) * 100, 5);
    // Without a voting window the deadline IS the right edge — no tick.
    expect(
      lifecycleProgress(jam({ startsAt: START, endsAt: DEADLINE }), START)?.deadlinePct,
    ).toBeNull();
  });
});

describe("jamStats", () => {
  it("lists every number we hold, in reading order", () => {
    expect(jamStats(jam({ joinedCount: 12, entriesCount: 8, ratingsCount: 40 }))).toEqual([
      { label: "JOINED", value: 12 },
      { label: "ENTRIES", value: 8 },
      { label: "RATINGS", value: 40 },
    ]);
  });

  it("treats a zero as absent — 'ENTRIES 0' on an upcoming jam says nothing", () => {
    expect(jamStats(jam({ joinedCount: 300, entriesCount: 0 }))).toEqual([
      { label: "JOINED", value: 300 },
    ]);
  });

  it("returns nothing for a jam we have no counts for", () => {
    expect(jamStats(jam({}))).toEqual([]);
  });
});
