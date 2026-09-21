// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The rank chip reads a feature flag through the lazily-loaded PostHog
// client, which never lands under test.
vi.mock("@/lib/hooks/use-flag", () => ({ useFlag: () => false }));

import { UserAvatar } from "@/components/ui/user-avatar";

afterEach(cleanup);

describe("UserAvatar", () => {
  it("pins the rank chip over its own bottom edge", () => {
    render(<UserAvatar avatarUrl={null} username="yasahiro" guildRoles={["Admin"]} size={36} />);
    const chip = screen.getByTestId("rank-badge");
    expect(chip.textContent).toBe("Admin");
    // Absolutely placed on the frame, so no column widens to hold it.
    expect(chip.className).toContain("absolute");
    expect(chip.className).toContain("-bottom-1.5");
    expect(chip.closest("[data-slot='avatar']")).not.toBeNull();
  });

  it("rests as a circle on the icon and grows the name on hover", () => {
    render(<UserAvatar avatarUrl={null} username="yasahiro" guildRoles={["Admin"]} size={36} />);
    const chip = screen.getByTestId("rank-badge");
    // 2px of padding around a 14px icon inside an 18px chip — square, so
    // `rounded-full` reads as a dot until the avatar is hovered.
    expect(chip.className).toContain("px-0.5");
    expect(chip.className).toContain("gap-0");
    expect(chip.className).toContain("group-hover/avatar:px-1.5");
    // The name is collapsed, not removed, so it still reaches a reader.
    expect(chip.textContent).toBe("Admin");
    expect(chip.querySelector("span:last-child")?.className).toContain(
      "group-hover/avatar:max-w-20",
    );
  });

  it("seats the chip low at rest and raises it on hover, with a spring", () => {
    render(<UserAvatar avatarUrl={null} username="yasahiro" guildRoles={["Admin"]} size={36} />);
    const chip = screen.getByTestId("rank-badge");
    expect(chip.className).toContain("translate-y-1");
    expect(chip.className).toContain("group-hover/avatar:translate-y-0");
    expect(chip.className).toContain("group-hover/avatar:ease-spring");
    // Spring on the way open, a plain quick ease on the way back.
    expect(chip.className).toContain("group-hover/avatar:duration-400");
    expect(chip.className).toContain("duration-150");
    // The centering offset has to survive alongside the rise.
    expect(chip.className).toContain("-translate-x-1/2");
  });

  it("takes the pointer, so the grown chip keeps the group hovered", () => {
    render(<UserAvatar avatarUrl={null} username="yasahiro" guildRoles={["Admin"]} size={36} />);
    // Exact tokens: the badge's base carries `[&>svg]:pointer-events-none`
    // for its icons, which a substring check would mistake for the badge's
    // own opt-out.
    const classes = screen.getByTestId("rank-badge").className.split(/\s+/);
    expect(classes).toContain("pointer-events-auto");
    expect(classes).not.toContain("pointer-events-none");
  });

  it("takes a resolved rank as well as raw roles", () => {
    render(<UserAvatar avatarUrl={null} username="joshe" rank="bip" />);
    expect(screen.getByTestId("rank-badge").textContent).toBe("BIP");
  });

  it("draws no chip for a member with no ranked role", () => {
    render(<UserAvatar avatarUrl={null} username="petrabyte" guildRoles={["Booster"]} />);
    expect(screen.queryByTestId("rank-badge")).toBeNull();
  });

  it("draws no chip when the surface passes no roles at all", () => {
    render(<UserAvatar avatarUrl={null} username="petrabyte" />);
    expect(screen.queryByTestId("rank-badge")).toBeNull();
  });
});
