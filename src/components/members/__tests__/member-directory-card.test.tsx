// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import type { DirectoryMember } from "@/components/members/MemberDirectoryCard";

const { MemberDirectoryCard } = await import("@/components/members/MemberDirectoryCard");

function member(overrides: Partial<DirectoryMember> = {}) {
  return {
    id: "u1",
    discordUsername: "yasahiro",
    guildNickname: null,
    avatarUrl: null,
    tagline: "Builds tools",
    lookingFor: "Small jam teams that need a composer",
    availableForWork: true,
    availability: "limited",
    collabPreference: "either",
    rateType: "negotiable",
    rateMin: null,
    rateMax: null,
    timezone: null,
    location: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    shipCount: 2,
    teamCount: 0,
    postCount: 0,
    activityScore: 0,
    urlStub: null,
    roles: [],
    skills: [],
    hiddenSkillCount: 0,
    ...overrides,
  } as unknown as DirectoryMember;
}

afterEach(cleanup);

describe("MemberDirectoryCard hire terms", () => {
  it("advertises capacity and rate while the member is open to work", () => {
    render(<MemberDirectoryCard member={member()} />);

    expect(screen.getByText("Limited")).toBeTruthy();
    expect(screen.getByText("NEGOTIABLE")).toBeTruthy();
    expect(screen.getByText("Small jam teams that need a composer")).toBeTruthy();
  });

  it("drops them once availability is turned off", () => {
    // The columns keep their values, but a closed member advertises nothing.
    render(<MemberDirectoryCard member={member({ availableForWork: false })} />);

    expect(screen.queryByText("Limited")).toBeNull();
    expect(screen.queryByText("NEGOTIABLE")).toBeNull();
    expect(screen.getByText("Builds tools")).toBeTruthy();
  });
});
