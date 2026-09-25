// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { MarkedText } from "@/components/ui/typography/marked-text";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    params?: { userId: string };
    to: string;
  }) => (
    <a {...props} href={to.replace("$userId", params?.userId ?? "")}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const renderMarkdown = (source: string, mentions: boolean) =>
  render(
    <AppSettingsProvider>
      <MarkedText mentions={mentions}>{source}</MarkedText>
    </AppSettingsProvider>,
  );

describe("MarkedText mentions", () => {
  it("links @handles in prose to their profiles", () => {
    const { container } = renderMarkdown("thanks **@Alice** and @bob!", true);
    const links = [...container.querySelectorAll("a")].map((a) => [
      a.textContent,
      a.getAttribute("href"),
    ]);
    expect(links).toEqual([
      ["@Alice", "/profile/alice"],
      ["@bob", "/profile/bob"],
    ]);
    expect(container.textContent).toBe("thanks @Alice and @bob!");
  });

  it("leaves code and plain renders alone", () => {
    expect(renderMarkdown("`@alice`", true).container.querySelector("a")).toBeNull();
    cleanup();
    expect(renderMarkdown("@alice", false).container.querySelector("a")).toBeNull();
  });
});
