import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { cleanup, render } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { CONTACT, EFFECTIVE_DATE, SITE } from "@/lib/legal-meta";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { GameTermsDraft, GAME_TERMS_DRAFT } = await import("@/components/legal/GameTermsDraft");
const { GamePrivacyDraft, GAME_PRIVACY_DRAFT } =
  await import("@/components/legal/GamePrivacyDraft");
const { TermsDocument } = await import("@/components/legal/TermsDocument");
const { PrivacyDocument } = await import("@/components/legal/PrivacyDocument");

afterEach(cleanup);

const ROOT = process.cwd();

const DRAFTS = [
  {
    name: "game terms",
    Component: GameTermsDraft,
    sections: GAME_TERMS_DRAFT,
    file: "src/components/legal/GameTermsDraft.tsx",
  },
  {
    name: "game privacy",
    Component: GamePrivacyDraft,
    sections: GAME_PRIVACY_DRAFT,
    file: "src/components/legal/GamePrivacyDraft.tsx",
  },
] as const;

describe.each(DRAFTS)("the $name draft", ({ Component, sections, file }) => {
  it("gives every section a unique anchor, each listed in the contents", () => {
    const { container } = render(<Component />);
    const ids = [...container.querySelectorAll("section[id]")].map((el) => el.id);
    const linked = [
      ...(container.querySelector("nav[aria-label='Contents']")?.querySelectorAll("a[href^='#']") ??
        []),
    ].map((el) => (el.getAttribute("href") ?? "").slice(1));

    expect(ids).toEqual(sections.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(linked).toEqual(ids);
  });

  it("is dated as a draft, never with the published dates", () => {
    const text = render(<Component />).container.textContent ?? "";

    expect(text).toContain("Draft, not in force");
    expect(text).not.toContain(`Effective ${EFFECTIVE_DATE}`);
  });

  it("carries no unfilled placeholders", () => {
    const text = render(<Component />).container.textContent ?? "";

    expect(text).not.toMatch(/\[[A-Z][A-Z ,]+\]/);
    expect(text).not.toMatch(/\b(TODO|TBD|lorem)\b/i);
  });

  it("names the site and its addresses from legal-meta alone", () => {
    const text = render(<Component />).container.textContent ?? "";
    const source = readFileSync(join(ROOT, file), "utf8");

    expect(text).toContain(SITE.name);
    expect(text).toContain(CONTACT.privacy);
    expect(text).toContain(CONTACT.legal);
    expect(source).not.toMatch(
      /https?:\/\/|[\w.-]+@[\w-]+\.[a-z]+|\b[\w-]+\.(team|community|dev)\b/i,
    );
  });
});

describe("the drafts stay unpublished", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }
  const DRAFT_IMPORT = /GameTermsDraft|GamePrivacyDraft/;
  const DRAFT_FILES = new Set<string>(DRAFTS.map((d) => d.file));

  it("no route imports a draft", () => {
    const routes = sources(join(ROOT, "src/routes"));

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((f) => DRAFT_IMPORT.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("nothing outside the drafts imports one: no document, sitemap or footer", () => {
    const importers = sources(join(ROOT, "src"))
      .map((f) => relative(ROOT, f))
      .filter((f) => !DRAFT_FILES.has(f) && DRAFT_IMPORT.test(readFileSync(join(ROOT, f), "utf8")));

    expect(importers).toEqual([]);
  });

  it("leaves the published documents on their published dates", () => {
    for (const Component of [TermsDocument, PrivacyDocument]) {
      const text = render(<Component />).container.textContent ?? "";
      expect(text).toContain(`Effective ${EFFECTIVE_DATE}`);
      expect(text).not.toContain("Draft, not in force");
      cleanup();
    }
  });
});
