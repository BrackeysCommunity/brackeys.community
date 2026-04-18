// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vite-plus/test";

import { getStyle } from "../utils";

describe("getStyle", () => {
  const touched = new Set<string>();

  function setVar(name: string, value: string) {
    document.documentElement.style.setProperty(name, value);
    touched.add(name);
  }

  afterEach(() => {
    for (const name of touched) document.documentElement.style.removeProperty(name);
    touched.clear();
  });

  it("resolves a name without the -- prefix", () => {
    setVar("--color-blue-500", "#3b82f6");
    expect(getStyle("color-blue-500")).toBe("#3b82f6");
  });

  it("resolves a name already prefixed with --", () => {
    setVar("--color-blue-500", "#3b82f6");
    expect(getStyle("--color-blue-500")).toBe("#3b82f6");
  });

  it("returns the same value regardless of which form is passed", () => {
    setVar("--radius-lg", "12px");
    expect(getStyle("radius-lg")).toBe(getStyle("--radius-lg"));
  });

  it("returns an empty string for an unset variable", () => {
    expect(getStyle("not-a-real-var")).toBe("");
    expect(getStyle("--not-a-real-var")).toBe("");
  });

  it("preserves names that already contain dashes", () => {
    setVar("--brand-primary-500", "rgb(0, 128, 255)");
    expect(getStyle("brand-primary-500")).toBe("rgb(0, 128, 255)");
  });
});
