// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  readRecentlyOpened,
  readRecentSearches,
  rememberOpened,
  rememberSearch,
} from "@/lib/palette-recents";
import type { SearchHit } from "@/lib/search-hits";

const project = (id: string): SearchHit => ({
  kind: "project",
  id,
  slug: id,
  title: id,
  coverUrl: null,
});

beforeEach(() => window.localStorage.clear());

describe("palette recents", () => {
  it("keeps the newest searches first, without case duplicates", () => {
    rememberSearch("godot");
    rememberSearch("gmtk");
    rememberSearch("Godot");
    expect(readRecentSearches()).toEqual(["Godot", "gmtk"]);
  });

  it("ignores one-letter searches", () => {
    rememberSearch("g");
    expect(readRecentSearches()).toEqual([]);
  });

  it("stores opened hits without their per-answer fields", () => {
    rememberOpened({ ...project("a"), score: 1, href: "/projects/a" } as unknown as SearchHit);
    rememberOpened(project("b"));
    rememberOpened(project("a"));
    const opened = readRecentlyOpened();
    expect(opened.map((h) => h.id)).toEqual(["a", "b"]);
    expect(opened[0]).not.toHaveProperty("score");
  });

  it("survives corrupt storage", () => {
    window.localStorage.setItem("palette:recent-opened", "{not json");
    window.localStorage.setItem("palette:recent-searches", JSON.stringify([1, "ok"]));
    expect(readRecentlyOpened()).toEqual([]);
    expect(readRecentSearches()).toEqual(["ok"]);
  });
});
