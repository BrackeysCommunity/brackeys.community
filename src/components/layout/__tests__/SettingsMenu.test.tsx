import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";
import { AppThemeProvider } from "@/lib/hooks/use-app-theme";
import { themes } from "@/lib/themes";

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

describe("SettingsMenu", () => {
  // The THEME label is a base-ui group label, which throws outside a
  // <Menu.Group> — a crash that only surfaces on open, not on mount.
  it("opens without throwing and lists every theme", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Theme")).toBeDefined();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(themes.length);
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(2);
  });

  it("flips a checkbox pref from the menu", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const reduceMotion = screen.getByRole("menuitemcheckbox", { name: /reduce motion/i });
    expect(reduceMotion.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(reduceMotion);

    expect(
      screen.getByRole("menuitemcheckbox", { name: /reduce motion/i }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});
