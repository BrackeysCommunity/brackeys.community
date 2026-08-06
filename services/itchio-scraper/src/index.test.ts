import { describe, expect, test } from "bun:test";

import { TIERS } from "./index.ts";

describe("combined entrypoint tier order", () => {
  test("runs live jams before discovery and ranking collection", () => {
    // Inherited from the pre-split `orderedSlugs` contract, and still
    // load-bearing while this shim exists: a live jam's entry list is
    // perishable, a finished jam's rankings are not. Ranking collection must
    // never be able to consume the request budget ahead of jams still taking
    // submissions, so a run cut short by a redeploy drops results rather than
    // entries.
    expect(TIERS.map((t) => t.label)).toEqual(["live", "discovery", "results"]);
  });
});
