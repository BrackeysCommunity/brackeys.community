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

describe("the booster name glow on a directory tile", () => {
  function nameEl() {
    return screen.getByText("yasahiro");
  }

  it("paints a single-stop glow as a flat colour", () => {
    render(
      <MemberDirectoryCard member={member({ nameGlowColors: ["#4f9dd9"], isBooster: true })} />,
    );
    expect(nameEl().style.color).toBe("rgb(79, 157, 217)");
  });

  // Two or more stops become the rotating gradient, which paints through
  // background-clip — so the text itself goes transparent.
  it("paints multiple stops as a gradient", () => {
    render(
      <MemberDirectoryCard
        member={member({ nameGlowColors: ["#4f9dd9", "#d94f9d"], isBooster: true })}
      />,
    );
    const el = nameEl();
    expect(el.className).toContain("name-glow");
    expect(el.style.color).toBe("transparent");
    expect(el.style.backgroundImage).toContain("--name-glow-stops");
  });

  // The gradient wraps back to its first colour so the sweep has no seam
  // when the angle comes round.
  // The byline carries the motion alongside the colours; before it did, every
  // surface but the edit preview silently fell back to the default sweep.
  it("honours the member's chosen motion", () => {
    render(
      <MemberDirectoryCard
        member={member({
          nameGlowColors: ["#4f9dd9", "#d94f9d"],
          nameGlowMotion: "still",
          isBooster: true,
        })}
      />,
    );
    expect(nameEl().style.animationName).toBe("");
  });

  // Staff earn it by rank, so a directory tile has to honour the roles it
  // already carries for the chip.
  it("paints a moderator's glow without a boost", () => {
    render(
      <MemberDirectoryCard
        member={member({
          nameGlowColors: ["#4f9dd9"],
          isBooster: false,
          guildRoles: ["Moderator"],
        })}
      />,
    );
    expect(nameEl().style.color).toBe("rgb(79, 157, 217)");
  });

  it("paints a Guru's name without a boost", () => {
    render(
      <MemberDirectoryCard
        member={member({ nameGlowColors: ["#4f9dd9"], isBooster: false, guildRoles: ["Guru"] })}
      />,
    );
    expect(nameEl().style.color).toBe("rgb(79, 157, 217)");
  });

  it("leaves an unranked, unboosted name alone", () => {
    render(
      <MemberDirectoryCard
        member={member({ nameGlowColors: ["#4f9dd9"], isBooster: false, guildRoles: [] })}
      />,
    );
    expect(nameEl().style.color).toBe("");
  });

  it("repeats the first stop so the sweep has no seam", () => {
    render(
      <MemberDirectoryCard
        member={member({ nameGlowColors: ["#4f9dd9", "#d94f9d"], isBooster: true })}
      />,
    );
    const stops = nameEl().style.getPropertyValue("--name-glow-stops");
    expect(stops.split(",").map((s) => s.trim())).toEqual(["#4f9dd9", "#d94f9d", "#4f9dd9"]);
  });

  // The perk is re-checked at render, so a lapsed boost drops the treatment
  // without anyone having to clear the stored colours.
  it("leaves a lapsed booster's name alone", () => {
    render(
      <MemberDirectoryCard member={member({ nameGlowColors: ["#4f9dd9"], isBooster: false })} />,
    );
    expect(nameEl().style.color).toBe("");
  });

  it("leaves a booster who picked nothing alone", () => {
    render(<MemberDirectoryCard member={member({ nameGlowColors: null, isBooster: true })} />);
    expect(nameEl().style.color).toBe("");
  });

  it("paints a near-black pick as picked", () => {
    render(
      <MemberDirectoryCard member={member({ nameGlowColors: ["#000000"], isBooster: true })} />,
    );
    expect(nameEl().style.color).toBe("rgb(0, 0, 0)");
  });
});
