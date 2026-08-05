import { describe, expect, it } from "vite-plus/test";

import router from "@/orpc/router";
import { TOP_ENTRIES_MAX_JAMS, TOP_ENTRIES_MAX_LIMIT, topEntriesQuery } from "@/orpc/router/jam";

describe("jam router surface", () => {
  it("registers the top-entries procedure alongside the existing ones", () => {
    expect(router.listTopEntries).toBeDefined();
    expect(router.listJams).toBeDefined();
    expect(router.archiveJams).toBeDefined();
  });
});

describe("topEntriesQuery", () => {
  const sqlFor = (jamIds: number[], limit: number) =>
    topEntriesQuery(jamIds, limit).toSQL().sql.replace(/\s+/g, " ");

  it("partitions by jam so one busy jam can't crowd out the others", () => {
    expect(sqlFor([1, 2], 4).toLowerCase()).toContain('partition by "itch"."jam_entries"."jam_id"');
  });

  it("ranks by Overall placement first, then participation", () => {
    const sql = sqlFor([1], 4).toLowerCase();
    // Placement wins when it exists…
    expect(sql).toMatch(/order by coalesce\("itch"\."jam_entry_results"\."rank", \$\d+\) asc/);
    // …and unranked entries fall through to ratings, then coolness.
    expect(sql).toContain('"itch"."jam_entries"."rating_count" desc');
    expect(sql).toContain('"itch"."jam_entries"."coolness" desc');
  });

  it("breaks remaining ties on entry id so the covers don't reshuffle", () => {
    expect(sqlFor([1], 4).toLowerCase()).toMatch(/"itch"\."jam_entries"\."entry_id" asc \)/);
  });

  it("joins only the Overall criterion, and keeps it a left join", () => {
    const sql = sqlFor([1], 4).toLowerCase();
    expect(sql).toContain("left join");
    expect(sql).toContain('lower("itch"."jam_entry_results"."criterion") = \'overall\'');
  });

  it("excludes entries itch no longer lists", () => {
    expect(sqlFor([1], 4)).toContain('"itch"."jam_entries"."missing_since" is null');
  });

  it("caps each partition at the requested limit", () => {
    const query = topEntriesQuery([7, 9], 3);
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

describe("listTopEntries input", () => {
  const parse = (input: unknown) =>
    router.listTopEntries["~orpc"].inputSchema!["~standard"].validate(input);

  it("defaults the per-jam limit", async () => {
    const result = await parse({ jamIds: [1] });
    expect("value" in result && (result.value as { limit: number }).limit).toBe(4);
  });

  it("rejects more jams than a single request should carry", async () => {
    const tooMany = Array.from({ length: TOP_ENTRIES_MAX_JAMS + 1 }, (_, i) => i);
    const result = await parse({ jamIds: tooMany });
    expect("issues" in result && result.issues).toBeTruthy();
  });

  it("rejects a per-jam limit beyond the display cap", async () => {
    const result = await parse({ jamIds: [1], limit: TOP_ENTRIES_MAX_LIMIT + 1 });
    expect("issues" in result && result.issues).toBeTruthy();
  });
});
