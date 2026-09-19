// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { motion } from "framer-motion";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { PageStack } from "@/components/ui/page-motion";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";
import { fadeUp } from "@/lib/motion";

/**
 * The entrance must never run on the render that matches the server's
 * HTML. `hidden` is `opacity: 0`, and framer writes a variant's resolved
 * values as inline style — so a page that starts hidden ships a fully
 * populated DOM that paints as a blank rectangle until the bundle lands
 * and hydration commits. Lighthouse read that as 5+ seconds of LCP
 * "element render delay" on every route.
 */

function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** A page shaped the way real ones are: a stack with a tagged section, so
 * the child's inherited state is covered alongside the container's. */
function Tree() {
  return (
    <AppSettingsProvider>
      <PageStack data-testid="stack">
        <motion.section variants={fadeUp} data-testid="section">
          content
        </motion.section>
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

describe("PageStack", () => {
  it("server-renders the page and its sections visible", () => {
    expect(renderToString(<Tree />)).not.toContain("opacity:0");
  });

  it("hydrates without hiding the page", () => {
    container.innerHTML = renderToString(<Tree />);

    let root: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(container, <Tree />);
    });

    for (const id of ["stack", "section"]) {
      const el = container.querySelector<HTMLElement>(`[data-testid=${id}]`);
      expect(el?.style.opacity).not.toBe("0");
    }
    act(() => root.unmount());
  });
});
