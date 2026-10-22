// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { MarkedText } from "@/components/ui/typography/marked-text";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

afterEach(cleanup);

function rels(source: string, ugcLinks?: boolean) {
  const { container } = render(
    <AppSettingsProvider>
      <MarkedText ugcLinks={ugcLinks}>{source}</MarkedText>
    </AppSettingsProvider>,
  );
  return [...container.querySelectorAll("a")].map((a) => a.getAttribute("rel") ?? "");
}

const SOURCE = "See [the docs](https://example.com/a) and https://example.com/b too.";

describe("MarkedText ugcLinks", () => {
  it("marks every link, written or bare, as nofollow ugc noopener", () => {
    const found = rels(SOURCE, true);
    expect(found).toHaveLength(2);
    for (const rel of found) {
      const parts = rel.split(/\s+/);
      for (const token of ["nofollow", "ugc", "noopener"]) expect(parts).toContain(token);
    }
  });

  it("leaves other callers' links as they were", () => {
    for (const rel of rels(SOURCE)) {
      expect(rel.split(/\s+/)).not.toContain("nofollow");
      expect(rel.split(/\s+/)).toContain("noopener");
    }
  });
});
