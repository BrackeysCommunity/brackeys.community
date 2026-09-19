// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { PageStack } from "@/components/ui/page-motion";
import { AppSettingsProvider, useReducedMotion } from "@/lib/hooks/use-app-settings";

/**
 * BC-207 — "Minified React error #418", 16 members over two build hashes.
 *
 * The settings provider reads `localStorage` synchronously, which the
 * server cannot do. Anything below it that renders differently under
 * reduced motion — `PageStack`'s `initial`, `JamBannerArt`'s `src`, the
 * settings pane's own controls — therefore disagreed with the SSR payload
 * for every member who had ever touched a setting, and React answers that
 * by throwing the hydrated tree away and rebuilding it. The tell in the
 * report was profile autosave "always" failing: a rebuild takes the
 * half-typed field with it.
 *
 * The check is the real thing rather than a proxy — hydrate the server's
 * HTML with a preference in storage and assert React recovered from
 * nothing.
 */

/** Every query answers false; the stored pref is what this test varies. */
function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** Reports the effective value into the DOM so a test can read it back. */
function MotionProbe() {
  return <span data-testid="probe" data-reduced={String(useReducedMotion())} />;
}

function Tree() {
  return (
    <AppSettingsProvider>
      <PageStack>
        <span>content</span>
        <MotionProbe />
      </PageStack>
    </AppSettingsProvider>
  );
}

let container: HTMLDivElement;

beforeEach(() => {
  installMatchMedia();
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

/**
 * Render as the server does — no storage to read — then hydrate that HTML
 * with `stored` in place, and report what React had to recover from.
 */
function hydrateWithStoredPref(stored: Record<string, string>): unknown[] {
  const html = renderToString(<Tree />);
  localStorage.clear();
  container.innerHTML = html;

  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);

  const recovered: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot>;
  act(() => {
    root = hydrateRoot(container, <Tree />, {
      onRecoverableError: (error) => recovered.push(error),
    });
  });
  act(() => root.unmount());
  return recovered;
}

describe("AppSettingsProvider hydration", () => {
  it("hydrates cleanly with an explicit reduced-motion preference", () => {
    expect(hydrateWithStoredPref({ "brackeys-reduce-motion": "reduced" })).toEqual([]);
  });

  it("hydrates cleanly with the legacy '1' spelling", () => {
    expect(hydrateWithStoredPref({ "brackeys-reduce-motion": "1" })).toEqual([]);
  });

  it("hydrates cleanly with no stored preference at all", () => {
    expect(hydrateWithStoredPref({})).toEqual([]);
  });

  it("still reaches the stored preference once hydrated", () => {
    const html = renderToString(<Tree />);
    localStorage.clear();
    container.innerHTML = html;
    // The server's answer, which the first client render has to repeat.
    expect(container.querySelector("[data-testid=probe]")?.getAttribute("data-reduced")).toBe(
      "false",
    );

    localStorage.setItem("brackeys-reduce-motion", "reduced");
    let root: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(container, <Tree />);
    });

    // Deferred by exactly one render, not dropped.
    expect(container.querySelector("[data-testid=probe]")?.getAttribute("data-reduced")).toBe(
      "true",
    );
    act(() => root.unmount());
  });
});
