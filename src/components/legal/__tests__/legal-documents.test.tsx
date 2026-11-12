import { cleanup, render } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const deploy = vi.hoisted(() => ({
  env: { VITE_DEPLOY_ENV: "staging" as "production" | "staging" | "development" | undefined },
}));

vi.mock("@/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/env")>()),
  env: deploy.env,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { PrivacyDocument } = await import("@/components/legal/PrivacyDocument");
const { TermsDocument } = await import("@/components/legal/TermsDocument");

afterEach(() => {
  cleanup();
  deploy.env.VITE_DEPLOY_ENV = "staging";
});

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

describe("the terms' games section", () => {
  const sectionIds = (container: HTMLElement) =>
    [...container.querySelectorAll("section[id]")].map((el) => el.id);

  it("follows the jams section, in the contents too, where the site hosts games", () => {
    const { container } = render(<TermsDocument />);
    const ids = sectionIds(container);
    expect(ids[ids.indexOf("jams") + 1]).toBe("games");
    const games = container.querySelector("section#games");
    expect(games?.textContent).toContain("Games you publish and play");
    expect(container.querySelector("nav[aria-label='Contents'] a[href='#games']")).not.toBeNull();
  });

  it("is absent on production", () => {
    deploy.env.VITE_DEPLOY_ENV = "production";
    const { container } = render(<TermsDocument />);
    expect(container.querySelector("section#games")).toBeNull();
    expect(container.querySelector("a[href='#games']")).toBeNull();
    expect(container.textContent).not.toContain("Games you publish and play");
    expect(sectionIds(container)).toContain("jams");
  });
});
