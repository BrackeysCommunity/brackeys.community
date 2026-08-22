import { describe, expect, it } from "vite-plus/test";

import { classifyClassName, isAllowedEmbedSrc, isVideoEmbed } from "../rich-html";

describe("isAllowedEmbedSrc", () => {
  it("allows the embeds jam bodies actually use", () => {
    expect(isAllowedEmbedSrc("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
    expect(isAllowedEmbedSrc("https://www.youtube-nocookie.com/embed/x")).toBe(true);
    expect(isAllowedEmbedSrc("https://discord.com/widget?id=1234")).toBe(true);
    expect(isAllowedEmbedSrc("https://player.vimeo.com/video/1")).toBe(true);
    expect(isAllowedEmbedSrc("https://itch.io/embed/12345")).toBe(true);
  });

  it("allows subdomains of the suffixed hosts only", () => {
    expect(isAllowedEmbedSrc("https://html-classic.itch.zone/html/1/index.html")).toBe(true);
    expect(isAllowedEmbedSrc("https://artist.bandcamp.com/EmbeddedPlayer/album=1")).toBe(true);
    // The suffix must be a label boundary, not a substring of the host.
    expect(isAllowedEmbedSrc("https://evilitch.io/x")).toBe(false);
    expect(isAllowedEmbedSrc("https://itch.io.evil.example/x")).toBe(false);
  });

  it("rejects everything else", () => {
    expect(isAllowedEmbedSrc("https://docs.google.com/forms/d/e/1/viewform")).toBe(false);
    expect(isAllowedEmbedSrc("https://random-jam-site.example/rules")).toBe(false);
    expect(isAllowedEmbedSrc(null)).toBe(false);
    expect(isAllowedEmbedSrc("")).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(isAllowedEmbedSrc("javascript:alert(1)")).toBe(false);
    expect(isAllowedEmbedSrc("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects a relative src rather than resolving it against our own origin", () => {
    // Resolving would frame our page inside our page.
    expect(isAllowedEmbedSrc("/jams/gbjam-14")).toBe(false);
    expect(isAllowedEmbedSrc("embed.html")).toBe(false);
  });

  it("accepts a protocol-relative src", () => {
    expect(isAllowedEmbedSrc("//www.youtube.com/embed/x")).toBe(true);
  });
});

describe("isVideoEmbed", () => {
  it("separates players from widgets", () => {
    expect(isVideoEmbed("https://www.youtube.com/embed/x")).toBe(true);
    expect(isVideoEmbed("https://player.vimeo.com/video/1")).toBe(true);
    expect(isVideoEmbed("https://player.twitch.tv/?video=1")).toBe(true);
    // Sized by its host, not by an aspect ratio.
    expect(isVideoEmbed("https://discord.com/widget?id=1")).toBe(false);
    expect(isVideoEmbed("https://w.soundcloud.com/player/?url=x")).toBe(false);
  });

  it("is false for anything we would not frame at all", () => {
    expect(isVideoEmbed("https://videos.example/embed/1")).toBe(false);
    expect(isVideoEmbed(null)).toBe(false);
  });
});

describe("classifyClassName", () => {
  it("reads itch's own editor alignment", () => {
    expect(classifyClassName("text-center")).toEqual({ align: "center" });
    expect(classifyClassName("text-right")).toEqual({ align: "right" });
    expect(classifyClassName("text-justify")).toEqual({ align: "justify" });
  });

  it("reads layout intent out of a host's own vocabulary", () => {
    expect(classifyClassName("custom-prize-card custom-first").kind).toBe("card");
    expect(classifyClassName("custom-meet-box").kind).toBe("card");
    expect(classifyClassName("custom-sponsor-grid").kind).toBe("grid");
    expect(classifyClassName("custom-prize-column").kind).toBe("column");
    expect(classifyClassName("custom-left-col").kind).toBe("column");
    expect(classifyClassName("custom-section custom-section-rules").kind).toBe("section");
  });

  it("prefers the cell over the grid it sits in", () => {
    // `sponsor-grid-item` is one tile, not a nested grid.
    expect(classifyClassName("custom-sponsor-grid-item").kind).toBe("card");
  });

  it("matches whole words only", () => {
    // `col` inside `color`, `box` inside `boxing` — neither is a layout.
    expect(classifyClassName("custom-color").kind).toBeUndefined();
    expect(classifyClassName("theme-colors").kind).toBeUndefined();
    expect(classifyClassName("boxing-day-jam").kind).toBeUndefined();
  });

  it("drops what the host hid", () => {
    expect(classifyClassName("custom-hidden")).toEqual({ hidden: true });
  });

  it("only treats a class as a button on an anchor", () => {
    expect(classifyClassName("custom-button", "A").kind).toBe("button");
    expect(classifyClassName("custom-button", "DIV").kind).toBeUndefined();
  });

  it("centers a titled heading, but not a titled container", () => {
    expect(classifyClassName("custom-header", "H2").align).toBe("center");
    expect(classifyClassName("custom-header", "DIV").align).toBeUndefined();
  });

  it("returns nothing for an empty or unrecognized class list", () => {
    expect(classifyClassName("")).toEqual({});
    expect(classifyClassName("   ")).toEqual({});
    expect(classifyClassName("custom-announcement")).toEqual({});
  });
});
