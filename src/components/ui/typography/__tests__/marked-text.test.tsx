// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { MarkedText } from "@/components/ui/typography/marked-text";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

function renderMarkdown(source: string, props: { censor?: boolean } = {}) {
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
