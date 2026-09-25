import { describe, expect, it } from "vite-plus/test";

import {
  fuseResults,
  highlightRanges,
  isExactMatch,
  type KindResult,
  type SearchHit,
} from "@/lib/search-hits";
import { hitLinkOptions } from "@/lib/search-links";

const member = (id: string, exact = false) => ({
  kind: "member" as const,
  id,
  stub: id,
  name: id,
  avatarUrl: null,
  tagline: null,
  href: `/profile/${id}`,
  exact,
});

const forum = (id: number) => ({
  kind: "forum" as const,
  id,
  slug: null,
  title: `post ${id}`,
  excerpt: null,
  postKind: "post" as const,
  tags: [],
  href: `/forum/${id}`,
});

describe("fuseResults", () => {
  it("interleaves kinds by rank, not by raw score", () => {
    const results: KindResult[] = [
      { kind: "forum", hits: [forum(1), forum(2), forum(3)] },
      { kind: "member", hits: [member("a"), member("b")] },
    ];
    const order = fuseResults(results).map((h) => `${h.kind}:${h.id}`);
    expect(order).toEqual(["member:a", "forum:1", "member:b", "forum:2", "forum:3"]);
  });

  it("lifts an exact match over every fuzzy one", () => {
    const results: KindResult[] = [
      { kind: "jam", hits: [] },
      { kind: "forum", hits: [forum(1)] },
      { kind: "member", hits: [member("x"), member("exact", true)] },
    ];
    expect(fuseResults(results)[0]).toMatchObject({ kind: "member", id: "exact" });
    expect(fuseResults(results)[0]).not.toHaveProperty("exact");
  });
});

describe("isExactMatch", () => {
  it("ignores case, accents and a leading sigil", () => {
    expect(isExactMatch("@zoe", ["Zoë"])).toBe(true);
    expect(isExactMatch("zoe", ["Zoey"])).toBe(false);
  });
});

describe("highlightRanges", () => {
  it("marks each query word, merged and in order", () => {
    expect(highlightRanges("Zeno's Escape", "escape zeno")).toEqual([
      [0, 4],
      [7, 13],
    ]);
  });

  it("matches through accents", () => {
    expect(highlightRanges("LÖVE Jam", "love")).toEqual([[0, 4]]);
  });

  it("skips single letters", () => {
    expect(highlightRanges("a cat", "a")).toEqual([]);
  });
});

describe("hitLinkOptions", () => {
  const cases: [SearchHit, object][] = [
    [
      {
        kind: "jam",
        id: 7,
        slug: "gmtk-2026",
        title: "GMTK",
        phase: "running",
        startsAt: null,
        endsAt: null,
        votingEndsAt: null,
        bannerUrl: null,
        themeColor: null,
        entriesCount: null,
      },
      { to: "/jams/$jamSlug", params: { jamSlug: "gmtk-2026" } },
    ],
    [
      {
        kind: "entry",
        id: 1,
        gameId: 99,
        jamId: 7,
        title: "G",
        author: null,
        jamTitle: "J",
        coverUrl: null,
        coverColor: null,
      },
      { to: "/projects/game/$gameId", params: { gameId: "99" }, search: { jam: 7 } },
    ],
    [
      { kind: "member", id: "u1", stub: null, name: "U", avatarUrl: null, tagline: null },
      { to: "/profile/$userId", params: { userId: "u1" } },
    ],
    [
      {
        kind: "team",
        id: "t1",
        slug: "crew",
        name: "Crew",
        tagline: null,
        avatarUrl: null,
        recruiting: false,
      },
      { to: "/teams/$teamId", params: { teamId: "crew" } },
    ],
    [
      { kind: "collab", id: 5, title: "C", type: "hobby", status: "recruiting", teamName: null },
      { to: "/collab/$postId", params: { postId: "5" } },
    ],
    [
      {
        kind: "forum",
        id: 3,
        slug: "hello",
        title: "Hello",
        excerpt: null,
        postKind: "post",
        tags: [],
      },
      { to: "/forum/$postId", params: { postId: "3-hello" } },
    ],
    [
      { kind: "project", id: "p1", slug: "moon", title: "Moon", coverUrl: null },
      { to: "/projects/$projectSlug", params: { projectSlug: "moon" } },
    ],
  ];

  it.each(cases)("routes a %s hit", (hit, expected) => {
    expect(hitLinkOptions(hit)).toMatchObject(expected);
  });
});
