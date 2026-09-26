// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ChannelText } from "@/components/ui/typography/channels";
import { MarkedText } from "@/components/ui/typography/marked-text";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

const GUILD = "243005537342586880";
const CHANNEL_LIST = "552209553886806046";

const channels = vi.hoisted(() => ({
  current: { data: undefined, isPending: false } as {
    data?: { guildId: string; channels: { id: string; name: string }[] };
    isPending: boolean;
  },
}));
vi.mock("@/lib/hooks/use-guild-channels", () => ({ useGuildChannels: () => channels.current }));

afterEach(() => {
  cleanup();
  channels.current = { data: undefined, isPending: false };
});

const loaded = () => {
  channels.current = {
    data: { guildId: GUILD, channels: [{ id: CHANNEL_LIST, name: "channel_list" }] },
    isPending: false,
  };
};

const renderMarkdown = (source: string) =>
  render(
    <AppSettingsProvider>
      <MarkedText>{source}</MarkedText>
    </AppSettingsProvider>,
  );

describe("channel mentions", () => {
  it("names and links a macro's channel token without the mentions flag", () => {
    loaded();
    const { container } = renderMarkdown(
      `<#${CHANNEL_LIST}> https://imgur.com/Av9GlIQ.gif\n\n- see <#${CHANNEL_LIST}>`,
    );
    const chips = [...container.querySelectorAll("a")].filter((a) =>
      a.textContent?.startsWith("#"),
    );
    expect(chips.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["#channel_list", `discord://-/channels/${GUILD}/${CHANNEL_LIST}`],
      ["#channel_list", `discord://-/channels/${GUILD}/${CHANNEL_LIST}`],
    ]);
    expect(container.textContent).not.toContain("<#");
  });

  it("reads #unknown for an id not in the public list", () => {
    loaded();
    const { container } = renderMarkdown("ask in <#111111111111111111>");
    expect(container.textContent).toBe("ask in #unknown");
    expect(container.querySelector("a")).toBeNull();
  });

  it("leaves code alone", () => {
    loaded();
    expect(renderMarkdown(`\`<#${CHANNEL_LIST}>\``).container.textContent).toBe(
      `<#${CHANNEL_LIST}>`,
    );
  });

  it("shows a loading chip while the list loads", () => {
    channels.current = { data: undefined, isPending: true };
    expect(
      renderMarkdown(`<#${CHANNEL_LIST}>`).container.querySelector("[role=status]"),
    ).not.toBeNull();
  });

  it("names without linking in ChannelText", () => {
    loaded();
    const { container } = render(<ChannelText>{`<#${CHANNEL_LIST}> gif`}</ChannelText>);
    expect(container.textContent).toBe("#channel_list gif");
    expect(container.querySelector("a")).toBeNull();
  });
});
