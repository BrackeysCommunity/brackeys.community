import { act, cleanup, renderHook } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AppSettingsProvider, useAppSettings } from "@/lib/hooks/use-app-settings";

/** Controllable `prefers-reduced-motion` matchMedia stub. */
function installMatchMedia(initialReduced: boolean) {
  let matches = initialReduced;
  const listeners = new Set<(e: { matches: boolean }) => void>();

  window.matchMedia = ((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
    media: query,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
      listeners.delete(cb);
    },
  })) as unknown as typeof window.matchMedia;

  return {
    setReduced(next: boolean) {
      matches = next;
      for (const cb of listeners) cb({ matches: next });
    },
  };
}

function renderSettings() {
  return renderHook(() => useAppSettings(), {
    wrapper: ({ children }) => <AppSettingsProvider>{children}</AppSettingsProvider>,
  });
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.reduceMotion;
});

afterEach(cleanup);

describe("useAppSettings motion coalescing", () => {
  it("migrates legacy '1' to an explicit reduced pref", () => {
    installMatchMedia(false);
    localStorage.setItem("brackeys-reduce-motion", "1");

    const { result } = renderSettings();

    expect(result.current.motionPref).toBe("reduced");
    expect(result.current.reduceMotion).toBe(true);
  });

  it("migrates legacy '0' (and garbage) to system", () => {
    installMatchMedia(false);
    localStorage.setItem("brackeys-reduce-motion", "0");

    const { result } = renderSettings();

    expect(result.current.motionPref).toBe("system");
    expect(result.current.reduceMotion).toBe(false);
  });

  it("system pref follows a native reduce preference", () => {
    installMatchMedia(true);

    const { result } = renderSettings();

    expect(result.current.motionPref).toBe("system");
    expect(result.current.reduceMotion).toBe(true);
  });

  it("explicit full overrides a native reduce preference", () => {
    installMatchMedia(true);
    localStorage.setItem("brackeys-reduce-motion", "full");

    const { result } = renderSettings();

    expect(result.current.reduceMotion).toBe(false);
  });

  it("explicit reduced applies without any native preference", () => {
    installMatchMedia(false);
    localStorage.setItem("brackeys-reduce-motion", "reduced");

    const { result } = renderSettings();

    expect(result.current.reduceMotion).toBe(true);
  });

  it("mirrors the effective value to the html dataset", () => {
    installMatchMedia(false);

    const { result } = renderSettings();
    expect(document.documentElement.dataset.reduceMotion).toBe("false");

    act(() => result.current.setMotionPref("reduced"));

    expect(document.documentElement.dataset.reduceMotion).toBe("true");
    expect(localStorage.getItem("brackeys-reduce-motion")).toBe("reduced");
  });

  it("a native change event flips the effective value under system", () => {
    const media = installMatchMedia(false);

    const { result } = renderSettings();
    expect(result.current.reduceMotion).toBe(false);

    act(() => media.setReduced(true));

    expect(result.current.reduceMotion).toBe(true);
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
  });
});
