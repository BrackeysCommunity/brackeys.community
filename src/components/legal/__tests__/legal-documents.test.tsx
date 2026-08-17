import { cleanup, render } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { PrivacyDocument } = await import("@/components/legal/PrivacyDocument");
const { TermsDocument } = await import("@/components/legal/TermsDocument");

afterEach(cleanup);

const DOCUMENTS = [
  { name: "Terms of Service", Component: TermsDocument },
  { name: "Privacy Policy", Component: PrivacyDocument },
] as const;

describe.each(DOCUMENTS)("$name", ({ Component }) => {
  it("gives every section a unique anchor", () => {
    const { container } = render(<Component />);
    const ids = [...container.querySelectorAll("section[id]")].map((el) => el.id);

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every contents entry at a section that exists", () => {
    const { container } = render(<Component />);
    const contents = container.querySelector("nav[aria-label='Contents']");
    const targets = [...(contents?.querySelectorAll("a[href^='#']") ?? [])].map((el) =>
      (el.getAttribute("href") ?? "").slice(1),
    );

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(container.querySelector(`section[id="${target}"]`)).not.toBeNull();
    }
  });

  it("numbers the contents in step with the sections", () => {
    const { container } = render(<Component />);
    const contents = container.querySelector("nav[aria-label='Contents']");
    const linked = [...(contents?.querySelectorAll("a[href^='#']") ?? [])].map((el) =>
      (el.getAttribute("href") ?? "").slice(1),
    );
    const rendered = [...container.querySelectorAll("section[id]")].map((el) => el.id);

    expect(linked).toEqual(rendered);
  });

  it("cross-links the other document", () => {
    const { container } = render(<Component />);
    const hrefs = [...container.querySelectorAll("a[href]")].map((el) => el.getAttribute("href"));

    expect(hrefs).toContain("/terms");
    expect(hrefs).toContain("/privacy");
  });

  // These are published as operative documents, so a bracketed stand-in
  // reaching a reader is the one failure that matters most.
  it("carries no unfilled placeholders", () => {
    const { container } = render(<Component />);

    expect(container.textContent ?? "").not.toMatch(/\[[A-Z][A-Z ,]+\]/);
  });
});
