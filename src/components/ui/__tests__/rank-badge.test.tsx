// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The real hook needs a PostHog client that never loads under test. Keying
// the mock on the flag name pins it: a rename in `@/lib/flags` fails here
// rather than silently serving the default forever.
const flags = vi.hoisted(() => ({ ogColor: false }));
vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: (key: string) => key === "server-role-icon-og-color" && flags.ogColor,
}));

import { RankBadge } from "@/components/ui/rank-badge";
import { GUILD_RANK_ICONS } from "@/lib/guild-rank";

afterEach(() => {
  cleanup();
  flags.ogColor = false;
});

function maskedIcon(container: HTMLElement) {
  return container.querySelector<HTMLElement>(".rank-icon");
}

describe("RankBadge", () => {
  it("renders nothing without a ranked role", () => {
    render(<RankBadge roles={["Booster"]} />);
    expect(screen.queryByTestId("rank-badge")).toBeNull();
  });

  it("masks the guild's icon for a rank that has one", () => {
    const { container } = render(<RankBadge roles={["Admin"]} />);
    expect(screen.getByTestId("rank-badge").textContent).toBe("Admin");
    expect(maskedIcon(container)?.style.getPropertyValue("--rank-icon")).toBe(
      `url(${GUILD_RANK_ICONS.admin})`,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("is a flat round chip in the sans face, not the raised mono label pad", () => {
    render(<RankBadge roles={["Admin"]} />);
    const chip = screen.getByTestId("rank-badge");
    expect(chip.className).not.toContain("chonk-emboss");
    expect(chip.className).not.toContain("font-mono");
    expect(chip.className).not.toContain("uppercase");
    expect(chip.className).toContain("rounded-full");
    // Title case, not the shouted label voice the surrounding badges use.
    expect(chip.textContent).toBe("Admin");
  });

  it("stays expanded off an avatar, where there is nothing to hover", () => {
    render(<RankBadge roles={["Admin"]} />);
    const chip = screen.getByTestId("rank-badge");
    expect(chip.className).not.toContain("group-hover/avatar");
    expect(chip.className).not.toContain("max-w-0");
    expect(chip.textContent).toBe("Admin");
  });

  it("renders Staff text-only, since the guild role carries no icon", () => {
    const { container } = render(<RankBadge roles={["Staff"]} />);
    expect(screen.getByTestId("rank-badge").textContent).toBe("Staff");
    expect(maskedIcon(container)).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("takes the highest rank when a member holds several", () => {
    const { container } = render(<RankBadge roles={["BIP", "Guru", "Admin"]} />);
    expect(maskedIcon(container)?.style.getPropertyValue("--rank-icon")).toBe(
      `url(${GUILD_RANK_ICONS.admin})`,
    );
  });

  it("keeps the guild's own colors once the flag is on", () => {
    flags.ogColor = true;
    const { container } = render(<RankBadge roles={["Guru"]} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(GUILD_RANK_ICONS.guru);
    // Decorative — the badge already names the rank in text.
    expect(img?.getAttribute("alt")).toBe("");
    expect(maskedIcon(container)).toBeNull();
  });

  it("leaves Staff text-only with the flag on", () => {
    flags.ogColor = true;
    const { container } = render(<RankBadge roles={["Staff"]} />);
    expect(container.querySelector("img")).toBeNull();
    expect(maskedIcon(container)).toBeNull();
  });

  it("lets a call site override the flag either way", () => {
    flags.ogColor = true;
    const { container } = render(<RankBadge roles={["Admin"]} tone="gradient" />);
    expect(maskedIcon(container)).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
