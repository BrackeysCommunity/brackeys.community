import { describe, expect, it } from "vite-plus/test";

import {
  SHOWCASE_MAX_JAMS,
  SHOWCASE_MAX_LENGTH_DAYS,
  selectShowcaseJams,
  splitByEntries,
} from "@/components/home/JamShowcaseBand";
import type { JamFromList } from "@/components/jams/JamCalendarPage/helpers";

const DAY_MS = 86_400_000;
const START = new Date("2026-08-01T00:00:00Z");

/** Only the fields these helpers read. Defaults to a week-long jam, which
 * is the length the band is for. */
function jam(jamId: number, entriesCount: number | null = 0, lengthDays = 7): JamFromList {
  return {
    jamId,
    entriesCount,
    startsAt: START,
    endsAt: new Date(START.getTime() + lengthDays * DAY_MS),
  } as JamFromList;
}

/** Stand-in for `useTopEntries`' grouped result. */
function entriesFor(...jamIds: number[]) {
  return new Map(jamIds.map((id) => [id, [{}]]));
}

const ids = (jams: JamFromList[]) => jams.map((j) => j.jamId);

describe("selectShowcaseJams", () => {
  it("drops the jam the hero is already promoting", () => {
    const picked = selectShowcaseJams([jam(1), jam(2)], [jam(3)], 1);
    expect(ids(picked)).toEqual([2, 3]);
  });

  it("tops the featured tier up from the upcoming shelf", () => {
    const picked = selectShowcaseJams([jam(1)], [jam(2), jam(3)], null);
    expect(ids(picked)).toEqual([1, 2, 3]);
  });

  it("never repeats a jam that is in both tiers", () => {
    const picked = selectShowcaseJams([jam(1), jam(2)], [jam(2), jam(3)], null);
    expect(ids(picked)).toEqual([1, 2, 3]);
  });

  it("caps the band", () => {
    const many = Array.from({ length: SHOWCASE_MAX_JAMS + 3 }, (_, i) => jam(i + 1));
    expect(selectShowcaseJams(many, [], null)).toHaveLength(SHOWCASE_MAX_JAMS);
  });

  it("preserves the incoming ranking", () => {
    const picked = selectShowcaseJams([jam(3), jam(1)], [jam(2)], null);
    expect(ids(picked)).toEqual([3, 1, 2]);
  });

  it("drops the month-plus jams", () => {
    const long = jam(2, 0, SHOWCASE_MAX_LENGTH_DAYS + 1);
    const atLimit = jam(3, 0, SHOWCASE_MAX_LENGTH_DAYS);
    expect(ids(selectShowcaseJams([jam(1), long, atLimit], [], null))).toEqual([1, 3]);
  });

  it("drops open-ended jams, which are the case the length rule is for", () => {
    const openEnded = { jamId: 2, startsAt: START, endsAt: null } as JamFromList;
    expect(ids(selectShowcaseJams([jam(1), openEnded], [], null))).toEqual([1]);
  });

  it("fills the band past a dropped jam rather than shortening it", () => {
    const enough = Array.from({ length: SHOWCASE_MAX_JAMS }, (_, i) => jam(i + 1));
    const long = jam(99, 0, SHOWCASE_MAX_LENGTH_DAYS + 5);
    // The long jam sits mid-list; the band should still come back full.
    const shuffled = [...enough.slice(0, 2), long, ...enough.slice(2)];
    const picked = selectShowcaseJams(shuffled, [], null);
    expect(picked).toHaveLength(SHOWCASE_MAX_JAMS);
    expect(ids(picked)).not.toContain(99);
  });
});

describe("splitByEntries", () => {
  it("routes jams with submissions to rows and the rest to the grid", () => {
    // 1 and 3 rank higher but have nothing to show; 2 and 4 do.
    const split = splitByEntries([jam(1), jam(2), jam(3), jam(4)], entriesFor(2, 4));
    expect(ids(split.withEntries)).toEqual([2, 4]);
    expect(ids(split.withoutEntries)).toEqual([1, 3]);
  });

  it("keeps the underlying ranking within each bucket", () => {
    const split = splitByEntries([jam(3), jam(1), jam(4), jam(2)], entriesFor(1, 3));
    expect(ids(split.withEntries)).toEqual([3, 1]);
    expect(ids(split.withoutEntries)).toEqual([4, 2]);
  });

  it("puts everything in the grid before the entries request lands", () => {
    const split = splitByEntries([jam(1), jam(2), jam(3)], new Map());
    expect(ids(split.withEntries)).toEqual([]);
    expect(ids(split.withoutEntries)).toEqual([1, 2, 3]);
  });

  it("ignores the jam row's entriesCount, which is 0 until a jam closes", () => {
    // A live jam reports entriesCount 0 on itch while having real
    // scraped submissions — bucketing must follow the fetched entries.
    const live = jam(1, 0);
    const upcoming = jam(2, 0);
    const split = splitByEntries([upcoming, live], entriesFor(1));
    expect(ids(split.withEntries)).toEqual([1]);
    expect(ids(split.withoutEntries)).toEqual([2]);
  });

  it("does not mutate the input", () => {
    const input = [jam(1), jam(2)];
    splitByEntries(input, entriesFor(2));
    expect(ids(input)).toEqual([1, 2]);
  });
});
