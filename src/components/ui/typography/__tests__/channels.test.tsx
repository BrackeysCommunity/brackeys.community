// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { DiscordTokenText } from "@/components/ui/typography/channels";
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
const lookup = vi.hoisted(() => ({
  current: { data: null, isPending: false, fetchStatus: "idle" } as {
    data: { id: string; name: string } | null;
    isPending: boolean;
    fetchStatus: string;
  },
}));
const roles = [
  { id: "900000000000000001", name: "Staff", color: 0xe91e63 },
  { id: "900000000000000002", name: "Plain", color: 0 },
];
vi.mock("@/lib/hooks/use-guild-channels", () => ({
  useGuildChannels: () => channels.current,
  useGuildChannelLookup: () => lookup.current,
  useGuildRoles: () => ({ data: roles }),
}));

const users = vi.hoisted(
  () =>
    new Map<
      string,
      { discordId: string; handle: string | null; displayName: string; avatarUrl: null }
    >(),
);
vi.mock("@/lib/mention-names", () => ({
  useMentionName: () => ({ data: undefined, isPending: false }),
  useDiscordUserName: (id: string) => ({ data: users.get(id) ?? null, isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    ...props
  }: {
    children?: React.ReactNode;
    params?: { userId: string };
  }) => (
    <a {...props} href={`/profile/${params?.userId ?? ""}`}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  channels.current = { data: undefined, isPending: false };
  lookup.current = { data: null, isPending: false, fetchStatus: "idle" };
  users.clear();
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

  it("names without linking in DiscordTokenText", () => {
    loaded();
    const { container } = render(<DiscordTokenText>{`<#${CHANNEL_LIST}> gif`}</DiscordTokenText>);
    expect(container.textContent).toBe("#channel_list gif");
    expect(container.querySelector("a")).toBeNull();
  });

  it("names an archived thread from its own lookup", () => {
    loaded();
    lookup.current = {
      data: { id: "111111111111111111", name: "old-thread" },
      isPending: false,
      fetchStatus: "idle",
    };
    expect(renderMarkdown("see <#111111111111111111>").container.textContent).toBe(
      "see #old-thread",
    );
  });
});

describe("Discord user and role mentions", () => {
  it("links a member with a profile and names one without", () => {
    users.set("200000000000000001", {
      discordId: "200000000000000001",
      handle: "alice",
      displayName: "Alice",
      avatarUrl: null,
    });
    users.set("200000000000000002", {
      discordId: "200000000000000002",
      handle: null,
      displayName: "Bob",
      avatarUrl: null,
    });
    const { container } = renderMarkdown(
      "ping <@200000000000000001> and <@!200000000000000002> or <@300000000000000003>",
    );
    expect(container.textContent).toBe("ping @Alice and @Bob or @unknown-user");
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/profile/alice",
    ]);
  });

  it("draws roles in their color", () => {
    const { container } = renderMarkdown("<@&900000000000000001> <@&900000000000000002>");
    const chips = [...container.querySelectorAll("span")].filter((s) =>
      s.textContent?.startsWith("@"),
    );
    expect(chips.map((c) => c.textContent)).toEqual(["@Staff", "@Plain"]);
    expect(chips[0]!.style.color).not.toBe("");
    expect(chips[1]!.style.color).toBe("");
  });
});
