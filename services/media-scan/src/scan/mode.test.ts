import { describe, expect, test } from "bun:test";

import { coverCandidates, scanMode } from "./mode.ts";

const A_300 = "https://img.itch.zone/aW1nLzIyOTk1NzIzLnBuZw==/300x240%23c/F8BOL0.png";
const A_315 = "https://img.itch.zone/aW1nLzIyOTk1NzIzLnBuZw==/315x250%23c/OE9oeR.png";
const B_315 = "https://img.itch.zone/aW1nLzk5OTk5OTk5LnBuZw==/315x250%23c/ZZZZZZ.png";

const current = { detectorVersion: 7, model: "siglip2" };
const fresh = {
  detectorVersion: 7,
  coverStatus: "fetched",
  coverUrl: A_300,
  hasEmbedding: true,
  embeddingModel: "siglip2",
};

describe("scanMode", () => {
  test("a never-scanned entry takes the full path", () => {
    expect(scanMode({ gameCoverUrl: A_300 }, null, current)).toBe("full");
  });

  test("a current row whose cover id matches is a revisit", () => {
    expect(scanMode({ gameCoverUrl: A_300 }, fresh, current)).toBe("revisit");
    // The live tier rewrites the URL to the entries.json derivative; same id.
    expect(scanMode({ gameCoverUrl: A_315 }, fresh, current)).toBe("revisit");
  });

  test("anything stale forces the full path", () => {
    expect(scanMode({ gameCoverUrl: A_300 }, { ...fresh, detectorVersion: 6 }, current)).toBe(
      "full",
    );
    expect(scanMode({ gameCoverUrl: A_300 }, { ...fresh, coverStatus: "gone" }, current)).toBe(
      "full",
    );
    expect(scanMode({ gameCoverUrl: A_300 }, { ...fresh, hasEmbedding: false }, current)).toBe(
      "full",
    );
    expect(scanMode({ gameCoverUrl: A_300 }, { ...fresh, embeddingModel: "old" }, current)).toBe(
      "full",
    );
    expect(scanMode({ gameCoverUrl: B_315 }, fresh, current)).toBe("full");
  });
});

describe("coverCandidates", () => {
  test("prefers the live cover when data.json shows a different image", () => {
    expect(coverCandidates(A_300, B_315)).toEqual({
      first: B_315,
      fallback: A_300,
      replaced: true,
    });
  });

  test("fetches the stored derivative first when the image is unchanged, keeping the other as fallback", () => {
    expect(coverCandidates(A_300, A_315)).toEqual({
      first: A_300,
      fallback: A_315,
      replaced: false,
    });
    expect(coverCandidates(A_300, A_300)).toEqual({
      first: A_300,
      fallback: null,
      replaced: false,
    });
  });

  test("an entry with no stored cover adopts whatever data.json has", () => {
    expect(coverCandidates(null, A_315)).toEqual({ first: A_315, fallback: null, replaced: true });
    expect(coverCandidates(null, null)).toEqual({ first: null, fallback: null, replaced: false });
  });
});
