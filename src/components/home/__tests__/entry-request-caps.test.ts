import { describe, expect, it } from "vite-plus/test";

import { HERO_SLIDE_MAX } from "@/components/home/hero-jam";
import { SHOWCASE_MAX_JAMS } from "@/components/home/JamShowcaseBand";
import { entryJamIdsFor } from "@/components/home/use-recent-entries";
import { RECENT_ENTRIES_MAX_JAMS } from "@/orpc/router/jam";

const jams = (n: number) => Array.from({ length: n }, (_, i) => ({ jamId: i + 1 }));

/**
 * The landing page's covers are one `listRecentEntries` call, and the
 * caps live in modules that can't import each other — only this test stops
 * a band or rotation bump from 400ing the request.
 */
describe("entry request caps", () => {
  it("leaves the hero rotation its slots under the server's jam cap", () => {
    expect(SHOWCASE_MAX_JAMS + HERO_SLIDE_MAX).toBeLessThanOrEqual(RECENT_ENTRIES_MAX_JAMS);
  });

  it("asks for no more jams than the server accepts, at a full page", () => {
    const heroIds = Array.from({ length: HERO_SLIDE_MAX }, (_, i) => 900 + i);
    const ids = entryJamIdsFor(heroIds, jams(SHOWCASE_MAX_JAMS));
    expect(ids).toHaveLength(SHOWCASE_MAX_JAMS + HERO_SLIDE_MAX);
    expect(ids.length).toBeLessThanOrEqual(RECENT_ENTRIES_MAX_JAMS);
  });
});

describe("entryJamIdsFor", () => {
  it("leads with the rotation, which is what the band leaves out", () => {
    expect(entryJamIdsFor([7, 8], jams(2))).toEqual([7, 8, 1, 2]);
  });

  it("is just the band when the rotation is empty", () => {
    expect(entryJamIdsFor([], jams(2))).toEqual([1, 2]);
  });

  it("is empty when the page has no jams at all, so the query stays disabled", () => {
    expect(entryJamIdsFor([], [])).toEqual([]);
  });
});
