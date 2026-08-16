import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";
import { AppThemeProvider } from "@/lib/hooks/use-app-theme";
import { darkThemes, lightThemes, themes } from "@/lib/themes";

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
  it("opens without throwing and lists every theme under its mode", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByText("Theme · Dark")).toBeDefined();
    expect(screen.getByText("Theme · Light")).toBeDefined();
    // Theme radios plus the three-way Motion control.
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(themes.length + 3);
    expect(darkThemes.length + lightThemes.length).toBe(themes.length);
    expect(screen.getAllByRole("menuitemcheckbox")).toHaveLength(1);
  });

  it("flips the motion pref from the menu", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const off = screen.getByRole("menuitemradio", { name: "Off" });
    expect(off.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(off);

    expect(screen.getByRole("menuitemradio", { name: "Off" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("flips a checkbox pref from the menu", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const mute = screen.getByRole("menuitemcheckbox", { name: /mute/i });
    expect(mute.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(mute);

    expect(
      screen.getByRole("menuitemcheckbox", { name: /mute/i }).getAttribute("aria-checked"),
    ).toBe("true");
  });
});
