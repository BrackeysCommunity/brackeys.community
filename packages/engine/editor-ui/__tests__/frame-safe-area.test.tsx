// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { EditorFrame, Island } from "../frame/EditorFrame";
import type { EditorStorage } from "../host";

const memoryStorage = (): EditorStorage => {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
};

const WIDTH = 1440;
const HEIGHT = 900;
const HOST = { width: 280, height: 40 };
const DOCK = { width: 360, height: 48 };

beforeEach(() => {
  Object.assign(window, { innerWidth: WIDTH, innerHeight: HEIGHT });
  const real = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect")!
    .value as (this: Element) => DOMRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("je-frame-top-left"))
      return DOMRect.fromRect({ x: 8, y: 8, ...HOST });
    if (this.classList.contains("je-frame-bottom"))
      return DOMRect.fromRect({
        x: 0,
        y: HEIGHT - 8 - DOCK.height,
        width: WIDTH,
        height: DOCK.height,
      });
    return real.call(this);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const safe = (doc: HTMLElement, edge: string) =>
  Number.parseFloat(doc.style.getPropertyValue(`--jams-ui-safe-${edge}`));

describe("the frame's safe area for a game's HUD", () => {
  it("keeps the play layer clear of the host's corner and the play controls' dock", () => {
    const mode = new Store({ mode: "edit" });
    render(
      <EditorFrame
        host={{ storage: memoryStorage() }}
        mode={mode}
        topLeft={<div>site</div>}
        dock={
          <Island>
            <button type="button">Stop</button>
          </Island>
        }
      >
        <canvas data-play-canvas="" />
      </EditorFrame>,
    );
    act(() => mode.setState(() => ({ mode: "play" })));
    const doc = document.querySelector<HTMLElement>(".je-frame-document")!;
    expect(doc.contains(document.querySelector("[data-play-canvas]"))).toBe(true);

    // The HUD's layer sits on the canvas inside the document, so it inherits these.
    expect(safe(doc, "top")).toBe(8 + HOST.height);
    expect(safe(doc, "bottom")).toBe(8 + DOCK.height);
    expect(safe(doc, "left")).toBe(0);
    expect(safe(doc, "right")).toBe(0);
    const dockTop = HEIGHT - 8 - DOCK.height;
    expect(HEIGHT - safe(doc, "bottom")).toBeLessThanOrEqual(dockTop);
  });
});
