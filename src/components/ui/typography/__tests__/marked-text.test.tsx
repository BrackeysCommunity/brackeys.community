// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { MarkedText } from "@/components/ui/typography/marked-text";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

function renderMarkdown(source: string, props: { censor?: boolean; embeds?: boolean } = {}) {
  return render(
    <AppSettingsProvider>
      <MarkedText {...props}>{source}</MarkedText>
    </AppSettingsProvider>,
  );
}

const TABLE = ["| Rate | Notes |", "| ---: | :--- |", "| $50/hr | jam work |"].join("\n");

afterEach(cleanup);

describe("MarkedText tables", () => {
  it("renders a GFM table rather than nothing", () => {
    const { container } = renderMarkdown(TABLE);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("thead th")).toHaveLength(2);
    expect(table?.querySelectorAll("tbody td")).toHaveLength(2);
    expect(screen.getByText("jam work")).toBeTruthy();
  });

  it("honours the column alignment marks", () => {
    const { container } = renderMarkdown(TABLE);
    const [rate, notes] = [...(container.querySelectorAll("thead th") ?? [])] as HTMLElement[];
    expect(rate.style.textAlign).toBe("right");
    expect(notes.style.textAlign).toBe("left");
  });

  it("wraps the table so a wide one scrolls instead of widening the panel", () => {
    const { container } = renderMarkdown(TABLE);
    const wrapper = container.querySelector("[data-slot=marked-table]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.firstElementChild?.tagName).toBe("TABLE");
  });

  it("renders an image, and still drops raw html", () => {
    const { container } = renderMarkdown('![a cat](https://example.com/cat.png "Mr Cat")\n');
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.com/cat.png");
    expect(img?.getAttribute("alt")).toBe("a cat");

    const { container: raw } = renderMarkdown("<b>bold</b>\n");
    expect(raw.querySelector("b")).toBeNull();
  });
});

describe("MarkedText headings", () => {
  it.each([1, 2, 3, 4, 5, 6])("renders a level-%i heading as a real heading element", (depth) => {
    const { container } = renderMarkdown(`${"#".repeat(depth)} Section\n\nbody`);
    const heading = container.querySelector(`h${depth}`);
    expect(heading?.textContent).toBe("Section");
  });

  it("carries a size rule for every heading level and for rules", () => {
    const { container } = renderMarkdown("# a\n\n---\n\nb");
    const root = container.querySelector("[data-slot=marked-text]");
    const className = root?.className ?? "";
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(className).toMatch(new RegExp(`\\[&_h${level}\\]:text-`));
    }
    expect(className).toContain("[&_hr]:");
    expect(container.querySelector("hr")).not.toBeNull();
  });
});

describe("MarkedText censoring", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("censors prose by default — the preference ships on", () => {
    const { container } = renderMarkdown("this **shit** is broken");
    expect(container.textContent).toContain("****");
    expect(container.textContent).not.toContain("shit");
  });

  it("leaves it alone once the viewer has opted out", () => {
    localStorage.setItem("brackeys-censor-profanity", "0");
    const { container } = renderMarkdown("this **shit** is broken");
    expect(container.textContent).toContain("shit");
  });

  it("never censors an author's own preview", () => {
    const { container } = renderMarkdown("this **shit** is broken", { censor: false });
    expect(container.textContent).toContain("shit");
  });
});

describe("MarkedText wikilinks", () => {
  const renderLinks = (source: string) =>
    render(
      <AppSettingsProvider>
        <MarkedText wikilink={(link) => <mark data-target={link.target}>{link.alias}</mark>}>
          {source}
        </MarkedText>
      </AppSettingsProvider>,
    );

  it("hands each link to the renderer, underscores and all", () => {
    const { container } = renderLinks("see [[level_one_draft|draft]] and **[[Boss]]**");
    const marks = [...container.querySelectorAll("mark")];
    expect(marks.map((m) => m.dataset.target)).toEqual(["level_one_draft", "Boss"]);
    expect(marks[1]!.closest("strong")).not.toBeNull();
    expect(container.querySelector("em")).toBeNull();
  });

  it("leaves links in code as written", () => {
    const { container } = renderLinks("`[[Boss]]`\n\n```\n[[Boss]]\n```");
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toContain("[[Boss]]");
  });

  it("stays plain text for callers that don't ask for links", () => {
    const { container } = renderMarkdown("[[Boss]]");
    expect(container.textContent).toBe("[[Boss]]");
  });
});

describe("MarkedText embeds", () => {
  const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("frames a bare video link on its own line", () => {
    const { container } = renderMarkdown(`Progress!\n\n${YT}`, { embeds: true });
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(screen.getByText("Progress!")).toBeTruthy();
  });

  it("lifts the link out of a paragraph with a caption line above it", () => {
    const { container } = renderMarkdown(`Caves, take two:\n${YT}`, { embeds: true });
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(screen.getByText("Caves, take two:")).toBeTruthy();
  });

  it("leaves links inside prose, named links, and other callers alone", () => {
    for (const source of [`watch ${YT} now`, `[the trailer](${YT})`]) {
      const { container } = renderMarkdown(source, { embeds: true });
      expect(container.querySelector("iframe")).toBeNull();
      cleanup();
    }
    const { container } = renderMarkdown(YT);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(YT);
  });

  it("plays a direct video file, linked or as a markdown image", () => {
    const { container } = renderMarkdown(
      "https://cdn.example.com/clip.mp4\n\n![](https://cdn.example.com/b.webm)",
      { embeds: true },
    );
    expect([...container.querySelectorAll("video")].map((v) => v.getAttribute("src"))).toEqual([
      "https://cdn.example.com/clip.mp4",
      "https://cdn.example.com/b.webm",
    ]);
  });
});
