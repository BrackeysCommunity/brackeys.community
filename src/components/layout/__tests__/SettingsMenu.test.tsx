import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SETTINGS_TAB_META, SETTINGS_TABS } from "@/components/settings/settings-tabs";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";
import { AppThemeProvider } from "@/lib/hooks/use-app-theme";

// Signed in, so the account-backed sections (notifications, privacy,
// account) render alongside the local ones instead of being gated out.
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "test-user" } } }) },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    viewTransition: _viewTransition,
    children,
    ...rest
  }: {
    to: string;
    viewTransition?: boolean;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouterState: <T,>({ select }: { select: (s: unknown) => T }) =>
    select({ location: { pathname: "/" } }),
}));

const { SettingsMenu } = await import("@/components/layout/SettingsMenu");

afterEach(cleanup);

function renderMenu() {
  return render(
    <AppThemeProvider>
      <AppSettingsProvider>
        <SettingsMenu />
      </AppSettingsProvider>
    </AppThemeProvider>,
  );
}

function openMenu() {
  renderMenu();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
}

describe("SettingsMenu", () => {
  // The SETTINGS label is a base-ui group label, which throws outside a
  // <Menu.Group> — a crash that only surfaces on open, not on mount.
  it("opens without throwing and deep-links every section but motion", () => {
    openMenu();

    for (const tab of SETTINGS_TABS) {
      if (tab === "motion") continue;
      const item = screen.getByRole("menuitem", {
        name: new RegExp(SETTINGS_TAB_META[tab].label, "i"),
      });
      expect(item.getAttribute("href")).toBe(SETTINGS_TAB_META[tab].to);
    }
    // Motion is a toggle down with mute, not a link to its pane.
    expect(screen.queryByRole("menuitem", { name: /motion/i })).toBeNull();
    // The pickers themselves live on the page now — the menu only reports.
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });

  it("reads back the active theme", () => {
    openMenu();

    expect(screen.getByRole("menuitem", { name: /appearance/i }).textContent).toContain("Nord");
  });

  it("flips motion from the menu", () => {
    openMenu();

    const motion = screen.getByRole("menuitemcheckbox", { name: /motion/i });
    // Checked is the effective value: `system` with no OS preference is on.
    expect(motion.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(motion);

    expect(
      screen.getByRole("menuitemcheckbox", { name: /motion/i }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("still flips mute from the menu", () => {
    openMenu();

    const mute = screen.getByRole("menuitemcheckbox", { name: /mute/i });
    expect(mute.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(mute);

    expect(
      screen.getByRole("menuitemcheckbox", { name: /mute/i }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});
