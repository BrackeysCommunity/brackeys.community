// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { CanvasShell, islandInsets } from "@/components/canvas/shell/CanvasShell";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rect = (x: number, y: number, width: number, height: number) =>
  DOMRect.fromRect({ x, y, width, height });

describe("the shell's safe area for a game's HUD", () => {
  it("measures how far each island reaches in from the document's edges", () => {
    const doc = rect(0, 0, 1280, 800);
    expect(islandInsets(doc, {})).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(
      islandInsets(doc, {
        topLeft: rect(12, 12, 300, 40),
        topRight: rect(1100, 12, 168, 36),
        dock: rect(500, 740, 280, 48),
        status: rect(12, 760, 120, 28),
        right: rect(948, 68, 320, 720),
      }),
    ).toEqual({ top: 52, right: 332, bottom: 60, left: 0 });
    // An island that draws nothing reaches nowhere.
    expect(islandInsets(doc, { topLeft: rect(12, 12, 0, 0) }).top).toBe(0);
  });

  it("sets --jams-ui-safe-* on the document, so a HUD inside clears the site island", () => {
    const real = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect")!
      .value as (this: Element) => DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.hasAttribute("data-shell-document")) return rect(0, 0, 1280, 800);
        if (this.hasAttribute("data-site-island")) return rect(12, 12, 280, 40);
        if (this.hasAttribute("data-status-island")) return rect(12, 756, 140, 32);
        return real.call(this);
      },
    );
    const { container } = render(
      <CanvasShell
        topLeft={<div data-site-island="">site</div>}
        status={<div data-status-island="">saved</div>}
      >
        <div data-hud="" />
      </CanvasShell>,
    );
    const doc = container.querySelector<HTMLElement>("[data-shell-document]")!;
    expect(doc.style.getPropertyValue("--jams-ui-safe-top")).toBe("52px");
    expect(doc.style.getPropertyValue("--jams-ui-safe-bottom")).toBe("44px");
    expect(doc.style.getPropertyValue("--jams-ui-safe-left")).toBe("0px");
    expect(doc.style.getPropertyValue("--jams-ui-safe-right")).toBe("0px");
    expect(doc.contains(container.querySelector("[data-hud]"))).toBe(true);
  });
});
