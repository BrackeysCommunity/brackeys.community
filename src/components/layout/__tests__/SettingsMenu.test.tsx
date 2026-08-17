import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SETTINGS_TAB_META, SETTINGS_TABS } from "@/components/settings/settings-tabs";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";
import { AppThemeProvider } from "@/lib/hooks/use-app-theme";

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
  it("opens without throwing and deep-links every section", () => {
    openMenu();

    for (const tab of SETTINGS_TABS) {
      const item = screen.getByRole("menuitem", {
        name: new RegExp(SETTINGS_TAB_META[tab].label, "i"),
      });
      expect(item.getAttribute("href")).toBe(SETTINGS_TAB_META[tab].to);
    }
    // The pickers themselves live on the page now — the menu only reports.
    expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0);
  });

  it("reads back the active theme and motion pref", () => {
    openMenu();

    expect(screen.getByRole("menuitem", { name: /appearance/i }).textContent).toContain("Nord");
    expect(screen.getByRole("menuitem", { name: /motion/i }).textContent).toContain("System");
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
