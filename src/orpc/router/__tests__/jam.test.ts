import { describe, expect, it } from "vite-plus/test";

import router from "@/orpc/router";
import {
  monthWindowRange,
  RECENT_ENTRIES_MAX_JAMS,
  RECENT_ENTRIES_MAX_LIMIT,
  recentEntriesQuery,
} from "@/orpc/router/jam";

describe("jam router surface", () => {
  it("registers the recent-entries procedure alongside the existing ones", () => {
    expect(router.listRecentEntries).toBeDefined();
    expect(router.listJams).toBeDefined();
    expect(router.archiveJams).toBeDefined();
  });
});

describe("monthWindowRange", () => {
  const iso = (month: string) => {
    const { start, end } = monthWindowRange(month);
    return [start.toISOString(), end.toISOString()];
  };

  it("covers the asked-for month and one either side", () => {
    expect(iso("2026-06")).toEqual(["2026-05-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"]);
  });

  it("rolls back across the year for January", () => {
    expect(iso("2026-01")).toEqual(["2025-12-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]);
  });

  it("rolls forward across the year for December", () => {
    expect(iso("2026-12")).toEqual(["2026-11-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z"]);
  });

  // The grid drawn for a month runs from the Sunday on or before the 1st to
  // the Saturday on or after the last day — at most six days into the
  // previous month and twelve into the next. The window has to contain it,
  // or a bar would be missing from a visible cell.
  it("contains the whole six-week grid the month is drawn on", () => {
    for (const month of ["2026-01", "2026-02", "2026-08", "2026-12"]) {
      const [year, monthNumber] = month.split("-").map(Number) as [number, number];
      const first = new Date(Date.UTC(year, monthNumber - 1, 1));
      const gridStart = new Date(first);
      gridStart.setUTCDate(1 - first.getUTCDay());
      const gridEnd = new Date(gridStart);
      gridEnd.setUTCDate(gridStart.getUTCDate() + 42);

      const { start, end } = monthWindowRange(month);
      expect(start.getTime()).toBeLessThanOrEqual(gridStart.getTime());
      expect(end.getTime()).toBeGreaterThanOrEqual(gridEnd.getTime());
    }
  });
});

describe("recentEntriesQuery", () => {
  const sqlFor = (jamIds: number[], limit: number) =>
    recentEntriesQuery(jamIds, limit).toSQL().sql.replace(/\s+/g, " ");

  it("partitions by jam so one busy jam can't crowd out the others", () => {
    expect(sqlFor([1, 2], 4).toLowerCase()).toContain('partition by "itch"."jam_entries"."jam_id"');
  });

  it("leads with rating count only inside a jam's voting window", () => {
    expect(sqlFor([1], 4).toLowerCase()).toContain(
      'order by case when "itch"."jams"."ends_at" <= now() and "itch"."jams"."voting_ends_at" > now() ' +
        'then "itch"."jam_entries"."rating_count" end desc nulls last',
    );
  });

  it("orders newest submission first, entries without a timestamp last", () => {
    expect(sqlFor([1], 4).toLowerCase()).toContain(
      '"itch"."jam_entries"."submitted_at" desc nulls last',
    );
  });

  it("breaks submitted_at ties on entry id, newest id first", () => {
    expect(sqlFor([1], 4).toLowerCase()).toMatch(/"itch"\."jam_entries"\."entry_id" desc \)/);
  });

  it("still joins the Overall placement for the rank chip, as a left join", () => {
    const sql = sqlFor([1], 4).toLowerCase();
    expect(sql).toContain("left join");
    expect(sql).toContain('lower("itch"."jam_entry_results"."criterion") = \'overall\'');
  });

  it("excludes entries itch no longer lists", () => {
    expect(sqlFor([1], 4)).toContain('"itch"."jam_entries"."missing_since" is null');
  });

  it("caps each partition at the requested limit", () => {
    const query = recentEntriesQuery([7, 9], 3);
    const { sql, params } = query.toSQL();
    expect(sql.replace(/\s+/g, " ")).toMatch(/where "ranked"\."row_number" <= \$\d+/i);
    expect(params).toContain(3);
    expect(params).toContain(7);
    expect(params).toContain(9);
  });

  it("orders the flattened result by jam, then by within-jam position", () => {
    expect(sqlFor([1, 2], 4)).toMatch(
      /order by "ranked"\."jam_id" asc, "ranked"\."row_number" asc/i,
    );
  });
});

describe("listRecentEntries input", () => {
  const parse = (input: unknown) =>
    router.listRecentEntries["~orpc"].inputSchema!["~standard"].validate(input);

  it("defaults the per-jam limit", async () => {
    const result = await parse({ jamIds: [1] });
    expect("value" in result && (result.value as { limit: number }).limit).toBe(4);
  });

  it("rejects more jams than a single request should carry", async () => {
    const tooMany = Array.from({ length: RECENT_ENTRIES_MAX_JAMS + 1 }, (_, i) => i);
    const result = await parse({ jamIds: tooMany });
    expect("issues" in result && result.issues).toBeTruthy();
  });

  it("rejects a per-jam limit beyond the display cap", async () => {
    const result = await parse({ jamIds: [1], limit: RECENT_ENTRIES_MAX_LIMIT + 1 });
    expect("issues" in result && result.issues).toBeTruthy();
  });
});
