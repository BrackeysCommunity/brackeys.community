import { describe, expect, it } from "vite-plus/test";

import {
  accentColor,
  actionRow,
  componentEmbed,
  container,
  type ContainerChild,
  linkButton,
  mdEscape,
  mdLink,
  mediaGallery,
  section,
  textDisplay,
  thumbnail,
} from "@/lib/discord-embed";

function payload(scripts: { children: string }[]) {
  expect(scripts).toHaveLength(1);
  return JSON.parse(scripts[0]!.children) as { component: { components: ContainerChild[] } };
}

describe("accentColor", () => {
  it("reads every form the scraper stores", () => {
    expect(accentColor("#5865F2")).toBe(0x5865f2);
    expect(accentColor("#58f")).toBe(0x5588ff);
    expect(accentColor("rgb(88, 101, 242)")).toBe(0x5865f2);
    expect(accentColor("rgba(88, 101, 242, 0.5)")).toBe(0x5865f2);
  });

  it("drops the alpha channel rather than the color", () => {
    expect(accentColor("#5865F280")).toBe(0x5865f2);
  });

  it("returns undefined for anything else, so the caller's fallback wins", () => {
    expect(accentColor("rebeccapurple")).toBeUndefined();
    expect(accentColor("rgb(300, 0, 0)")).toBeUndefined();
    expect(accentColor(null)).toBeUndefined();
  });
});

describe("markdown", () => {
  it("neutralizes formatting in text we did not write", () => {
    expect(mdEscape("**Ludum** _Dare_")).toBe("\\*\\*Ludum\\*\\* \\_Dare\\_");
  });

  it("keeps a link label inside its brackets", () => {
    expect(mdLink("Jam [2026] (beta)", "https://x.test")).toBe("[Jam 2026 (beta)](https://x.test)");
  });

  it("falls back to a label rather than emitting an empty one", () => {
    expect(mdLink("   ", "https://x.test")).toBe("[link](https://x.test)");
  });
});

describe("builders", () => {
  it("drops buttons whose url is not http(s)", () => {
    expect(linkButton("Open", "javascript:alert(1)")).toBeNull();
    expect(linkButton("Open", "/collab/1")).toBeNull();
    expect(linkButton("Open", "https://x.test")).toEqual({
      type: 2,
      style: 5,
      url: "https://x.test",
      label: "Open",
    });
  });

  it("drops a button with neither label nor emoji", () => {
    expect(linkButton("", "https://x.test")).toBeNull();
    expect(linkButton("", "https://x.test", { emoji: { name: "🎮" } })).not.toBeNull();
  });

  it("returns no row when every button was dropped", () => {
    expect(actionRow([null, linkButton("Open", "not a url")])).toBeNull();
  });

  it("caps a gallery at four items and skips unusable urls", () => {
    const gallery = mediaGallery([
      { url: "https://x.test/1.png" },
      { url: null },
      { url: "https://x.test/2.png" },
      { url: "https://x.test/3.png" },
      { url: "https://x.test/4.png" },
      { url: "https://x.test/5.png" },
    ]);
    expect(gallery?.items.map((item) => item.media.url)).toEqual([
      "https://x.test/1.png",
      "https://x.test/2.png",
      "https://x.test/3.png",
      "https://x.test/4.png",
    ]);
  });

  it("degrades a section to its text when the accessory could not be built", () => {
    expect(section(textDisplay("hi"), thumbnail(null))).toEqual({ type: 10, content: "hi" });
  });
});

describe("componentEmbed", () => {
  it("emits the tag Discord looks for", () => {
    const [script] = componentEmbed(container([textDisplay("hi")]));
    expect(script?.id).toBe("discord:component-embed");
    expect(script?.type).toBe("application/json");
  });

  it("escapes the one character that can close the script element", () => {
    const [script] = componentEmbed(container([textDisplay("</script><img onerror=x>")]));
    expect(script?.children).not.toContain("</script>");
    // Still the original text once a JSON parser has read it.
    expect(payload([script!]).component.components[0]).toEqual({
      type: 10,
      content: "</script><img onerror=x>",
    });
  });

  it("emits nothing for an empty container, leaving the Open Graph card", () => {
    expect(componentEmbed(container([null, null]))).toEqual([]);
  });

  it("emits nothing past the 40-component cap", () => {
    const rows = Array.from({ length: 10 }, () =>
      actionRow([
        linkButton("a", "https://x.test"),
        linkButton("b", "https://x.test"),
        linkButton("c", "https://x.test"),
      ]),
    );
    expect(componentEmbed(container(rows))).toEqual([]);
  });

  it("emits nothing past the byte budget", () => {
    expect(componentEmbed(container([textDisplay("x".repeat(3001))]))).toEqual([]);
  });

  it("measures the budget in bytes, not characters", () => {
    // 1,200 three-byte characters is well under any character-count cap and
    // well over the byte one.
    expect(componentEmbed(container([textDisplay("あ".repeat(1200))]))).toEqual([]);
  });
});
