import { describe, expect, test } from "bun:test";

import { clampEmbed, httpUrl } from "./reply.ts";

describe("httpUrl", () => {
  test("keeps absolute http(s), drops everything else", () => {
    expect(httpUrl("https://cdn.discordapp.com/avatars/1/a.png")).toBe(
      "https://cdn.discordapp.com/avatars/1/a.png",
    );
    expect(httpUrl("http://example.test/x.png")).toBe("http://example.test/x.png");
    // The shape the public API returns for anything uploaded to the site.
    expect(httpUrl("/images/team-avatars/t1/orange.png")).toBeUndefined();
    expect(httpUrl("javascript:alert(1)")).toBeUndefined();
    expect(httpUrl("")).toBeUndefined();
    expect(httpUrl(null)).toBeUndefined();
  });
});

describe("clampEmbed url backstop", () => {
  test("drops malformed urls rather than letting Discord reject the message", () => {
    const out = clampEmbed({
      title: "T",
      url: "/teams/cosy-crew",
      image: "/images/posts/1.png",
      thumbnail: "https://cdn/ok.png",
      author: { name: "A", url: "not a url", iconUrl: "/images/a.png" },
      fields: [],
    });
    expect(out.url).toBeUndefined();
    expect(out.image).toBeUndefined();
    expect(out.thumbnail).toBe("https://cdn/ok.png");
    expect(out.author).toEqual({ name: "A", url: undefined, iconUrl: undefined });
    // The rest of the embed survives — a bad image costs the image, not the reply.
    expect(out.title).toBe("T");
  });
});
