import { describe, expect, it, vi } from "vite-plus/test";

import { buildMeta, jsonLd, listingMeta, ogCardPath, socialImage } from "@/lib/site-meta";

const ORIGIN = "https://brackeys.community";

vi.mock("@/env", () => ({
  env: { VITE_CF_IMAGES: "1" },
  siteOrigin: () => ORIGIN,
  siteUrl: (path: string) =>
    /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") ? path : `${ORIGIN}${path}`,
}));

function tag(
  meta: { name?: string; property?: string; content?: string }[],
  key: string,
): string | undefined {
  return meta.find((entry) => entry.name === key || entry.property === key)?.content;
}

describe("socialImage", () => {
  it("absolutizes an app-relative upload", () => {
    const image = socialImage("/images/abc123.png");
    expect(image.url.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(image.url).not.toMatch(/^\/images/);
  });

  it("re-cuts an itch derivative from its original master at card size", () => {
    const image = socialImage("https://img.itch.zone/aW1n/300x240%23c/mgYrwQ.gif");
    expect(image.url).toContain("/cdn-cgi/image/");
    expect(image.url).toContain("width=1200");
    expect(image.url).toContain("height=630");
    expect(image.url).toContain("fit=cover");
    expect(image.url).toContain("anim=false");
    expect(image.url).toContain("/original/");
    expect(image.width).toBe(1200);
  });

  it("falls back to the site card, dimensions and all", () => {
    const image = socialImage(null);
    expect(image.url).toBe(`${ORIGIN}/og/default.png`);
    expect(image.width).toBe(1200);
    expect(image.height).toBe(630);
    expect(image.type).toBe("image/png");
  });

  it("leaves a foreign absolute URL alone but claims no dimensions for it", () => {
    const image = socialImage("https://cdn.discordapp.com/avatars/1/2.png");
    expect(image.url).toBe("https://cdn.discordapp.com/avatars/1/2.png");
    expect(image.width).toBeUndefined();
  });
});

describe("buildMeta", () => {
  it("builds an absolute canonical and og:url from the page's own path", () => {
    const head = buildMeta({ title: "PROTOCOL 0", path: "/projects/protocol-0" });
    expect(head.links[0]).toEqual({
      rel: "canonical",
      href: `${ORIGIN}/projects/protocol-0`,
    });
    expect(tag(head.meta, "og:url")).toBe(`${ORIGIN}/projects/protocol-0`);
  });

  it("suffixes the site name onto the page title, once", () => {
    const head = buildMeta({ title: "Teams", path: "/teams" });
    expect(head.meta[0]).toEqual({ title: "Teams · Brackeys Community" });
    expect(buildMeta({ path: "/" }).meta[0]).toEqual({ title: "Brackeys Community" });
  });

  it("emits no robots tag by default, follow with noindex, neither with nofollow", () => {
    expect(tag(buildMeta({ path: "/" }).meta, "robots")).toBeUndefined();
    expect(tag(buildMeta({ path: "/collab", noindex: true }).meta, "robots")).toBe(
      "noindex, follow",
    );
    expect(tag(buildMeta({ path: "/game", noindexNofollow: true }).meta, "robots")).toBe(
      "noindex, nofollow",
    );
  });

  it("lets a route append tags that override the defaults", () => {
    const head = buildMeta({
      title: "A post",
      path: "/collab/1",
      type: "article",
      meta: [{ property: "article:published_time", content: "2026-01-01T00:00:00.000Z" }],
    });
    expect(tag(head.meta, "og:type")).toBe("article");
    expect(tag(head.meta, "article:published_time")).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("ogCardPath", () => {
  it("keys a card on the same handle the canonical URL uses", () => {
    expect(ogCardPath("jam", "brackeys-13")).toBe("/og/jam/brackeys-13.png");
    expect(ogCardPath("collab", 42)).toBe("/og/collab/42.png");
  });

  it("escapes a handle that would otherwise change the path", () => {
    expect(ogCardPath("profile", "a/b")).toBe("/og/profile/a%2Fb.png");
  });

  it("wins over a raw image, and carries its own dimensions", () => {
    const head = buildMeta({
      title: "A jam",
      path: "/jams/x",
      card: ogCardPath("jam", "x"),
      image: "https://img.itch.zone/aW1n/300x240/x.png",
    });
    expect(tag(head.meta, "og:image")).toBe(`${ORIGIN}/og/jam/x.png`);
    expect(tag(head.meta, "og:image:width")).toBe("1200");
    expect(tag(head.meta, "og:image:type")).toBe("image/png");
  });
});

describe("listingMeta", () => {
  it("indexes the bare board", () => {
    const head = listingMeta({ title: "Collab board", path: "/collab", search: {} });
    expect(tag(head.meta, "robots")).toBeUndefined();
  });

  it("keeps a filtered permutation out of the index but still crawlable", () => {
    const head = listingMeta({
      title: "Collab board",
      path: "/collab",
      search: { type: "paid", roles: [3] },
    });
    expect(tag(head.meta, "robots")).toBe("noindex, follow");
    expect(head.links[0]?.href).toBe(`${ORIGIN}/collab`);
  });

  it("ignores absent and false-valued search keys", () => {
    const head = listingMeta({
      title: "Teams",
      path: "/teams",
      search: { q: undefined, recruiting: false },
    });
    expect(tag(head.meta, "robots")).toBeUndefined();
  });
});

describe("jsonLd", () => {
  it("escapes an angle bracket so a value cannot close the script element", () => {
    const [script] = jsonLd({ "@type": "Person", name: "</script><img onerror=x>" });
    expect(script?.type).toBe("application/ld+json");
    expect(script?.children).not.toContain("<");
    expect(JSON.parse(script!.children)).toMatchObject({ name: "</script><img onerror=x>" });
  });

  it("collapses a single node and keeps an array as a graph", () => {
    expect(JSON.parse(jsonLd({ a: 1 })[0]!.children)).toEqual({ a: 1 });
    expect(JSON.parse(jsonLd([{ a: 1 }, { b: 2 }])[0]!.children)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(jsonLd([])).toEqual([]);
  });
});
