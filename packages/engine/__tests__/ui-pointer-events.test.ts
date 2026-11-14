// @vitest-environment jsdom
/**
 * The pointer-events contract of everything the engine draws over the
 * canvas, checked with no host stylesheet loaded: the site's global rule
 * gives every button and link `pointer-events: auto`, which hides a control
 * that never opted back in under a layer's `none`. A standalone export has
 * no such rule, so each view must say what it takes itself.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createTouchControls } from "../input/touch-controls";
import { renderBootError } from "../standalone/errors";
import { createLoadingOverlay, fadeTransition } from "../ui/flow-views";
import { createTransitionLayer, createUiLayer } from "../ui/layer";

/** The pointer-events a click meets at `el`: its own value, else the nearest ancestor's (the property inherits). */
function pointerEventsAt(el: Element): string {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const own = at.ownerDocument.defaultView!.getComputedStyle(at).pointerEvents;
    if (own !== "" && own !== "inherit") return own;
  }
  return "auto";
}

function stage(): { frame: HTMLElement; canvas: HTMLCanvasElement } {
  const frame = document.createElement("div");
  frame.style.position = "relative";
  const canvas = document.createElement("canvas");
  frame.append(canvas);
  document.body.append(frame);
  return { frame, canvas };
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe("the layers over the canvas, without a host stylesheet", () => {
  it("has no global rule in play: a button left alone in the UI layer takes no clicks", () => {
    expect(document.styleSheets).toHaveLength(0);
    const { canvas } = stage();
    const ui = createUiLayer(canvas);
    const button = document.createElement("button");
    ui.root.append(button);
    expect(pointerEventsAt(ui.root)).toBe("none");
    expect(pointerEventsAt(button)).toBe("none");

    const opted = document.createElement("div");
    opted.style.pointerEvents = "auto";
    const inner = document.createElement("button");
    opted.append(inner);
    ui.root.append(opted);
    expect(pointerEventsAt(inner)).toBe("auto");
    ui.destroy();
  });

  it("leaves the transition layer's fade and loading view passing clicks through", async () => {
    const { canvas } = stage();
    const layer = createTransitionLayer(canvas);
    expect(pointerEventsAt(layer.root)).toBe("none");

    await fadeTransition()("out", { kind: "fade", ms: 0 }, layer.root, { reducedMotion: false });
    const veil = layer.root.querySelector("[data-jams-fade]");
    expect(veil).not.toBeNull();
    expect(pointerEventsAt(veil!)).toBe("none");

    const loading = createLoadingOverlay()(layer.root);
    loading.show({ loaded: 1, total: 2, bytes: 10, totalBytes: 20 });
    const view = layer.root.querySelector("[data-jams-loading]")!;
    for (const el of [view, ...view.querySelectorAll("*")])
      expect(pointerEventsAt(el)).toBe("none");
    expect(view.querySelector("button, a, input, [tabindex]")).toBeNull();
    loading.hide();
    layer.destroy();
  });

  it("gives each touch control the pointer, and the space between them to the canvas", () => {
    const { frame } = stage();
    const touch = createTouchControls(
      frame,
      [
        { id: "jump", kind: "button", action: "jump", at: [0.8, 0.8], radius: 0.1, label: "A" },
        { id: "move", kind: "stick", action: "move", at: [0.2, 0.8], radius: 0.15 },
        { id: "pad", kind: "dpad", action: "move", at: [0.5, 0.8], radius: 0.15 },
      ],
      () => {},
    );
    const overlay = frame.lastElementChild as HTMLElement;
    expect(pointerEventsAt(overlay)).toBe("none");
    const controls = [...overlay.children];
    expect(controls).toHaveLength(3);
    for (const control of controls) expect(pointerEventsAt(control)).toBe("auto");
    touch.destroy();
  });

  it("lets the boot error panel's Reload take clicks under a root that takes none", () => {
    const host = document.createElement("div");
    host.style.pointerEvents = "none";
    const root = document.createElement("div");
    host.append(root);
    document.body.append(host);
    const panel = renderBootError(root, { message: "no", code: "schema" });
    const reload = root.querySelector("button");
    expect(reload?.textContent).toBe("Reload");
    expect(pointerEventsAt(reload!)).toBe("auto");
    panel.destroy();
  });
});
