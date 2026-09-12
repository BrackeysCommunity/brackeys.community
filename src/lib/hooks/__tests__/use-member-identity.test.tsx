import { act, cleanup, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { activeUserStore, type ActiveUserProfile } from "@/lib/active-user-store";
import { useMemberIdentity } from "@/lib/hooks/use-member-identity";

afterEach(() => {
  cleanup();
  activeUserStore.setState(() => ({ profile: null, isPending: false }));
});

const nova = {
  guildNickname: "Nova",
  discordUsername: "nova_dev",
  avatarUrl: "https://cdn.discordapp.com/avatars/1/global.png",
  guildAvatarUrl: "https://cdn.discordapp.com/guilds/g/users/1/avatars/server.png",
};

const viewerProfile = (inGuild: boolean): ActiveUserProfile => ({
  discordUsername: "viewer",
  discordId: "9",
  avatarUrl: null,
  guildNickname: null,
  guildAvatarUrl: null,
  urlStub: null,
  inGuild,
  availableForWork: false,
  isStaff: false,
  isAdmin: false,
});

function Byline() {
  const identity = useMemberIdentity();
  return (
    <p>
      <span data-testid="name">{identity.name(nova, "Member")}</span>
      <span data-testid="avatar">{identity.avatarUrl(nova)}</span>
    </p>
  );
}

describe("useMemberIdentity", () => {
  it("renders the global face before the session resolves, then swaps once the viewer is in the guild", () => {
    render(<Byline />);
    // Public reads are edge-cached and identical for everyone; the swap
    // happens here, after `getMyProfile` lands — so SSR and the first
    // client frame agree on the global face.
    expect(screen.getByTestId("name").textContent).toBe("nova_dev");
    expect(screen.getByTestId("avatar").textContent).toBe(nova.avatarUrl);

    act(() => {
      activeUserStore.setState((s) => ({ ...s, profile: viewerProfile(true) }));
    });
    expect(screen.getByTestId("name").textContent).toBe("Nova");
    expect(screen.getByTestId("avatar").textContent).toBe(nova.guildAvatarUrl);
  });

  it("keeps the global face for a signed-in member who is not in the guild", () => {
    activeUserStore.setState((s) => ({ ...s, profile: viewerProfile(false) }));
    render(<Byline />);
    expect(screen.getByTestId("name").textContent).toBe("nova_dev");
    expect(screen.getByTestId("avatar").textContent).toBe(nova.avatarUrl);
  });
});
