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

const mentionName = vi.hoisted(() => ({
  current: { data: undefined, isPending: false } as {
    data?: { handle: string; displayName: string; avatarUrl: null };
    isPending: boolean;
  },
}));
vi.mock("@/lib/mention-names", () => ({ useMentionName: () => mentionName.current }));

afterEach(() => {
  cleanup();
  mentionName.current = { data: undefined, isPending: false };
});

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

  it("shows the display name once it loads", () => {
    mentionName.current = {
      data: { handle: "duxez", displayName: "Job", avatarUrl: null },
      isPending: false,
    };
    expect(renderMarkdown("hi @duxez", true).container.querySelector("a")?.textContent).toBe(
      "@Job",
    );
  });

  it("shows loading dots instead of the raw handle while the name loads", () => {
    mentionName.current = { data: undefined, isPending: true };
    const link = renderMarkdown("hi @duxez", true).container.querySelector("a")!;
    expect(link.textContent).toBe("@");
    expect(link.querySelector("[role=status]")).not.toBeNull();
  });
});
