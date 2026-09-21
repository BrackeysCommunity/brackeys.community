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

describe("MemberDirectoryCard chip budget", () => {
  const named = (names: string[]) => names.map((name, i) => ({ id: i + 1, name }));

  it("gives the stack what the roles leave and folds the rest into the count", () => {
    render(
      <MemberDirectoryCard
        member={member({
          roles: named(["Composer", "Sound Designer"]),
          skills: named(["FMOD", "Unity", "C#", "Wwise", "Reaper", "Blender"]),
          hiddenSkillCount: 2,
        })}
      />,
    );

    // Two roles plus three skills fills the budget; the three skills that
    // miss out and the two the server already dropped share the "+N".
    expect(screen.getByText("C#")).toBeTruthy();
    expect(screen.queryByText("Wwise")).toBeNull();
    expect(screen.getByText("+5")).toBeTruthy();
  });

  it("shows the whole stack when it already fits", () => {
    render(
      <MemberDirectoryCard
        member={member({ roles: named(["Composer"]), skills: named(["FMOD", "Unity"]) })}
      />,
    );

    expect(screen.getByText("Unity")).toBeTruthy();
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });
});

describe("MemberDirectoryCard guild rank", () => {
  it("names the highest guild rank on the avatar", () => {
    render(<MemberDirectoryCard member={member({ guildRoles: ["Guru", "Moderator"] })} />);

    // The chip says "Mod", the name the guild gives the role; "Moderator"
    // is the internal role name authorization matches on.
    expect(screen.getByTestId("rank-badge").textContent).toBe("Mod");
  });

  it("shows nothing for a member with no rank", () => {
    render(<MemberDirectoryCard member={member({ guildRoles: ["Member"] })} />);

    expect(screen.queryByTestId("rank-badge")).toBeNull();
  });
});
