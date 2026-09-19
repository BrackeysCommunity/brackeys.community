// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { RichHtml } from "@/components/ui/typography/rich-html";

/**
 * Scraped jam bodies are the site's only source of layout shift and its
 * only `image-alt` failure: itch bodies hotlink full-size images, usually
 * with no alt text and, where they do carry dimensions, they were being
 * stripped — so nothing reserved the box before the image landed.
 */
function body(html: string) {
  const { container } = render(<RichHtml html={html} />);
  return container.querySelector("img")!;
}

describe("RichHtml scraped images", () => {
  it("gives an image with no alt an empty one", () => {
    expect(body(`<p><img src="https://i.imgur.com/a.png"></p>`).getAttribute("alt")).toBe("");
  });

  it("leaves real alt text alone", () => {
    expect(
      body(`<p><img src="https://i.imgur.com/a.png" alt="The jam logo"></p>`).getAttribute("alt"),
    ).toBe("The jam logo");
  });

  it("keeps a width/height pair, so the box is reserved", () => {
    const image = body(`<p><img src="https://i.imgur.com/a.png" width="1280" height="720"></p>`);
    expect(image.getAttribute("width")).toBe("1280");
    expect(image.getAttribute("height")).toBe("720");
  });

  it("drops a lone dimension, which has no ratio to give", () => {
    const image = body(`<p><img src="https://i.imgur.com/a.png" width="1280"></p>`);
    expect(image.hasAttribute("width")).toBe(false);
    expect(image.hasAttribute("height")).toBe(false);
  });

  it("drops dimensions that aren't whole positive numbers", () => {
    const image = body(`<p><img src="https://i.imgur.com/a.png" width="100%" height="auto"></p>`);
    expect(image.hasAttribute("width")).toBe(false);
    expect(image.hasAttribute("height")).toBe(false);
  });

  it("still loads and decodes body images lazily", () => {
    const image = body(`<p><img src="https://i.imgur.com/a.png"></p>`);
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
  });
});
