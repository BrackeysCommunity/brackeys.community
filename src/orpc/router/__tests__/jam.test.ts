import { describe, expect, it } from "vite-plus/test";

import router from "@/orpc/router";
import {
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

describe("recentEntriesQuery", () => {
  const sqlFor = (jamIds: number[], limit: number) =>
    recentEntriesQuery(jamIds, limit).toSQL().sql.replace(/\s+/g, " ");

  it("partitions by jam so one busy jam can't crowd out the others", () => {
    expect(sqlFor([1, 2], 4).toLowerCase()).toContain('partition by "itch"."jam_entries"."jam_id"');
  });

  it("orders newest submission first, entries without a timestamp last", () => {
    expect(sqlFor([1], 4).toLowerCase()).toContain(
      'order by "itch"."jam_entries"."submitted_at" desc nulls last',
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
