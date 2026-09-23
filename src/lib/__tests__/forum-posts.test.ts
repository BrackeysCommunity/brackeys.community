import { describe, expect, it } from "vite-plus/test";

import {
  forumPostParam,
  forumPostSlug,
  forumPostTitle,
  normalizeTagSlug,
  parseForumPostParam,
} from "@/lib/forum-posts";

describe("forum post URLs", () => {
  it("slugs a title and leaves untitled posts on the bare id", () => {
    expect(forumPostSlug("Road to Demo: Entry #7!")).toBe("road-to-demo-entry-7");
    expect(forumPostSlug(null)).toBe("");
    expect(forumPostParam({ id: 12, slug: "road-to-demo" })).toBe("12-road-to-demo");
    expect(forumPostParam({ id: 12, slug: "" })).toBe("12");
  });

  it("reads the id off either URL form and rejects anything else", () => {
    expect(parseForumPostParam("1234")).toBe(1234);
    expect(parseForumPostParam("1234-some-slug")).toBe(1234);
    expect(parseForumPostParam("some-slug")).toBeNull();
    expect(parseForumPostParam("12abc")).toBeNull();
    expect(parseForumPostParam("0")).toBeNull();
  });
});

describe("forumPostTitle", () => {
  it("falls back to a clipped excerpt for untitled posts", () => {
    expect(forumPostTitle({ title: "Devlog 3", excerpt: "x" })).toBe("Devlog 3");
    expect(forumPostTitle({ title: null, excerpt: null })).toBe("a post");
    const long = "a".repeat(80);
    expect(forumPostTitle({ title: null, excerpt: long })).toHaveLength(58);
  });
});

describe("normalizeTagSlug", () => {
  it("turns free text into the slug the CHECK accepts", () => {
    expect(normalizeTagSlug("#Pixel Art")).toBe("pixel-art");
    expect(normalizeTagSlug("Godot")).toBe("godot");
    expect(normalizeTagSlug("é")).toBeNull();
    expect(normalizeTagSlug("#")).toBeNull();
  });
});
