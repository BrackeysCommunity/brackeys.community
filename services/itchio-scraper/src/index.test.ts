import { describe, expect, test } from "bun:test";

import { type SlugBuckets, orderedSlugs } from "./index.ts";

const buckets = (overrides: Partial<SlugBuckets> = {}): SlugBuckets => ({
  stateResync: [],
  upcoming: [],
  inProgress: [],
  brackeysBackfill: [],
  endedBackfill: [],
  pendingResults: [],
  ...overrides,
});

describe("orderedSlugs", () => {
  test("syncs live jams before the ratings drain", () => {
    // The whole point of the ordering: a live jam's entry list is perishable,
    // a finished jam's rankings are not. Ranking collection must never be able
    // to consume the request budget ahead of jams still taking submissions.
    expect(
      orderedSlugs(
        buckets({
          pendingResults: ["finished-jam"],
          stateResync: ["jam-in-voting"],
          upcoming: ["announced-jam"],
          inProgress: ["jam-taking-entries"],
        }),
      ),
    ).toEqual(["jam-in-voting", "announced-jam", "jam-taking-entries", "finished-jam"]);
  });

  test("puts both backfills ahead of the drain", () => {
    expect(
      orderedSlugs(
        buckets({
          pendingResults: ["finished-jam"],
          brackeysBackfill: ["brackeys-1"],
          endedBackfill: ["just-ended"],
        }),
      ),
    ).toEqual(["brackeys-1", "just-ended", "finished-jam"]);
  });

  test("dedupes a slug to its earliest bucket", () => {
    // Overlap is normal — a persisted in-voting jam also shows up in
    // /jams/in-progress discovery. It must sync once, at the earlier position.
    const slugs = orderedSlugs(
      buckets({ stateResync: ["overlapping-jam"], inProgress: ["overlapping-jam"] }),
    );
    expect(slugs).toEqual(["overlapping-jam"]);
  });

  test("a jam in both the drain and a live bucket syncs at the live position", () => {
    // Guards the dedupe direction, not just the dedupe. Ordering pendingResults
    // first would put the shared slug last — behind discovery — and the jam
    // would get its entries refreshed only after everything else had run.
    expect(
      orderedSlugs(
        buckets({
          stateResync: ["shared-jam"],
          upcoming: ["announced-jam"],
          pendingResults: ["shared-jam", "finished-jam"],
        }),
      ),
    ).toEqual(["shared-jam", "announced-jam", "finished-jam"]);
  });

  test("returns nothing when every bucket is empty", () => {
    expect(orderedSlugs(buckets())).toEqual([]);
  });
});
