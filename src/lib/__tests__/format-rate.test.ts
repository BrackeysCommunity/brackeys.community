import { describe, expect, it } from "vite-plus/test";

import { formatRate } from "../format-rate";

describe("formatRate", () => {
  it("renders an hourly range with the /hr suffix", () => {
    expect(formatRate("hourly", 25, 50)).toBe("$25 - $50 /hr");
  });

  it("renders a fixed range without a suffix", () => {
    expect(formatRate("fixed", 500, 5000)).toBe("$500 - $5K");
  });

  it("abbreviates thousands, keeping one decimal only when needed", () => {
    expect(formatRate("fixed", 1500, 5000)).toBe("$1.5K - $5K");
    expect(formatRate("fixed", 2000, 25000)).toBe("$2K - $25K");
  });

  it("renders an open-ended range with a trailing +", () => {
    expect(formatRate("hourly", 40, null)).toBe("$40+ /hr");
    expect(formatRate("fixed", 900, undefined)).toBe("$900+");
  });

  it("renders rev_share as percentages, not dollars", () => {
    expect(formatRate("rev_share", 10, 30)).toBe("10% - 30%");
    expect(formatRate("rev_share", 15, null)).toBe("15%+");
  });

  it("renders nothing for negotiable by default, so a caller's own badge stands alone", () => {
    expect(formatRate("negotiable", null, null)).toBe("");
  });

  it("renders the caller's label for negotiable when it owns the whole value", () => {
    expect(formatRate("negotiable", null, null, { negotiableLabel: "Negotiable" })).toBe(
      "Negotiable",
    );
  });

  it("renders nothing without a type", () => {
    expect(formatRate(null, 25, 50)).toBe("");
    expect(formatRate(undefined, 25, 50)).toBe("");
  });

  it("renders nothing when the lower bound is missing", () => {
    // A max with no min is not a range anyone can read.
    expect(formatRate("hourly", null, 50)).toBe("");
  });

  it("treats a zero lower bound as a real value, not a missing one", () => {
    expect(formatRate("rev_share", 0, 20)).toBe("0% - 20%");
  });
});

describe("formatRate — millions", () => {
  it("collapses millions rather than printing a four-digit K", () => {
    // Ten million used to render `$10000K`.
    expect(formatRate("fixed", 10_000_000, null)).toBe("$10M+");
    expect(formatRate("fixed", 1_000_000, null)).toBe("$1M+");
    expect(formatRate("fixed", 1_500_000, null)).toBe("$1.5M+");
  });

  it("does not let one input round into both tiers", () => {
    expect(formatRate("fixed", 999_949, null)).toBe("$999.9K+");
    // `999.95K` would render as `$1000.0K`; it is a million instead.
    expect(formatRate("fixed", 999_950, null)).toBe("$1M+");
  });
});

describe("formatRate — reversed pairs", () => {
  // Rows written before `updateProfile` validated the pair.
  it("collapses a reversed range to the higher value", () => {
    expect(formatRate("hourly", 10_000_000, 150_000)).toBe("$10M /hr");
    expect(formatRate("fixed", 500, 100)).toBe("$500");
    expect(formatRate("rev_share", 50, 10)).toBe("50%");
  });

  it("still renders an equal pair as a range", () => {
    expect(formatRate("hourly", 50, 50)).toBe("$50 - $50 /hr");
  });
});
