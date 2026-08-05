import { describe, expect, it } from "vite-plus/test";

import { entrySortLabel } from "@/components/home/JamShowcaseRow";
import type { TopEntry } from "@/components/home/use-top-entries";

/** Only the two fields the label reads. */
function entry(ratingCount: number, rank: number | null = null): TopEntry {
  return { ratingCount, rank } as TopEntry;
}

describe("entrySortLabel", () => {
  it("credits placement once results are published", () => {
    expect(entrySortLabel([entry(12, 1), entry(9, 2)])).toBe("BY PLACEMENT");
  });

  it("falls back to ratings while a jam is in voting", () => {
    expect(entrySortLabel([entry(54), entry(31), entry(0)])).toBe("BY RATINGS");
  });

  it("claims nothing when no entry has been rated yet", () => {
    // Submissions are open, so every entry ties at zero ratings and the
    // strip is really in submission order — there is no ranking to name.
    expect(entrySortLabel([entry(0), entry(0), entry(0)])).toBeNull();
  });

  it("claims nothing for an empty strip", () => {
    expect(entrySortLabel([])).toBeNull();
  });

  it("prefers placement even when only some entries placed", () => {
    // A jam can publish results with too-few-ratings entries left unranked;
    // the strip is still ordered by the placements that exist.
    expect(entrySortLabel([entry(20, 3), entry(0)])).toBe("BY PLACEMENT");
  });

  it("names ratings when a single entry has any", () => {
    expect(entrySortLabel([entry(0), entry(1)])).toBe("BY RATINGS");
  });
});
