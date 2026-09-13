import { describe, expect, it } from "vite-plus/test";

import {
  archiveFilterKinds,
  boardFilterKinds,
  calendarFilterKinds,
  jamListReport,
  type JamListReportInput,
} from "../jam-list-report";
import { DEFAULT_ARCHIVE_STATE } from "../use-jam-data";

const TODAY = new Date(Date.UTC(2026, 8, 13));

function input(overrides: Partial<JamListReportInput> = {}): JamListReportInput {
  return {
    view: "board",
    search: "",
    boardSort: "signal",
    monthStart: new Date(Date.UTC(2026, 8, 1)),
    today: TODAY,
    archiveState: DEFAULT_ARCHIVE_STATE,
    board: { isLoading: false, jams: [] },
    calendar: { isLoading: false, jams: [] },
    archive: { isLoading: false, total: 0 },
    ...overrides,
  };
}

describe("filter kinds", () => {
  it("counts a non-default board sort and ignores the default", () => {
    expect(boardFilterKinds("signal")).toEqual([]);
    expect(boardFilterKinds("soonest")).toEqual(["sort"]);
  });

  it("counts the calendar's month only once it has moved off the current one", () => {
    expect(calendarFilterKinds(new Date(Date.UTC(2026, 8, 1)), TODAY)).toEqual([]);
    expect(calendarFilterKinds(new Date(Date.UTC(2026, 9, 1)), TODAY)).toEqual(["month"]);
  });

  it("counts the archive's sort key, its direction and its page separately", () => {
    expect(archiveFilterKinds(DEFAULT_ARCHIVE_STATE)).toEqual([]);
    expect(archiveFilterKinds({ ...DEFAULT_ARCHIVE_STATE, sortBy: "entries" })).toEqual(["sort"]);
    expect(archiveFilterKinds({ ...DEFAULT_ARCHIVE_STATE, sortDir: "asc" })).toEqual(["sort"]);
    expect(archiveFilterKinds({ ...DEFAULT_ARCHIVE_STATE, page: 2 })).toEqual(["page"]);
    expect(archiveFilterKinds({ ...DEFAULT_ARCHIVE_STATE, sortBy: "title", page: 1 })).toEqual([
      "sort",
      "page",
    ]);
  });
});

describe("jamListReport", () => {
  it("reports the active view's own surface", () => {
    expect(jamListReport(input({ view: "board" })).surface).toBe("jams_board");
    expect(jamListReport(input({ view: "calendar" })).surface).toBe("jams_calendar");
    expect(jamListReport(input({ view: "archive" })).surface).toBe("jams_archive");
  });

  it("counts the rows the board and calendar actually hold", () => {
    expect(
      jamListReport(input({ view: "board", board: { isLoading: false, jams: [1, 2, 3] } }))
        .resultCount,
    ).toBe(3);
    expect(
      jamListReport(input({ view: "calendar", calendar: { isLoading: false, jams: [1, 2] } }))
        .resultCount,
    ).toBe(2);
  });

  it("counts the archive's server total, not the page it is showing", () => {
    const report = jamListReport(
      input({ view: "archive", archive: { isLoading: false, total: 812 } }),
    );
    expect(report.resultCount).toBe(812);
  });

  it("holds the count back while the active view is loading", () => {
    expect(
      jamListReport(input({ view: "board", board: { isLoading: true, jams: [] } })).resultCount,
    ).toBeNull();
    expect(
      jamListReport(input({ view: "archive", archive: { isLoading: true, total: 0 } })).resultCount,
    ).toBeNull();
  });

  it("ignores a loading view that is not the one on screen", () => {
    // The calendar and archive queries are lazy, so both sit at
    // `isLoading` until their view mounts — the board must not wait on them.
    const report = jamListReport(
      input({
        view: "board",
        board: { isLoading: false, jams: [1] },
        calendar: { isLoading: true, jams: [] },
        archive: { isLoading: true, total: 0 },
      }),
    );
    expect(report.resultCount).toBe(1);
  });

  it("carries the shared search onto whichever surface is up", () => {
    expect(jamListReport(input({ view: "archive", search: "ludum" })).query).toBe("ludum");
  });

  it("reads an untouched arrival as nothing to report", () => {
    // Not the hook's rule repeated — this is what the hook checks to decide
    // an arrival is browsing rather than narrowing.
    const report = jamListReport(input());
    expect(report.query).toBe("");
    expect(report.filterKinds).toEqual([]);
  });
});
