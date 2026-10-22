import { describe, expect, it } from "vite-plus/test";

import { canvasHeadHeaders, canvasHeadMeta } from "../canvas-head";

const base = {
  id: "c1",
  title: "Level ideas",
  visibility: "public",
  hidden: false,
  deletedAt: null,
  nodeCount: 3,
};

const robots = (head: ReturnType<typeof canvasHeadMeta>) =>
  head.meta.find((m) => "name" in m && m.name === "robots")?.content;
const ogImage = (head: ReturnType<typeof canvasHeadMeta>) =>
  head.meta.find((m) => "property" in m && m.property === "og:image")?.content;

describe("canvasHeadMeta", () => {
  it("indexes a public canvas with its own card and a canonical link", () => {
    const head = canvasHeadMeta(base);
    expect(robots(head)).toBeUndefined();
    expect(ogImage(head)).toMatch(/\/og\/canvas\/c1\.png/);
    expect(head.links.some((l) => l.rel === "canonical" && l.href.endsWith("/canvases/c1"))).toBe(
      true,
    );
  });

  it("previews an unlisted canvas with its card but keeps it out of search", () => {
    const head = canvasHeadMeta({ ...base, visibility: "unlisted" });
    expect(robots(head)).toMatch(/^noindex/);
    expect(ogImage(head)).toMatch(/\/og\/canvas\/c1\.png/);
    expect(canvasHeadHeaders({ ...base, visibility: "unlisted" })).toEqual({
      "X-Robots-Tag": "noindex",
    });
  });

  it("sends no robots header for a public canvas, and noindex for everything else", () => {
    expect(canvasHeadHeaders(base)).toBeUndefined();
    for (const patch of [
      { visibility: "private" },
      { visibility: "team" },
      { hidden: true },
      { deletedAt: new Date() },
      { visibility: "unlisted", hidden: true },
    ]) {
      expect(canvasHeadHeaders({ ...base, ...patch })).toEqual({ "X-Robots-Tag": "noindex" });
    }
    expect(canvasHeadHeaders(null)).toEqual({ "X-Robots-Tag": "noindex" });
  });

  it.each([
    ["private", { visibility: "private" }],
    ["team", { visibility: "team" }],
    ["hidden", { hidden: true }],
    ["deleted", { deletedAt: new Date() }],
    ["hidden unlisted", { visibility: "unlisted", hidden: true }],
  ])("keeps a %s canvas out of search", (_name, patch) => {
    const head = canvasHeadMeta({ ...base, ...patch });
    expect(robots(head)).toBe("noindex");
    expect(ogImage(head)).toBeUndefined();
  });

  it("is noindex without a canvas", () => {
    expect(robots(canvasHeadMeta(null))).toBe("noindex");
  });
});
