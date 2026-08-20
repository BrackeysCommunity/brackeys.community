import { describe, expect, test } from "vitest";

import { normalizeItchProfileUrl, parseJamSubmissionSlugs } from "@/lib/itch-urls";

describe("normalizeItchProfileUrl", () => {
  test("lowercases and strips trailing slashes", () => {
    expect(normalizeItchProfileUrl("https://OliverBooth.itch.io/")).toBe(
      "https://oliverbooth.itch.io",
    );
  });

  test("treats blank input as absent", () => {
    expect(normalizeItchProfileUrl("  ")).toBeNull();
    expect(normalizeItchProfileUrl(null)).toBeNull();
  });
});

describe("parseJamSubmissionSlugs", () => {
  // Verbatim shape of the action button on a game page.
  const page = (id: number, slug: string) =>
    `<li class="jam_entry"><a href="https://itch.io/jam/${slug}/rate/${id}" class="action_btn">` +
    `<svg></svg>Submission to Candy Jam</a></li>`;

  test("reads the jam the game was submitted to", () => {
    expect(parseJamSubmissionSlugs(page(1287, "candyjam"), 1287)).toEqual(["candyjam"]);
  });

  test("collects every jam a game entered, without duplicates", () => {
    const html = page(42, "one-jam") + page(42, "other-jam") + page(42, "one-jam");
    expect(parseJamSubmissionSlugs(html, 42).sort()).toEqual(["one-jam", "other-jam"]);
  });

  test("ignores rate links for other games", () => {
    // Devlogs and comment bodies link to other people's submissions; only the
    // page's own game id proves this page is the entry.
    expect(parseJamSubmissionSlugs(page(999, "someone-elses-jam"), 42)).toEqual([]);
  });

  test("returns nothing for a game that entered no jam", () => {
    expect(parseJamSubmissionSlugs("<html><body>just a game</body></html>", 42)).toEqual([]);
  });
});
