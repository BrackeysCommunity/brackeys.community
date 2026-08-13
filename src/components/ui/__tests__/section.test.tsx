import { cleanup, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Section } from "@/components/ui/section";

afterEach(cleanup);

describe("Section", () => {
  it("titles a page section with a heading", () => {
    render(
      <Section title="Recent projects" blurb="What shipped lately">
        <p>body</p>
      </Section>,
    );
    expect(screen.getByRole("heading", { name: "Recent projects" })).toBeDefined();
  });

  it("renders the mini variant as a micro-label divider, not a heading", () => {
    render(
      <Section size="mini" title="Design" action={<button type="button">Add</button>}>
        <p>body</p>
      </Section>,
    );

    // A dozen group dividers inside one section must not read as a dozen
    // headings to a screen reader.
    expect(screen.queryByRole("heading")).toBe(null);
    expect(screen.getByText("DESIGN")).toBeDefined();
    expect(screen.getByRole("button", { name: "Add" })).toBeDefined();
  });
});
