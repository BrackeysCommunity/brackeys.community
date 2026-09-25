// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { EmojiText } from "@/components/ui/typography/emoji";
import { MarkedText } from "@/components/ui/typography/marked-text";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children?: React.ReactNode; to: string }) => (
    <a {...props} href={to}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/mention-names", () => ({ useMentionName: () => ({ data: undefined }) }));

afterEach(cleanup);

const withSettings = (node: React.ReactNode) =>
  render(<AppSettingsProvider>{node}</AppSettingsProvider>);

describe("guild emojis", () => {
  it("draws tokens in markdown as CDN images", () => {
    const { container } = withSettings(
      <MarkedText>{"so **hot** <:fire:123456789012345678> right now"}</MarkedText>,
    );
    const img = container.querySelector("img[data-slot=guild-emoji]");
    expect(img?.getAttribute("src")).toBe(
      "https://cdn.discordapp.com/emojis/123456789012345678.webp?size=48",
    );
    expect(img?.getAttribute("alt")).toBe(":fire:");
    expect(container.textContent).toBe("so hot  right now");
  });

  it("uses a gif for animated emojis", () => {
    const { container } = withSettings(<EmojiText>{"<a:party:998877665544332211>"}</EmojiText>);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(".gif");
  });

  it("falls back to the name when the emoji is gone", () => {
    const { container } = withSettings(<EmojiText>{"gone <:old:123456789012345678>"}</EmojiText>);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("gone :old:");
  });

  it("leaves tokens inside code alone", () => {
    const { container } = withSettings(<MarkedText>{"`<:fire:123456789012345678>`"}</MarkedText>);
    expect(container.querySelector("img")).toBeNull();
  });

  it("links mentions around emojis", () => {
    const { container } = withSettings(
      <EmojiText mentions>{"<:fire:123456789012345678> @someone"}</EmojiText>,
    );
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("a")?.textContent).toBe("@someone");
  });
});
