import { describe, expect, it } from "vite-plus/test";

import { SHOWCASE_MAX_JAMS } from "@/components/home/JamShowcaseBand";
import { entryJamIdsFor } from "@/components/home/use-recent-entries";
import { RECENT_ENTRIES_MAX_JAMS } from "@/orpc/router/jam";

const jams = (n: number) => Array.from({ length: n }, (_, i) => ({ jamId: i + 1 }));

/**
 * The landing page's covers are one `listRecentEntries` call, and the two
 * caps live in modules that can't import each other — only this test stops
 * a band bump from 400ing the request.
 */
describe("entry request caps", () => {
  it("leaves the hero a slot under the server's jam cap", () => {
    expect(SHOWCASE_MAX_JAMS + 1).toBeLessThanOrEqual(RECENT_ENTRIES_MAX_JAMS);
  });

  it("asks for no more jams than the server accepts, at a full band", () => {
    const ids = entryJamIdsFor(999, jams(SHOWCASE_MAX_JAMS));
    expect(ids).toHaveLength(SHOWCASE_MAX_JAMS + 1);
    expect(ids.length).toBeLessThanOrEqual(RECENT_ENTRIES_MAX_JAMS);
  });
});

describe("entryJamIdsFor", () => {
  it("leads with the hero, which is the jam the band leaves out", () => {
    expect(entryJamIdsFor(7, jams(2))).toEqual([7, 1, 2]);
  });

  it("omits the hero when there is none rather than passing a null through", () => {
    expect(entryJamIdsFor(null, jams(2))).toEqual([1, 2]);
  });

  it("is empty when the page has no jams at all, so the query stays disabled", () => {
    expect(entryJamIdsFor(null, [])).toEqual([]);
  });
});
