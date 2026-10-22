import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_THEME_ID, resolveThemeId, themes } from "@/lib/themes";

describe("resolveThemeId", () => {
  it("keeps every current theme id", () => {
    for (const theme of themes) expect(resolveThemeId(theme.id)).toBe(theme.id);
  });

  it("maps the old default id to the current one", () => {
    expect(resolveThemeId("brackeys")).toBe(DEFAULT_THEME_ID);
  });

  it("falls back to the default for anything missing or unknown", () => {
    expect(resolveThemeId(null)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId("")).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId("vaporwave")).toBe(DEFAULT_THEME_ID);
  });

  it("is the first theme in the list", () => {
    expect(themes[0].id).toBe(DEFAULT_THEME_ID);
  });
});
