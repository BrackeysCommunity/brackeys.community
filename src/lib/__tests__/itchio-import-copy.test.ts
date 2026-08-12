import { describe, expect, it } from "vite-plus/test";

import { describeLinkImport, describeResyncImport } from "../itchio-import-copy";

describe("describeLinkImport()", () => {
  it("counts a clean import", () => {
    expect(describeLinkImport({ imported: 12, total: 12, drafts: 0 })).toBe(
      "Imported 12 games from itch.io",
    );
    expect(describeLinkImport({ imported: 1, total: 1, drafts: 0 })).toBe(
      "Imported 1 game from itch.io",
    );
  });

  it("names the drafts so the count matches what appears", () => {
    expect(describeLinkImport({ imported: 12, total: 12, drafts: 3 })).toBe(
      "Imported 12 games from itch.io — 3 are drafts and stay hidden until published on itch.io",
    );
    expect(describeLinkImport({ imported: 2, total: 2, drafts: 1 })).toBe(
      "Imported 2 games from itch.io — 1 is a draft and stays hidden until published on itch.io",
    );
  });

  it("celebrates an empty library instead of reading as an error", () => {
    expect(describeLinkImport({ imported: 0, total: 0, drafts: 0 })).toBe(
      "Linked! No games found on this itch.io account yet",
    );
  });

  it("treats a re-link with nothing new as success, not 'Imported 0'", () => {
    expect(describeLinkImport({ imported: 0, total: 5, drafts: 0 })).toBe(
      "Linked! Your itch.io library is already imported",
    );
  });
});

describe("describeResyncImport()", () => {
  it("counts only new games", () => {
    expect(describeResyncImport({ imported: 2, total: 7, drafts: 0 })).toBe(
      "Imported 2 new games from itch.io",
    );
  });

  it("says up-to-date when nothing changed, still naming drafts", () => {
    expect(describeResyncImport({ imported: 0, total: 7, drafts: 0 })).toBe(
      "itch.io library is up to date",
    );
    expect(describeResyncImport({ imported: 0, total: 7, drafts: 2 })).toBe(
      "itch.io library is up to date — 2 are drafts and stay hidden until published on itch.io",
    );
  });

  it("handles the empty library", () => {
    expect(describeResyncImport({ imported: 0, total: 0, drafts: 0 })).toBe(
      "No games found on this itch.io account yet",
    );
  });
});
